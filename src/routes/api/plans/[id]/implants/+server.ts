import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan } from '$lib/server/db/repo';
import type { Implant } from '$lib/types';

export const POST: RequestHandler = async ({ params, request }) => {
	const planId = Number(params.id);
	const plan = getPlan(planId);
	if (!plan) error(404, 'Plan not found');
	if (plan.locked) error(409, 'Plan is locked');

	const body = await request.json().catch(() => ({}));
	const implant = db
		.query(
			`INSERT INTO implants (plan_id, tooth, manufacturer, line, article, diameter, length,
				x, y, z, ax, ay, az, rotation, color, sleeve)
			 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) RETURNING *`
		)
		.get(
			planId,
			String(body.tooth ?? ''),
			String(body.manufacturer ?? 'Generic'),
			String(body.line ?? ''),
			String(body.article ?? ''),
			Number(body.diameter) || 4.1,
			Number(body.length) || 10,
			Number(body.x) || 0,
			Number(body.y) || 0,
			Number(body.z) || 0,
			Number(body.ax) || 0,
			Number(body.ay) || 0,
			Number(body.az ?? -1),
			Number(body.rotation) || 0,
			String(body.color ?? '#3aa757'),
			body.sleeve ? JSON.stringify(body.sleeve) : ''
		) as Implant;
	return json({ implant });
};
