import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createCase,
	createPatient,
	deleteCase,
	deletePatient,
	getPatient,
	listCasesForPatient,
	listDatasets,
	listPatients,
	updatePatient
} from '$lib/server/db/repo';

export const load: PageServerLoad = async ({ url }) => {
	const search = url.searchParams.get('q') ?? '';
	const patients = listPatients(search);
	const selId = Number(url.searchParams.get('sel') ?? patients[0]?.id ?? 0);
	const selected = selId ? (patients.find((p) => p.id === selId) ?? getPatient(selId)) : null;
	const cases = selected
		? listCasesForPatient(selected.id).map((c) => ({
				...c,
				datasetCount: listDatasets(c.id).length
			}))
		: [];
	return { patients, selected, cases, search };
};

function patientFromForm(form: FormData) {
	return {
		external_id: String(form.get('external_id') ?? ''),
		first_name: String(form.get('first_name') ?? '').trim(),
		last_name: String(form.get('last_name') ?? '').trim(),
		date_of_birth: String(form.get('date_of_birth') ?? ''),
		sex: String(form.get('sex') ?? ''),
		notes: String(form.get('notes') ?? '')
	};
}

export const actions: Actions = {
	createPatient: async ({ request }) => {
		const form = await request.formData();
		const data = patientFromForm(form);
		if (!data.last_name && !data.first_name) {
			return fail(400, { error: 'Patient name is required' });
		}
		const p = createPatient(data);
		redirect(303, `/?sel=${p.id}`);
	},

	updatePatient: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'Missing patient id' });
		updatePatient(id, patientFromForm(form));
		redirect(303, `/?sel=${id}`);
	},

	deletePatient: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (id) deletePatient(id);
		redirect(303, '/');
	},

	createCase: async ({ request }) => {
		const form = await request.formData();
		const patientId = Number(form.get('patient_id'));
		if (!patientId) return fail(400, { error: 'Missing patient' });
		const title = String(form.get('title') ?? '').trim() || 'New case';
		const c = createCase(patientId, title);
		redirect(303, `/cases/${c.id}`);
	},

	deleteCase: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const patientId = Number(form.get('patient_id'));
		if (id) deleteCase(id);
		redirect(303, patientId ? `/?sel=${patientId}` : '/');
	}
};
