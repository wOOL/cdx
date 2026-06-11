import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getCase,
	getMasterPlan,
	getPatient,
	getPlan,
	getSettings,
	listDatasets,
	listImplants,
	listModels,
	listNerves
} from '$lib/server/db/repo';

export const load: PageServerLoad = async ({ params, url }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');
	const patient = getPatient(c.patient_id);
	if (!patient) error(404, 'Patient not found');
	const requested = Number(url.searchParams.get('plan') ?? 0);
	const plan = (requested ? getPlan(requested) : null) ?? getMasterPlan(caseId);
	return {
		settings: getSettings(),
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
