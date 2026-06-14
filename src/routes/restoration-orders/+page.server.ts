import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCase, getPatient } from '$lib/server/db/repo';
import { listOrdersForCase } from '$lib/server/restorationOrders';
import {
	ANATOMY_FAMILIES,
	MATERIALS,
	ORDER_STATUSES,
	PROSTHESIS_ROLES,
	PROSTHESIS_SUBTYPES,
	SHADES
} from '$lib/restorationCatalog';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);

	const caseId = Number(url.searchParams.get('case') ?? 0);
	if (!caseId) error(400, 'Missing ?case=<id>');
	const kase = getCase(caseId);
	if (!kase) error(404, 'Case not found');
	const patient = getPatient(kase.patient_id);

	return {
		case: kase,
		patientName: patient ? `${patient.last_name}, ${patient.first_name}`.replace(/^, |, $/g, '') : '',
		orders: listOrdersForCase(caseId),
		catalog: {
			roles: PROSTHESIS_ROLES,
			subtypes: PROSTHESIS_SUBTYPES,
			materials: MATERIALS,
			shades: SHADES,
			anatomyFamilies: ANATOMY_FAMILIES,
			statuses: ORDER_STATUSES
		}
	};
};
