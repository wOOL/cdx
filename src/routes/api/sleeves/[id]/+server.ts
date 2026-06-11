/**
 * Single custom sleeve system.
 *
 * GET    /api/sleeves/[id] -> { system, used }
 * PATCH  /api/sleeves/[id] -> update (merged with existing, re-validated);
 *                             409 when the system is referenced by any implant
 * DELETE /api/sleeves/[id] -> delete; same in-use guard (409)
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	getSystem,
	updateSystem,
	usedSystemIds,
	validateSleeveSystem
} from '$lib/server/sleeveGeom';

const IN_USE_MSG = 'System is in use — export, modify, re-import as new';

function assertUnused(id: number): void {
	if (usedSystemIds().has(id)) error(409, IN_USE_MSG);
}

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const system = getSystem(id);
	if (!system) error(404, 'Sleeve system not found');
	return json({ system, used: usedSystemIds().has(id) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const existing = getSystem(id);
	if (!existing) error(404, 'Sleeve system not found');
	assertUnused(id);

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const merged = {
		name: 'name' in body ? body.name : existing.name,
		manufacturer: 'manufacturer' in body ? body.manufacturer : existing.manufacturer,
		notes: 'notes' in body ? body.notes : existing.notes,
		segments: 'segments' in body ? body.segments : existing.segments,
		drillOffset: 'drillOffset' in body ? body.drillOffset : existing.drillOffset
	};
	const res = validateSleeveSystem(merged);
	if (!res.ok) error(400, res.error);

	return json({ system: updateSystem(id, res.value) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const existing = getSystem(id);
	if (!existing) error(404, 'Sleeve system not found');
	assertUnused(id);

	db.query('DELETE FROM custom_sleeves WHERE id = ?1').run(id);
	return json({ ok: true });
};
