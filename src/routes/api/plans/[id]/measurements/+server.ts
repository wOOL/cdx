import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan } from '$lib/server/db/repo';
import type { Measurement } from '$lib/types';

export const POST: RequestHandler = async ({ params, request }) => {
	const planId = Number(params.id);
	const plan = getPlan(planId);
	if (!plan) error(404, 'Plan not found');
	if (plan.locked) error(409, 'Plan is locked');

	const body = await request.json().catch(() => ({}));
	const type = ['distance', 'angle', 'density', 'polyline', 'annotation', 'auxline'].includes(body.type)
		? body.type
		: 'distance';
	const measurement = db
		.query(
			`INSERT INTO measurements (plan_id, type, points, value, label, name)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`
		)
		.get(
			planId,
			type,
			JSON.stringify(body.points ?? []),
			Number(body.value) || 0,
			String(body.label ?? ''),
			String(body.name ?? '')
		) as Measurement;
	return json({ measurement });
};
