import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCase, getPlan, logAudit } from '$lib/server/db/repo';
import {
	createStudy,
	getModelRow,
	listStudiesJoined,
	type StudyType
} from '$lib/server/evaluation';

/** GET /api/evaluation → { studies } joined with case / plan / model names. */
export const GET: RequestHandler = async () => {
	return json({ studies: listStudiesJoined() });
};

/** POST /api/evaluation — create a study { name, caseId, planId, type, modelId }. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => ({}));

	const name = String(body.name ?? '').trim();
	const caseId = Number(body.caseId);
	const planId = Number(body.planId);
	const modelId = Number(body.modelId);
	const type = body.type as StudyType;

	if (!name) error(400, 'Study name is required');
	if (type !== 'scanbody' && type !== 'postopCT') {
		error(400, "Study type must be 'scanbody' or 'postopCT'");
	}
	if (!Number.isInteger(caseId) || !getCase(caseId)) error(404, 'Case not found');
	const plan = getPlan(planId);
	if (!plan || plan.case_id !== caseId) error(400, 'Plan does not belong to the selected case');
	const model = Number.isInteger(modelId) ? getModelRow(modelId) : null;
	if (!model || model.case_id !== caseId) error(400, 'Model does not belong to the selected case');

	const study = createStudy({ name, caseId, planId, type, modelId });
	logAudit(locals.user, 'evaluation.create', `study:${study.id}`, name);
	return json({ study }, { status: 201 });
};
