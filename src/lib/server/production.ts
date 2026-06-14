/**
 * Production Management station (IFU 5.1 "Send to production" / I3 / I5).
 *
 * Reuses the restoration-order entity (migration 17, table `restoration_orders`)
 * — production status lives on `restoration_orders.status`. This module joins
 * those orders across ALL cases with their case/patient for a production queue,
 * advances the production lifecycle, and "subcontracts" an order to a lab
 * contact.
 *
 * Subcontracting is persisted two ways:
 *   1. `restoration_orders.subcontracted_to` (migration 18) — the durable,
 *      queryable link to the lab contact, surfaced on each queue row.
 *   2. an outgoing row in the existing `transfers` table tagged
 *      `service = 'restoration:<order_number>'` — so the subcontract shows up in
 *      the collaboration/transfer history just like any other "send to lab".
 */
import { db } from './db';
import { getContact, createTransfer, uniqueTransferDigits } from './collab';
import { getOrder, type OrderFields } from './restorationOrders';
import { PRODUCTION_STATUSES, type ProductionStatus } from '$lib/restorationCatalog';
import type { RestorationOrder, RestorationUnit } from '$lib/types';

export interface ProductionOrder {
	id: number;
	order_number: string;
	status: string;
	material: string;
	shade: string;
	dentist: string;
	anatomy_family: string;
	units: RestorationUnit[];
	bridges: number[][];
	notes: string;
	subcontracted_to: number | null;
	/** Resolved lab-contact name for subcontracted_to (empty when none). */
	subcontractor: string;
	case_id: number;
	case_title: string;
	patient_name: string;
	created_at: string;
	updated_at: string;
}

interface ProductionRow {
	id: number;
	order_number: string;
	status: string;
	material: string;
	shade: string;
	dentist: string;
	anatomy_family: string;
	units: string;
	bridges: string;
	notes: string;
	subcontracted_to: number | null;
	subcontractor: string;
	case_id: number;
	case_title: string;
	patient_name: string;
	created_at: string;
	updated_at: string;
}

function parseUnits(raw: string): RestorationUnit[] {
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr
			.filter((u) => u && typeof u === 'object')
			.map((u) => ({
				fdi: Number((u as RestorationUnit).fdi) || 0,
				role: String((u as RestorationUnit).role ?? ''),
				subtype: String((u as RestorationUnit).subtype ?? '')
			}))
			.filter((u) => u.fdi > 0);
	} catch {
		return [];
	}
}

function parseBridges(raw: string): number[][] {
	try {
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return arr
			.filter((g) => Array.isArray(g))
			.map((g) => (g as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))
			.filter((g) => g.length > 0);
	} catch {
		return [];
	}
}

function hydrate(row: ProductionRow): ProductionOrder {
	return {
		id: row.id,
		order_number: row.order_number,
		status: row.status,
		material: row.material,
		shade: row.shade,
		dentist: row.dentist,
		anatomy_family: row.anatomy_family,
		units: parseUnits(row.units),
		bridges: parseBridges(row.bridges),
		notes: row.notes,
		subcontracted_to: row.subcontracted_to ?? null,
		subcontractor: row.subcontractor ?? '',
		case_id: row.case_id,
		case_title: row.case_title ?? '',
		patient_name: row.patient_name ?? '',
		created_at: row.created_at,
		updated_at: row.updated_at
	};
}

export interface ProductionFilter {
	status?: string;
}

/**
 * All restoration orders across every case, joined with case + patient and the
 * (optional) subcontractor contact, newest first. Optionally filtered by status.
 */
export function listProductionOrders(filter: ProductionFilter = {}): ProductionOrder[] {
	const args: (string | number)[] = [];
	let where = '';
	if (filter.status) {
		args.push(filter.status);
		where = `WHERE o.status = ?${args.length}`;
	}
	const rows = db
		.query(
			`SELECT o.id, o.order_number, o.status, o.material, o.shade, o.dentist,
			        o.anatomy_family, o.units, o.bridges, o.notes, o.subcontracted_to,
			        o.case_id, o.created_at, o.updated_at,
			        COALESCE(cs.title, '') AS case_title,
			        COALESCE(TRIM(p.last_name || ', ' || p.first_name, ', '), '') AS patient_name,
			        COALESCE(ct.name, '') AS subcontractor
			 FROM restoration_orders o
			 LEFT JOIN cases cs ON cs.id = o.case_id
			 LEFT JOIN patients p ON p.id = cs.patient_id
			 LEFT JOIN contacts ct ON ct.id = o.subcontracted_to
			 ${where}
			 ORDER BY o.created_at DESC, o.id DESC`
		)
		.all(...args) as ProductionRow[];
	return rows.map(hydrate);
}

/**
 * Set an order's production status. Accepts any of the PRODUCTION_STATUSES
 * (routed | in-production | produced). Returns the updated order, or null if the
 * order doesn't exist. (Validation of the status value is the caller's job.)
 */
export function advanceStatus(orderId: number, status: ProductionStatus): RestorationOrder | null {
	if (!getOrder(orderId)) return null;
	db.query(
		`UPDATE restoration_orders SET status = ?2, updated_at = datetime('now') WHERE id = ?1`
	).run(orderId, status);
	return getOrder(orderId);
}

export function isProductionStatus(s: unknown): s is ProductionStatus {
	return typeof s === 'string' && (PRODUCTION_STATUSES as readonly string[]).includes(s);
}

export interface SubcontractResult {
	order: RestorationOrder;
	transferId: number;
}

/**
 * Subcontract an order to a lab contact: record the contact on the order
 * (subcontracted_to), set status to 'routed', and create an outgoing transfer
 * tagged `restoration:<order_number>` for the collaboration history. Returns
 * null if the order or contact does not exist.
 */
export function subcontract(orderId: number, contactId: number): SubcontractResult | null {
	const order = getOrder(orderId);
	if (!order) return null;
	const contact = getContact(contactId);
	if (!contact) return null;

	const transfer = createTransfer({
		contact_id: contactId,
		direction: 'out',
		number: `T-${uniqueTransferDigits()}`,
		state: 'uploaded',
		service: `restoration:${order.order_number}`,
		comment: `Subcontracted restoration order ${order.order_number} to ${contact.name}`
	});

	db.query(
		`UPDATE restoration_orders
		 SET subcontracted_to = ?2, status = 'routed', updated_at = datetime('now')
		 WHERE id = ?1`
	).run(orderId, contactId);

	const updated = getOrder(orderId);
	if (!updated) return null;
	return { order: updated, transferId: transfer.id };
}

// re-export so the (rare) caller importing OrderFields through here still works
export type { OrderFields };
