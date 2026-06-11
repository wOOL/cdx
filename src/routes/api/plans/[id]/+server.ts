import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan, updatePlan } from '$lib/server/db/repo';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const plan = getPlan(id);
	if (!plan) error(404, 'Plan not found');
	if (plan.locked) error(409, 'Plan is locked');

	const body = await request.json().catch(() => null);
	if (!body) error(400, 'Invalid JSON');

	const fields: Record<string, unknown> = {};
	if ('pan_curve' in body) fields.pan_curve = JSON.stringify(body.pan_curve ?? null);
	if ('name' in body) fields.name = String(body.name);
	if ('settings' in body) fields.settings = JSON.stringify(body.settings ?? {});
	if ('locked' in body) fields.locked = body.locked ? 1 : 0;
	if ('approved' in body) fields.approved = body.approved ? 1 : 0;

	updatePlan(id, fields);
	return json({ ok: true });
};
