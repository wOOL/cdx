import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { duplicatePlan, getCase, listPlans } from '$lib/server/db/repo';
import type { Plan } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
	const caseId = Number(params.id);
	return json({ plans: listPlans(caseId) });
};

/** Body: { name, copyFrom?: planId, parts?: { nerves?, implants?, measurements? } } */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const body = await request.json().catch(() => ({}));
	const name = String(body.name || `Plan ${listPlans(caseId).length + 1}`);

	let plan: Plan | null;
	if (body.copyFrom) {
		plan = duplicatePlan(Number(body.copyFrom), name, body.parts);
		if (!plan) error(404, 'Source plan not found');
	} else {
		plan = db
			.query(`INSERT INTO plans (case_id, name) VALUES (?1, ?2) RETURNING *`)
			.get(caseId, name) as Plan;
	}
	return json({ plan });
};
