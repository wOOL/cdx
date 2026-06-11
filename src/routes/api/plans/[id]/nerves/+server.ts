import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan } from '$lib/server/db/repo';
import type { Nerve } from '$lib/types';

export const POST: RequestHandler = async ({ params, request }) => {
	const planId = Number(params.id);
	const plan = getPlan(planId);
	if (!plan) error(404, 'Plan not found');
	if (plan.locked) error(409, 'Plan is locked');

	const body = await request.json().catch(() => ({}));
	const nerve = db
		.query(
			`INSERT INTO nerves (plan_id, name, color, diameter, points)
			 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`
		)
		.get(
			planId,
			String(body.name ?? 'Nerve'),
			String(body.color ?? '#e8d44d'),
			Number(body.diameter) || 2.0,
			JSON.stringify(body.points ?? [])
		) as Nerve;
	return json({ nerve });
};
