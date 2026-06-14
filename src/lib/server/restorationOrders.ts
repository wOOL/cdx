/**
 * Repo for DWOS-style restoration orders (migration 17, table
 * `restoration_orders`). One order per row; the `units` and `bridges` columns
 * hold JSON TEXT in the DB but every function in here parses/stringifies them at
 * the boundary so callers only ever see arrays (RestorationUnit[] / number[][]).
 *
 * NOTE: unrelated to $lib/server/orders.ts (coDiagnostiX provider transfers) —
 * this is a separate entity.
 */
import { db } from './db';
import { nextOrderNumber } from '$lib/restorationCatalog';
import type { RestorationOrder, RestorationUnit } from '$lib/types';

interface OrderRow {
	id: number;
	case_id: number;
	order_number: string;
	status: string;
	dentist: string;
	material: string;
	shade: string;
	anatomy_family: string;
	units: string;
	bridges: string;
	notes: string;
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

function hydrate(row: OrderRow): RestorationOrder {
	return {
		id: row.id,
		case_id: row.case_id,
		order_number: row.order_number,
		status: row.status,
		dentist: row.dentist,
		material: row.material,
		shade: row.shade,
		anatomy_family: row.anatomy_family,
		units: parseUnits(row.units),
		bridges: parseBridges(row.bridges),
		notes: row.notes,
		created_at: row.created_at,
		updated_at: row.updated_at
	};
}

export function listOrdersForCase(caseId: number): RestorationOrder[] {
	const rows = db
		.query('SELECT * FROM restoration_orders WHERE case_id = ?1 ORDER BY created_at DESC, id DESC')
		.all(caseId) as OrderRow[];
	return rows.map(hydrate);
}

export function getOrder(id: number): RestorationOrder | null {
	const row = db.query('SELECT * FROM restoration_orders WHERE id = ?1').get(id) as OrderRow | null;
	return row ? hydrate(row) : null;
}

export interface OrderFields {
	status?: string;
	dentist?: string;
	material?: string;
	shade?: string;
	anatomy_family?: string;
	units?: RestorationUnit[];
	bridges?: number[][];
	notes?: string;
}

/** Count of orders created "today" (UTC) — drives the order-number sequence. */
function seqToday(): number {
	const row = db
		.query(
			`SELECT COUNT(*) AS n FROM restoration_orders WHERE date(created_at) = date('now')`
		)
		.get() as { n: number };
	return row?.n ?? 0;
}

/** Generate a unique order number, retrying past collisions. */
function freshOrderNumber(): string {
	let n = seqToday();
	for (let i = 0; i < 100; i++) {
		const candidate = nextOrderNumber(n);
		const clash = db
			.query('SELECT 1 FROM restoration_orders WHERE order_number = ?1')
			.get(candidate);
		if (!clash) return candidate;
		n++;
	}
	// extremely unlikely fallback — guaranteed unique
	return `COM-${Date.now()}`;
}

export function createOrder(caseId: number, fields: OrderFields = {}): RestorationOrder {
	const orderNumber = freshOrderNumber();
	const row = db
		.query(
			`INSERT INTO restoration_orders
				(case_id, order_number, status, dentist, material, shade, anatomy_family, units, bridges, notes)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING *`
		)
		.get(
			caseId,
			orderNumber,
			fields.status ?? 'draft',
			fields.dentist ?? '',
			fields.material ?? '',
			fields.shade ?? '',
			fields.anatomy_family ?? '',
			JSON.stringify(fields.units ?? []),
			JSON.stringify(fields.bridges ?? []),
			fields.notes ?? ''
		) as OrderRow;
	return hydrate(row);
}

export function updateOrder(id: number, fields: OrderFields): RestorationOrder | null {
	const current = db
		.query('SELECT * FROM restoration_orders WHERE id = ?1')
		.get(id) as OrderRow | null;
	if (!current) return null;
	const row = db
		.query(
			`UPDATE restoration_orders SET
				status = ?2, dentist = ?3, material = ?4, shade = ?5, anatomy_family = ?6,
				units = ?7, bridges = ?8, notes = ?9, updated_at = datetime('now')
			 WHERE id = ?1 RETURNING *`
		)
		.get(
			id,
			fields.status ?? current.status,
			fields.dentist ?? current.dentist,
			fields.material ?? current.material,
			fields.shade ?? current.shade,
			fields.anatomy_family ?? current.anatomy_family,
			fields.units !== undefined ? JSON.stringify(fields.units) : current.units,
			fields.bridges !== undefined ? JSON.stringify(fields.bridges) : current.bridges,
			fields.notes ?? current.notes
		) as OrderRow;
	return hydrate(row);
}

export function deleteOrder(id: number): boolean {
	const existing = db.query('SELECT id FROM restoration_orders WHERE id = ?1').get(id);
	if (!existing) return false;
	db.query('DELETE FROM restoration_orders WHERE id = ?1').run(id);
	return true;
}
