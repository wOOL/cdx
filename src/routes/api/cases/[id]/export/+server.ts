import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { zipSync } from 'fflate';
import { basename } from 'node:path';
import {
	getCase,
	getPatient,
	listDatasets,
	listImplants,
	listMeasurements,
	listModels,
	listNerves,
	listPlans
} from '$lib/server/db/repo';
import { resolveData } from '$lib/server/db';

/** Full case archive: case.json + volume/preview/model files. */
export const GET: RequestHandler = async ({ params }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');
	const patientRow = getPatient(c.patient_id);
	const plans = listPlans(caseId);
	let datasets = listDatasets(caseId);
	const models = listModels(caseId);

	// never export the stashed real identity; for anonymized patients also strip
	// DICOM-derived identity from the dataset rows
	const { real_data, ...patient } = patientRow ?? ({} as never);
	if (real_data) {
		datasets = datasets.map((d) => ({ ...d, patient_name: '', study_date: '' }));
	}

	const manifest = {
		version: 1,
		exported_at: new Date().toISOString(),
		patient,
		case: c,
		plans,
		datasets,
		models,
		nerves: plans.flatMap((p) => listNerves(p.id)),
		implants: plans.flatMap((p) => listImplants(p.id)),
		measurements: plans.flatMap((p) => listMeasurements(p.id))
	};

	const entries: Record<string, Uint8Array> = {
		'case.json': new TextEncoder().encode(JSON.stringify(manifest, null, 1))
	};
	for (const d of datasets) {
		for (const p of [d.volume_path, d.preview_path]) {
			if (!p) continue;
			const f = Bun.file(resolveData(p));
			if (await f.exists()) entries[`files/${basename(p)}`] = new Uint8Array(await f.arrayBuffer());
		}
	}
	for (const m of models) {
		if (!m.file_path) continue;
		const f = Bun.file(resolveData(m.file_path));
		if (await f.exists())
			entries[`files/${basename(m.file_path)}`] = new Uint8Array(await f.arrayBuffer());
	}

	const zip = zipSync(entries, { level: 1 });
	const safeName = `${patient?.last_name ?? 'case'}_${caseId}`.replace(/[^\w-]+/g, '_');
	return new Response(zip.buffer as ArrayBuffer, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="codiagnostix_${safeName}.zip"`
		}
	});
};
