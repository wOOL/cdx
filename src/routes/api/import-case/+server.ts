import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unzipSync } from 'fflate';
import { basename, join } from 'node:path';
import { caseDir, db } from '$lib/server/db';
import { createPatient } from '$lib/server/db/repo';
import type { Case, Dataset, Model, Plan } from '$lib/types';

/** Import a case archive produced by /api/cases/[id]/export. */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No archive uploaded');

	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
	} catch {
		error(400, 'Not a valid zip archive');
	}
	const manifestRaw = entries['case.json'];
	if (!manifestRaw) error(400, 'case.json missing — not a coDiagnostiX Web archive');
	let manifest;
	try {
		manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
	} catch {
		error(400, 'Corrupt case.json');
	}
	if (manifest.version !== 1) error(400, `Unsupported archive version ${manifest.version}`);

	// recreate patient + case
	const p = manifest.patient ?? {};
	const patient = createPatient({
		external_id: p.external_id ?? '',
		first_name: p.first_name ?? '',
		last_name: p.last_name ?? `Imported ${new Date().toISOString().slice(0, 10)}`,
		date_of_birth: p.date_of_birth ?? '',
		sex: p.sex ?? '',
		notes: p.notes ?? ''
	});
	const src = manifest.case as Case;
	const newCase = db
		.query(`INSERT INTO cases (patient_id, title, status, notes) VALUES (?1, ?2, ?3, ?4) RETURNING *`)
		.get(patient.id, `${src.title} (imported)`, src.status, src.notes ?? '') as Case;
	const dir = caseDir(newCase.id);

	const writeEntry = async (oldPath: string): Promise<string> => {
		const name = basename(oldPath);
		const data = entries[`files/${name}`];
		if (!data) return '';
		const newPath = join(dir, name);
		await Bun.write(newPath, data);
		return newPath;
	};

	// datasets
	for (const d of (manifest.datasets ?? []) as Dataset[]) {
		const volPath = await writeEntry(d.volume_path);
		const prevPath = await writeEntry(d.preview_path);
		db.query(
			`INSERT INTO datasets (case_id, kind, description, cols, rows, slices,
				spacing_x, spacing_y, spacing_z, window_center, window_width,
				patient_name, study_date, modality, series_description,
				volume_path, preview_path, preview_cols, preview_rows, preview_slices, status)
			 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)`
		).run(
			newCase.id, d.kind, d.description, d.cols, d.rows, d.slices,
			d.spacing_x, d.spacing_y, d.spacing_z, d.window_center, d.window_width,
			d.patient_name, d.study_date, d.modality, d.series_description,
			volPath, prevPath, d.preview_cols, d.preview_rows, d.preview_slices, d.status
		);
	}

	// models
	for (const m of (manifest.models ?? []) as Model[]) {
		const filePath = await writeEntry(m.file_path);
		db.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, opacity, visible, transform)
			 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
		).run(newCase.id, m.name, m.kind, filePath, m.color, m.opacity, m.visible, m.transform);
	}

	// plans + per-plan objects (remap plan ids)
	for (const pl of (manifest.plans ?? []) as Plan[]) {
		const newPlan = db
			.query(
				`INSERT INTO plans (case_id, name, is_master, locked, approved, pan_curve, settings)
				 VALUES (?1,?2,?3,?4,?5,?6,?7) RETURNING *`
			)
			.get(newCase.id, pl.name, pl.is_master, pl.locked, pl.approved, pl.pan_curve, pl.settings) as Plan;
		for (const n of manifest.nerves ?? []) {
			if (n.plan_id !== pl.id) continue;
			db.query(
				`INSERT INTO nerves (plan_id, name, color, diameter, points, visible) VALUES (?1,?2,?3,?4,?5,?6)`
			).run(newPlan.id, n.name, n.color, n.diameter, n.points, n.visible);
		}
		for (const im of manifest.implants ?? []) {
			if (im.plan_id !== pl.id) continue;
			db.query(
				`INSERT INTO implants (plan_id, tooth, manufacturer, line, article, diameter, length,
					x, y, z, ax, ay, az, rotation, color, sleeve, visible)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`
			).run(
				newPlan.id, im.tooth, im.manufacturer, im.line, im.article, im.diameter, im.length,
				im.x, im.y, im.z, im.ax, im.ay, im.az, im.rotation, im.color, im.sleeve, im.visible
			);
		}
		for (const me of manifest.measurements ?? []) {
			if (me.plan_id !== pl.id) continue;
			db.query(
				`INSERT INTO measurements (plan_id, type, points, value, label) VALUES (?1,?2,?3,?4,?5)`
			).run(newPlan.id, me.type, me.points, me.value, me.label);
		}
	}

	return json({ caseId: newCase.id, patientId: patient.id });
};
