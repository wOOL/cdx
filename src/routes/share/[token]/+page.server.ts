import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
	getCase,
	getPatient,
	getPlan,
	getSettings,
	listImplants,
	listNerves
} from '$lib/server/db/repo';

export const load: PageServerLoad = async ({ params }) => {
	// links expire after 90 days
	const share = db
		.query(
			`SELECT * FROM shares WHERE token = ?1 AND revoked = 0
			 AND created_at > datetime('now', '-90 days')`
		)
		.get(params.token) as { plan_id: number } | null;
	if (!share) error(404, 'This share link does not exist, has expired, or was revoked');

	const plan = getPlan(share.plan_id);
	if (!plan) error(404, 'Plan not found');
	const c = getCase(plan.case_id);
	const patient = c ? getPatient(c.patient_id) : null;

	return {
		plan,
		caseTitle: c?.title ?? '',
		patientName: patient ? `${patient.last_name}, ${patient.first_name}` : '—',
		implants: listImplants(plan.id),
		nerves: listNerves(plan.id),
		settings: getSettings()
	};
};
