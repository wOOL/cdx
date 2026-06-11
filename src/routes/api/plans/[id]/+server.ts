import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deletePlan, getPlan, logAudit, updatePlan } from '$lib/server/db/repo';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const plan = getPlan(id);
	if (!plan) error(404, 'Plan not found');

	const body = await request.json().catch(() => null);
	if (!body) error(400, 'Invalid JSON');

	// a locked plan only accepts lock/approve changes
	const keys = Object.keys(body);
	const onlyLockKeys = keys.every((k) => k === 'locked' || k === 'approved');
	if (plan.locked && !onlyLockKeys) error(409, 'Plan is locked');

	const fields: Record<string, unknown> = {};
	if ('pan_curve' in body) fields.pan_curve = JSON.stringify(body.pan_curve ?? null);
	if ('name' in body) fields.name = String(body.name);
	if ('settings' in body) fields.settings = JSON.stringify(body.settings ?? {});
	if ('locked' in body) fields.locked = body.locked ? 1 : 0;
	if ('approved' in body) fields.approved = body.approved ? 1 : 0;
	if ('jaw' in body) fields.jaw = body.jaw === 'maxilla' ? 'maxilla' : 'mandible';

	updatePlan(id, fields);
	if ('approved' in body) {
		logAudit(locals.user, body.approved ? 'plan.approve' : 'plan.unapprove', `plan:${id}`, plan.name);
	}
	if ('locked' in body) {
		logAudit(locals.user, body.locked ? 'plan.lock' : 'plan.unlock', `plan:${id}`, plan.name);
	}
	return json({ plan: getPlan(id) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const ok = deletePlan(Number(params.id));
	if (!ok) error(400, 'Cannot delete the master plan');
	return json({ ok: true });
};
