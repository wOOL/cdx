import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LIMITS, assertSize, unzipGuarded } from '$lib/server/uploadLimits';
import { basename, join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { caseRel, db, resolveData } from '$lib/server/db';
import { createPatient, deletePatient } from '$lib/server/db/repo';
import type { Case, Dataset, Model, Plan } from '$lib/types';

/** Import a case archive produced by /api/cases/[id]/export. */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No archive uploaded');

	assertSize(file, LIMITS.archive);
	const entries = unzipGuarded(new Uint8Array(await file.arrayBuffer()));
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
	const rel = caseRel(newCase.id);

	const written: string[] = [];
	const writeEntry = async (oldPath: string): Promise<string> => {
		const name = basename(oldPath);
		const data = entries[`files/${name}`];
		if (!data) return '';
		const newPath = join(rel, name);
		await Bun.write(resolveData(newPath), data);
		written.push(newPath);
		return newPath;
	};

	try {

	// datasets (numeric fields coerced — manifest values are untrusted)
	const dnum = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
	for (const d of (manifest.datasets ?? []) as Dataset[]) {
		const volPath = await writeEntry(d.volume_path);
		const prevPath = await writeEntry(d.preview_path);
		const cols = dnum(d.cols);
		const rows = dnum(d.rows);
		const slices = dnum(d.slices);
		if (cols < 1 || rows < 1 || slices < 1) continue;
		db.query(
			`INSERT INTO datasets (case_id, kind, description, cols, rows, slices,
				spacing_x, spacing_y, spacing_z, window_center, window_width,
				patient_name, study_date, modality, series_description,
				volume_path, preview_path, preview_cols, preview_rows, preview_slices, status)
			 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)`
		).run(
			newCase.id, d.kind, d.description, cols, rows, slices,
			dnum(d.spacing_x, 1), dnum(d.spacing_y, 1), dnum(d.spacing_z, 1),
			dnum(d.window_center, 400), dnum(d.window_width, 1800),
			d.patient_name, d.study_date, d.modality, d.series_description,
			volPath, prevPath, dnum(d.preview_cols), dnum(d.preview_rows), dnum(d.preview_slices), d.status
		);
	}

	// models (plan_id of guides is remapped after plans are created)
	const modelIdMap = new Map<number, number>();
	for (const m of (manifest.models ?? []) as Model[]) {
		const filePath = await writeEntry(m.file_path);
		const row = db
			.query(
				`INSERT INTO models (case_id, name, kind, file_path, color, opacity, visible, transform, params)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) RETURNING id`
			)
			.get(
				newCase.id, m.name, m.kind, filePath, m.color, m.opacity, m.visible,
				m.transform, m.params ?? ''
			) as { id: number };
		modelIdMap.set(m.id, row.id);
	}

	// plans + per-plan objects (remap plan ids)
	const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
	for (const pl of (manifest.plans ?? []) as Plan[]) {
		const newPlan = db
			.query(
				`INSERT INTO plans (case_id, name, is_master, locked, approved, pan_curve, settings, jaw)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8) RETURNING *`
			)
			.get(
				newCase.id, pl.name, pl.is_master, pl.locked, pl.approved, pl.pan_curve, pl.settings,
				pl.jaw === 'maxilla' ? 'maxilla' : 'mandible'
			) as Plan;
		// remap guide models that belonged to this plan
		for (const m of (manifest.models ?? []) as Model[]) {
			if (m.plan_id === pl.id && modelIdMap.has(m.id)) {
				db.query('UPDATE models SET plan_id = ?2 WHERE id = ?1').run(modelIdMap.get(m.id)!, newPlan.id);
			}
		}
		for (const n of manifest.nerves ?? []) {
			if (n.plan_id !== pl.id) continue;
			db.query(
				`INSERT INTO nerves (plan_id, name, color, diameter, points, visible) VALUES (?1,?2,?3,?4,?5,?6)`
			).run(newPlan.id, n.name, n.color, num(n.diameter, 2), n.points, n.visible);
		}
		for (const im of manifest.implants ?? []) {
			if (im.plan_id !== pl.id) continue;
			db.query(
				`INSERT INTO implants (plan_id, tooth, manufacturer, line, article, diameter, length,
					x, y, z, ax, ay, az, rotation, color, sleeve, abutment, visible)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`
			).run(
				newPlan.id, im.tooth, im.manufacturer, im.line, im.article,
				num(im.diameter, 4.1), num(im.length, 10),
				num(im.x), num(im.y), num(im.z), num(im.ax), num(im.ay), num(im.az, -1),
				num(im.rotation), im.color, im.sleeve ?? '', im.abutment ?? '', im.visible
			);
		}
		for (const me of manifest.measurements ?? []) {
			if (me.plan_id !== pl.id) continue;
			db.query(
				`INSERT INTO measurements (plan_id, type, points, value, label) VALUES (?1,?2,?3,?4,?5)`
			).run(newPlan.id, me.type, me.points, num(me.value), me.label);
		}
	}

	} catch (e) {
		// roll back: deleting the patient cascades through case/plans/rows and
		// removes the written files via deletePatient's cleanup
		try {
			deletePatient(patient.id);
		} catch {
			for (const f of written) await unlink(resolveData(f)).catch(() => {});
		}
		error(500, e instanceof Error ? `Import failed: ${e.message}` : 'Import failed');
	}

	return json({ caseId: newCase.id, patientId: patient.id });
};
