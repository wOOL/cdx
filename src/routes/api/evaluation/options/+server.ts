import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCase, listModels, listPlans } from '$lib/server/db/repo';

/**
 * GET /api/evaluation/options?caseId=N
 * Lightweight picker data for the study create form: the case's plans and models.
 */
export const GET: RequestHandler = async ({ url }) => {
	const caseId = Number(url.searchParams.get('caseId'));
	if (!Number.isInteger(caseId) || !getCase(caseId)) error(404, 'Case not found');

	const plans = listPlans(caseId).map((p) => ({ id: p.id, name: p.name }));
	const models = listModels(caseId).map((m) => ({ id: m.id, name: m.name, kind: m.kind }));
	return json({ plans, models });
};
