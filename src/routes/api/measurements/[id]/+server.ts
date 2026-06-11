import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan } from '$lib/server/db/repo';

export const DELETE: RequestHandler = async ({ params }) => {
	const row = db
		.query('SELECT plan_id FROM measurements WHERE id = ?1')
		.get(Number(params.id)) as { plan_id: number } | null;
	if (row && getPlan(row.plan_id)?.locked) error(409, 'Plan is locked');
	db.query('DELETE FROM measurements WHERE id = ?1').run(Number(params.id));
	return json({ ok: true });
};
