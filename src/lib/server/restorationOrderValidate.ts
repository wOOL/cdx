/**
 * Validation/normalisation of a restoration-order request body into OrderFields.
 * Shared by both API routes so create + update enforce identical rules. Unknown
 * keys are ignored; with { partial: true } any subset of fields is accepted.
 */
import {
	ANATOMY_FAMILIES,
	MATERIALS,
	ORDER_STATUSES,
	PROSTHESIS_ROLES,
	PROSTHESIS_SUBTYPES,
	SHADES,
	type ProsthesisRole
} from '$lib/restorationCatalog';
import { FDI_LOWER, FDI_UPPER } from '$lib/aiReviewMap';
import type { OrderFields } from '$lib/server/restorationOrders';
import type { RestorationUnit } from '$lib/types';

const VALID_FDI = new Set([...FDI_UPPER, ...FDI_LOWER]);
const ROLES = new Set<string>(PROSTHESIS_ROLES);
const STATUSES = new Set<string>(ORDER_STATUSES);
const MATERIAL_IDS = new Set(MATERIALS.map((m) => m.id));
const ANATOMY_IDS = new Set(ANATOMY_FAMILIES.map((a) => a.id));
const SHADE_SET = new Set(SHADES);

type Result = { fields: OrderFields } | { error: string };

export function validateOrderFields(input: unknown, opts: { partial?: boolean } = {}): Result {
	if (!input || typeof input !== 'object') return { error: 'JSON body required' };
	const b = input as Record<string, unknown>;
	const fields: OrderFields = {};

	if ('status' in b) {
		const s = String(b.status);
		if (!STATUSES.has(s)) return { error: `status must be one of ${[...STATUSES].join(', ')}` };
		fields.status = s;
	}
	if ('dentist' in b) fields.dentist = String(b.dentist ?? '').slice(0, 120);
	if ('notes' in b) fields.notes = String(b.notes ?? '').slice(0, 2000);

	if ('material' in b && b.material !== '') {
		const m = String(b.material);
		if (!MATERIAL_IDS.has(m)) return { error: `unknown material '${m}'` };
		fields.material = m;
	} else if ('material' in b) {
		fields.material = '';
	}

	if ('shade' in b && b.shade !== '') {
		const s = String(b.shade);
		if (!SHADE_SET.has(s)) return { error: `unknown shade '${s}'` };
		fields.shade = s;
	} else if ('shade' in b) {
		fields.shade = '';
	}

	if ('anatomy_family' in b && b.anatomy_family !== '') {
		const a = String(b.anatomy_family);
		if (!ANATOMY_IDS.has(a)) return { error: `unknown anatomy family '${a}'` };
		fields.anatomy_family = a;
	} else if ('anatomy_family' in b) {
		fields.anatomy_family = '';
	}

	if ('units' in b) {
		if (!Array.isArray(b.units)) return { error: 'units must be an array' };
		const units: RestorationUnit[] = [];
		const seen = new Set<number>();
		for (const raw of b.units) {
			if (!raw || typeof raw !== 'object') return { error: 'each unit must be an object' };
			const u = raw as Record<string, unknown>;
			const fdi = Number(u.fdi);
			if (!VALID_FDI.has(fdi)) return { error: `invalid FDI number '${u.fdi}'` };
			if (seen.has(fdi)) return { error: `duplicate FDI unit ${fdi}` };
			seen.add(fdi);
			const role = String(u.role ?? '');
			if (!ROLES.has(role)) return { error: `invalid role '${role}' for tooth ${fdi}` };
			const subtype = String(u.subtype ?? '');
			const allowed = PROSTHESIS_SUBTYPES[role as ProsthesisRole];
			if (subtype && !allowed.includes(subtype)) {
				return { error: `invalid subtype '${subtype}' for role '${role}'` };
			}
			units.push({ fdi, role, subtype: subtype || allowed[0] });
		}
		fields.units = units;
	}

	if ('bridges' in b) {
		if (!Array.isArray(b.bridges)) return { error: 'bridges must be an array of FDI arrays' };
		const bridges: number[][] = [];
		for (const raw of b.bridges) {
			if (!Array.isArray(raw)) return { error: 'each bridge must be an array of FDI numbers' };
			const group: number[] = [];
			for (const n of raw) {
				const fdi = Number(n);
				if (!VALID_FDI.has(fdi)) return { error: `invalid FDI number in bridge '${n}'` };
				if (!group.includes(fdi)) group.push(fdi);
			}
			if (group.length >= 2) bridges.push(group);
		}
		fields.bridges = bridges;
	}

	if (!opts.partial && Object.keys(fields).length === 0) {
		return { error: 'no valid fields to update' };
	}
	return { fields };
}
