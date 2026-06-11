import { db } from './db';
import { setSetting } from './db/repo';
import type { TransferState } from './collab';

/**
 * Order Management (provider side) — SPEC §12.2.
 *
 * No new tables: the provider profile lives in the settings table under the
 * 'provider_profile' key, and "orders" are simply incoming transfers that
 * carry a service request (transfers.service != '') — the same rows the
 * clinician side creates via /api/transfers or /api/plans/[id]/send.
 */

// ---------- provider profile ----------

export const PROVIDER_SERVICES = [
	{ id: 'guide-design', label: 'Design of surgical guide' },
	{ id: 'guide-fabrication', label: 'Fabrication of surgical guide' },
	{ id: 'bone-block', label: 'Bone block design' },
	{ id: 'radiographic-assessment', label: 'Radiographic assessment' },
	{ id: 'custom', label: 'Custom services' }
] as const;

export type ProviderServiceId = (typeof PROVIDER_SERVICES)[number]['id'];

export const PROVIDER_SERVICE_IDS: string[] = PROVIDER_SERVICES.map((s) => s.id);

export interface ProviderProfile {
	registered: boolean;
	name: string;
	services: string[];
	confirmationPending: boolean;
}

const PROFILE_KEY = 'provider_profile';

export function getProviderProfile(): ProviderProfile | null {
	const row = db.query('SELECT value FROM settings WHERE key = ?1').get(PROFILE_KEY) as {
		value: string;
	} | null;
	if (!row?.value) return null;
	try {
		const p = JSON.parse(row.value) as ProviderProfile;
		return {
			registered: !!p.registered,
			name: String(p.name ?? ''),
			services: Array.isArray(p.services) ? p.services.map(String) : [],
			confirmationPending: !!p.confirmationPending
		};
	} catch {
		return null;
	}
}

export function setProviderProfile(p: ProviderProfile): void {
	setSetting(PROFILE_KEY, JSON.stringify(p));
}

// ---------- lab directory ----------

export interface LabEntry {
	name: string;
	services: string[];
	/** true for the own (locally registered) lab profile */
	self?: boolean;
}

/** Static demo directory of registered providers (fictional). */
const DEMO_LABS: LabEntry[] = [
	{ name: 'NorthStar Dental Lab', services: ['guide-design', 'guide-fabrication'] },
	{ name: 'Helvetic Guide Works', services: ['guide-fabrication', 'bone-block'] },
	{ name: 'Aurora Radiology Partners', services: ['radiographic-assessment', 'custom'] }
];

/** Demo labs merged with the own profile (listed first) once registration is confirmed. */
export function listDirectory(): LabEntry[] {
	const labs: LabEntry[] = [];
	const profile = getProviderProfile();
	if (profile?.registered) {
		labs.push({ name: profile.name, services: profile.services, self: true });
	}
	return labs.concat(DEMO_LABS.map((l) => ({ ...l, services: [...l.services] })));
}

// ---------- orders ----------

export type OrderState = 'new' | 'processing' | 'finished' | 'rejected';

/**
 * Transfer state → order state. 'uploaded' is the received/inbox state of an
 * incoming transfer; download/import means the provider is working on it.
 */
export const ORDER_STATE_BY_TRANSFER: Record<TransferState, OrderState> = {
	uploaded: 'new',
	downloaded: 'processing',
	imported: 'processing',
	finished: 'finished',
	rejected: 'rejected'
};

export interface Order {
	/** id of the underlying incoming transfer row */
	id: number;
	service: string;
	state: OrderState;
	contact: string;
	patientAlias: string;
	caseTitle: string;
	createdAt: string;
}

interface OrderRow {
	id: number;
	service: string;
	state: TransferState;
	contact: string;
	patientAlias: string;
	caseTitle: string;
	created_at: string;
}

/** Incoming transfers that carry a service request, newest first. */
export function listOrders(): Order[] {
	const rows = db
		.query(
			`SELECT t.id, t.service, t.state, t.created_at,
			        COALESCE(c.name, '') AS contact,
			        COALESCE(TRIM(p.last_name || ', ' || p.first_name, ', '), '') AS patientAlias,
			        COALESCE(cs.title, '') AS caseTitle
			 FROM transfers t
			 LEFT JOIN contacts c ON c.id = t.contact_id
			 LEFT JOIN plans pl ON pl.id = t.plan_id
			 LEFT JOIN cases cs ON cs.id = pl.case_id
			 LEFT JOIN patients p ON p.id = cs.patient_id
			 WHERE t.direction = 'in' AND t.service <> ''
			 ORDER BY t.created_at DESC, t.id DESC`
		)
		.all() as OrderRow[];
	return rows.map((r) => ({
		id: r.id,
		service: r.service,
		state: ORDER_STATE_BY_TRANSFER[r.state] ?? 'new',
		contact: r.contact,
		patientAlias: r.patientAlias,
		caseTitle: r.caseTitle,
		createdAt: r.created_at
	}));
}

/** The single order behind a transfer id, or null when the row is not an order. */
export function getOrderTransfer(
	id: number
): { id: number; state: TransferState; service: string; payload_path: string } | null {
	const row = db
		.query(
			`SELECT id, state, service, payload_path FROM transfers
			 WHERE id = ?1 AND direction = 'in' AND service <> ''`
		)
		.get(id) as { id: number; state: TransferState; service: string; payload_path: string } | null;
	return row ?? null;
}

export type OrderAction = 'process' | 'finish' | 'reject' | 'remove';

export const ORDER_ACTIONS: OrderAction[] = ['process', 'finish', 'reject', 'remove'];
