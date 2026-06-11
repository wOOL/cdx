import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getCase,
	getMasterPlan,
	getPatient,
	listDatasets,
	listImplants,
	listModels,
	listNerves
} from '$lib/server/db/repo';

export const load: PageServerLoad = async ({ params }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');
	const patient = getPatient(c.patient_id);
	if (!patient) error(404, 'Patient not found');
	const plan = getMasterPlan(caseId);
	return {
		caseData: c,
		patient,
		plan,
		datasets: listDatasets(caseId),
		implants: listImplants(plan.id),
		nerves: listNerves(plan.id),
		models: listModels(caseId),
		generatedAt: new Date().toISOString()
	};
};
