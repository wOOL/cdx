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
	listMeasurements,
	listModels,
	listNerves,
	listPlans
} from '$lib/server/db/repo';

export const load: PageServerLoad = async ({ params, url }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');
	const patient = getPatient(c.patient_id);
	if (!patient) error(404, 'Patient not found');

	const plans = listPlans(caseId);
	const requested = Number(url.searchParams.get('plan') ?? 0);
	const plan =
		(requested ? getPlan(requested) : null) ??
		plans.find((p) => p.is_master) ??
		getMasterPlan(caseId);
	if (plan.case_id !== caseId) error(404, 'Plan not found');

	return {
		caseData: c,
		patient,
		plan,
		plans,
		settings: getSettings(),
		datasets: listDatasets(caseId),
		models: listModels(caseId),
		implants: listImplants(plan.id),
		nerves: listNerves(plan.id),
		measurements: listMeasurements(plan.id)
	};
};
