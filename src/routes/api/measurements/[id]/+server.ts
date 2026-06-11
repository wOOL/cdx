import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan } from '$lib/server/db/repo';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const row = db
		.query('SELECT * FROM measurements WHERE id = ?1')
		.get(Number(params.id)) as { id: number; plan_id: number } | null;
	if (!row) error(404, 'Measurement not found');
	if (getPlan(row.plan_id)?.locked) error(409, 'Plan is locked');
	const body = await request.json().catch(() => ({}));
	db.query(
		`UPDATE measurements SET points = ?2, value = ?3, label = ?4, name = ?5 WHERE id = ?1`
	).run(
		row.id,
		JSON.stringify(body.points ?? []),
		Number(body.value) || 0,
		String(body.label ?? ''),
		String(body.name ?? '')
	);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const row = db
		.query('SELECT plan_id FROM measurements WHERE id = ?1')
		.get(Number(params.id)) as { plan_id: number } | null;
	if (row && getPlan(row.plan_id)?.locked) error(409, 'Plan is locked');
	db.query('DELETE FROM measurements WHERE id = ?1').run(Number(params.id));
	return json({ ok: true });
};
