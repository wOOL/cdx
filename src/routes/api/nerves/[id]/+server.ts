import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan } from '$lib/server/db/repo';
import type { Nerve } from '$lib/types';

function getNerve(id: number): Nerve | null {
	return (db.query('SELECT * FROM nerves WHERE id = ?1').get(id) as Nerve) ?? null;
}

function assertUnlocked(planId: number): void {
	const plan = getPlan(planId);
	if (plan?.locked) error(409, 'Plan is locked');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const nerve = getNerve(id);
	if (!nerve) error(404, 'Nerve not found');
	assertUnlocked(nerve.plan_id);

	const body = await request.json().catch(() => ({}));
	db.query(
		`UPDATE nerves SET name = ?2, color = ?3, diameter = ?4, points = ?5, visible = ?6 WHERE id = ?1`
	).run(
		id,
		'name' in body ? String(body.name) : nerve.name,
		'color' in body ? String(body.color) : nerve.color,
		'diameter' in body ? Number(body.diameter) || nerve.diameter : nerve.diameter,
		'points' in body ? JSON.stringify(body.points) : nerve.points,
		'visible' in body ? (body.visible ? 1 : 0) : nerve.visible
	);
	return json({ nerve: getNerve(id) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const nerve = getNerve(Number(params.id));
	if (nerve) assertUnlocked(nerve.plan_id);
	db.query('DELETE FROM nerves WHERE id = ?1').run(Number(params.id));
	return json({ ok: true });
};
