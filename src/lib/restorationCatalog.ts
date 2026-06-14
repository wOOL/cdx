/**
 * DWOS-style restoration order option lists (IFU 5.1). Pure data + helpers —
 * no DOM, no Bun, no $lib/server imports — so the client UI, the API, and tests
 * can all share the same authoritative choices.
 *
 * A restoration order specifies what prosthesis to design on a case: an
 * order-level dentist / material / shade / anatomy family, plus a set of tooth
 * units (FDI number + role + subtype) and optional bridge groupings.
 */

/** Prosthesis roles a single tooth unit can take. */
export const PROSTHESIS_ROLES = [
	'crown',
	'pontic',
	'abutment',
	'inlay',
	'onlay',
	'veneer',
	'coping'
] as const;

export type ProsthesisRole = (typeof PROSTHESIS_ROLES)[number];

/** Subtypes per role (DWOS design-type families). */
export const PROSTHESIS_SUBTYPES: Record<ProsthesisRole, string[]> = {
	crown: ['Full crown', 'Full anatomical', 'Reduced/coping'],
	pontic: ['Full pontic', 'Conical pontic', 'Ridge-lap'],
	abutment: ['Crown abutment', 'Inlay abutment', 'Telescope abutment'],
	inlay: ['Inlay'],
	onlay: ['Onlay', 'Overlay'],
	veneer: ['Veneer', 'Partial veneer'],
	coping: ['Anatomical coping', 'Reduced coping']
};

/** Default subtype for a role (first entry). */
export function defaultSubtype(role: string): string {
	const list = PROSTHESIS_SUBTYPES[role as ProsthesisRole];
	return list ? list[0] : '';
}

export interface MaterialOption {
	id: string;
	label: string;
}

/** Restoration materials (DWOS-like). */
export const MATERIALS: MaterialOption[] = [
	{ id: 'zirconia', label: 'Zirconia' },
	{ id: 'emax', label: 'Lithium disilicate (e.max)' },
	{ id: 'pmma', label: 'PMMA' },
	{ id: 'wax', label: 'Wax' },
	{ id: 'cocr', label: 'Co-Cr' },
	{ id: 'titanium', label: 'Titanium' },
	{ id: 'composite', label: 'Composite' }
];

/** VITA classical shade guide. */
export const SHADES = [
	'A1',
	'A2',
	'A3',
	'A3.5',
	'A4',
	'B1',
	'B2',
	'B3',
	'B4',
	'C1',
	'C2',
	'C3',
	'C4',
	'D2',
	'D3',
	'D4'
];

export interface AnatomyFamily {
	id: string;
	label: string;
}

/** Tooth-library anatomy families (placeholder library names). */
export const ANATOMY_FAMILIES: AnatomyFamily[] = [
	{ id: 'natural', label: 'Natural' },
	{ id: 'young', label: 'Young' },
	{ id: 'aged', label: 'Aged' },
	{ id: 'functional', label: 'Functional' }
];

/** Order status flow: draft → routed → designing → designed. */
export const ORDER_STATUSES = ['draft', 'routed', 'designing', 'designed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Generate an order number in the DWOS-like form COM-YYDDD-N, where YYDDD is the
 * 2-digit year + day-of-year and N is a per-day sequence counter (1-based). The
 * caller supplies how many orders already exist today so the number is unique.
 */
export function nextOrderNumber(seqToday: number, now: Date = new Date()): string {
	const yy = String(now.getUTCFullYear()).slice(-2);
	const start = Date.UTC(now.getUTCFullYear(), 0, 0);
	const day = Math.floor((now.getTime() - start) / 86_400_000);
	const ddd = String(day).padStart(3, '0');
	return `COM-${yy}${ddd}-${seqToday + 1}`;
}
