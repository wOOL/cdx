import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { unzipSync } from 'fflate';
import { db } from '$lib/server/db';
import {
	createCase,
	createPatient,
	deleteCase,
	deletePatient,
	getPatient,
	listCasesForPatient,
	listDatasets,
	listImages,
	listPatients,
	logAudit,
	updatePatient
} from '$lib/server/db/repo';
import { importDicomToCase } from '$lib/server/dicom/import';

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
	const images = selected ? listImages(selected.id) : [];
	return { patients, selected, cases, images, search };
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

	deletePatient: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (id) {
			const p = getPatient(id);
			deletePatient(id);
			logAudit(locals.user, 'patient.delete', `patient:${id}`, p ? `${p.last_name}, ${p.first_name}` : '');
		}
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

	toggleAnonymize: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const p = getPatient(id);
		if (!p) return fail(404, { error: 'Patient not found' });
		logAudit(locals.user, p.real_data ? 'patient.deanonymize' : 'patient.anonymize', `patient:${id}`);

		if (!p.real_data) {
			// anonymize: stash the identity, replace with a pseudonym
			const stash = JSON.stringify({
				external_id: p.external_id,
				first_name: p.first_name,
				last_name: p.last_name,
				date_of_birth: p.date_of_birth
			});
			db.query(
				`UPDATE patients SET external_id = ?2, first_name = ?3, last_name = ?4,
				 date_of_birth = '', real_data = ?5, updated_at = datetime('now') WHERE id = ?1`
			).run(id, `ANON-${id}`, `P-${id}`, 'Anonymous', stash);
		} else {
			// restore the original identity
			try {
				const orig = JSON.parse(p.real_data);
				db.query(
					`UPDATE patients SET external_id = ?2, first_name = ?3, last_name = ?4,
					 date_of_birth = ?5, real_data = '', updated_at = datetime('now') WHERE id = ?1`
				).run(id, orig.external_id ?? '', orig.first_name ?? '', orig.last_name ?? '', orig.date_of_birth ?? '');
			} catch {
				return fail(500, { error: 'Stored identity is corrupt — cannot de-anonymize' });
			}
		}
		redirect(303, `/?sel=${id}`);
	},

	createDemo: async () => {
		const file = Bun.file('testdata/synthetic-cbct.zip');
		if (!(await file.exists())) {
			return fail(400, {
				error: 'Demo data missing — run: bun run scripts/make-synthetic-dicom.ts'
			});
		}
		const p = createPatient({
			first_name: 'Patient',
			last_name: 'Demo',
			date_of_birth: '1980-05-12',
			sex: 'F',
			external_id: 'DEMO-1',
			notes: 'Synthetic CBCT phantom for exploring the planning workflow.'
		});
		const c = createCase(p.id, 'Demo — implant 36/46');
		const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
		const buffers = Object.entries(entries)
			.filter(([n, d]) => !n.endsWith('/') && d.length > 0)
			.map(([, d]) => d);
		await importDicomToCase(c.id, buffers);
		redirect(303, `/cases/${c.id}`);
	},

	deleteCase: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const patientId = Number(form.get('patient_id'));
		if (id) {
			deleteCase(id);
			logAudit(locals.user, 'case.delete', `case:${id}`);
		}
		redirect(303, patientId ? `/?sel=${patientId}` : '/');
	}
};
