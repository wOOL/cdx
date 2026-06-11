import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan, markGuideStale } from '$lib/server/db/repo';
import type { Implant } from '$lib/types';

function getImplant(id: number): Implant | null {
	return (db.query('SELECT * FROM implants WHERE id = ?1').get(id) as Implant) ?? null;
}

function assertUnlocked(planId: number): void {
	const plan = getPlan(planId);
	if (plan?.locked) error(409, 'Plan is locked');
}

const NUM_FIELDS = ['diameter', 'length', 'x', 'y', 'z', 'ax', 'ay', 'az', 'rotation'] as const;
const STR_FIELDS = ['tooth', 'manufacturer', 'line', 'article', 'color'] as const;

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const implant = getImplant(id);
	if (!implant) error(404, 'Implant not found');
	assertUnlocked(implant.plan_id);

	const body = await request.json().catch(() => ({}));
	const updated: Record<string, string | number> = { ...implant };
	// a position-locked implant ignores geometry changes until unlocked in the same request
	const unlocking = 'locked' in body && !body.locked;
	const geometryFrozen = !!implant.locked && !unlocking;
	for (const f of NUM_FIELDS) {
		if (geometryFrozen) break;
		if (f in body && Number.isFinite(Number(body[f]))) updated[f] = Number(body[f]);
	}
	if ('locked' in body) updated.locked = body.locked ? 1 : 0;
	for (const f of STR_FIELDS) {
		if (f in body) updated[f] = String(body[f]);
	}
	if ('sleeve' in body) updated.sleeve = body.sleeve ? JSON.stringify(body.sleeve) : '';
	if ('abutment' in body) updated.abutment = body.abutment ? JSON.stringify(body.abutment) : '';
	if ('visible' in body) updated.visible = body.visible ? 1 : 0;

	db.query(
		`UPDATE implants SET tooth=?2, manufacturer=?3, line=?4, article=?5, diameter=?6, length=?7,
			x=?8, y=?9, z=?10, ax=?11, ay=?12, az=?13, rotation=?14, color=?15, sleeve=?16, visible=?17,
			abutment=?18, locked=?19
		 WHERE id=?1`
	).run(
		id,
		updated.tooth,
		updated.manufacturer,
		updated.line,
		updated.article,
		updated.diameter,
		updated.length,
		updated.x,
		updated.y,
		updated.z,
		updated.ax,
		updated.ay,
		updated.az,
		updated.rotation,
		updated.color,
		updated.sleeve,
		updated.visible,
		updated.abutment,
		updated.locked ?? 0
	);
	markGuideStale(implant.plan_id);
	return json({ implant: getImplant(id) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const implant = getImplant(Number(params.id));
	if (implant) assertUnlocked(implant.plan_id);
	db.query('DELETE FROM implants WHERE id = ?1').run(Number(params.id));
	if (implant) markGuideStale(implant.plan_id);
	return json({ ok: true });
};
