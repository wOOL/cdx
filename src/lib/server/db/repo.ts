import { db } from './index';
import type { Case, Dataset, Implant, Measurement, Model, Nerve, Patient, Plan } from '$lib/types';

// ---------- patients ----------

export function listPatients(search = ''): Patient[] {
	if (search.trim()) {
		const q = `%${search.trim()}%`;
		return db
			.query(
				`SELECT * FROM patients
				 WHERE first_name LIKE ?1 OR last_name LIKE ?1 OR external_id LIKE ?1
				 ORDER BY last_name, first_name`
			)
			.all(q) as Patient[];
	}
	return db.query('SELECT * FROM patients ORDER BY last_name, first_name').all() as Patient[];
}

export function getPatient(id: number): Patient | null {
	return (db.query('SELECT * FROM patients WHERE id = ?1').get(id) as Patient) ?? null;
}

export function createPatient(p: Partial<Patient>): Patient {
	const row = db
		.query(
			`INSERT INTO patients (external_id, first_name, last_name, date_of_birth, sex, notes)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`
		)
		.get(
			p.external_id ?? '',
			p.first_name ?? '',
			p.last_name ?? '',
			p.date_of_birth ?? '',
			p.sex ?? '',
			p.notes ?? ''
		) as Patient;
	return row;
}

export function updatePatient(id: number, p: Partial<Patient>): void {
	db.query(
		`UPDATE patients SET
			external_id = ?2, first_name = ?3, last_name = ?4,
			date_of_birth = ?5, sex = ?6, notes = ?7,
			updated_at = datetime('now')
		 WHERE id = ?1`
	).run(
		id,
		p.external_id ?? '',
		p.first_name ?? '',
		p.last_name ?? '',
		p.date_of_birth ?? '',
		p.sex ?? '',
		p.notes ?? ''
	);
}

export function deletePatient(id: number): void {
	db.query('DELETE FROM patients WHERE id = ?1').run(id);
}

// ---------- cases ----------

export function listCasesForPatient(patientId: number): Case[] {
	return db
		.query('SELECT * FROM cases WHERE patient_id = ?1 ORDER BY created_at DESC')
		.all(patientId) as Case[];
}

export function getCase(id: number): Case | null {
	return (db.query('SELECT * FROM cases WHERE id = ?1').get(id) as Case) ?? null;
}

export function createCase(patientId: number, title: string): Case {
	const c = db
		.query(`INSERT INTO cases (patient_id, title) VALUES (?1, ?2) RETURNING *`)
		.get(patientId, title || 'New case') as Case;
	// every case gets a master plan
	db.query(`INSERT INTO plans (case_id, name, is_master) VALUES (?1, 'Master plan', 1)`).run(c.id);
	return c;
}

export function updateCase(id: number, fields: Partial<Case>): void {
	const current = getCase(id);
	if (!current) return;
	db.query(
		`UPDATE cases SET title = ?2, status = ?3, notes = ?4, updated_at = datetime('now') WHERE id = ?1`
	).run(id, fields.title ?? current.title, fields.status ?? current.status, fields.notes ?? current.notes);
}

export function deleteCase(id: number): void {
	db.query('DELETE FROM cases WHERE id = ?1').run(id);
}

export function touchCase(id: number): void {
	db.query(`UPDATE cases SET updated_at = datetime('now') WHERE id = ?1`).run(id);
}

// ---------- datasets ----------

export function listDatasets(caseId: number): Dataset[] {
	return db
		.query('SELECT * FROM datasets WHERE case_id = ?1 ORDER BY created_at DESC')
		.all(caseId) as Dataset[];
}

export function getDataset(id: number): Dataset | null {
	return (db.query('SELECT * FROM datasets WHERE id = ?1').get(id) as Dataset) ?? null;
}

export function createDataset(d: Omit<Partial<Dataset>, 'id'> & { case_id: number }): Dataset {
	return db
		.query(
			`INSERT INTO datasets (
				case_id, kind, description, cols, rows, slices,
				spacing_x, spacing_y, spacing_z, window_center, window_width,
				patient_name, study_date, modality, series_description,
				volume_path, preview_path, preview_cols, preview_rows, preview_slices, status
			) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)
			RETURNING *`
		)
		.get(
			d.case_id,
			d.kind ?? 'ct',
			d.description ?? '',
			d.cols ?? 0,
			d.rows ?? 0,
			d.slices ?? 0,
			d.spacing_x ?? 1,
			d.spacing_y ?? 1,
			d.spacing_z ?? 1,
			d.window_center ?? 400,
			d.window_width ?? 1800,
			d.patient_name ?? '',
			d.study_date ?? '',
			d.modality ?? '',
			d.series_description ?? '',
			d.volume_path ?? '',
			d.preview_path ?? '',
			d.preview_cols ?? 0,
			d.preview_rows ?? 0,
			d.preview_slices ?? 0,
			d.status ?? 'ready'
		) as Dataset;
}

export function deleteDataset(id: number): void {
	db.query('DELETE FROM datasets WHERE id = ?1').run(id);
}

// ---------- plans ----------

export function listPlans(caseId: number): Plan[] {
	return db
		.query('SELECT * FROM plans WHERE case_id = ?1 ORDER BY is_master DESC, created_at')
		.all(caseId) as Plan[];
}

export function getPlan(id: number): Plan | null {
	return (db.query('SELECT * FROM plans WHERE id = ?1').get(id) as Plan) ?? null;
}

export function getMasterPlan(caseId: number): Plan {
	let plan = db
		.query('SELECT * FROM plans WHERE case_id = ?1 ORDER BY is_master DESC, created_at LIMIT 1')
		.get(caseId) as Plan | null;
	if (!plan) {
		plan = db
			.query(`INSERT INTO plans (case_id, name, is_master) VALUES (?1, 'Master plan', 1) RETURNING *`)
			.get(caseId) as Plan;
	}
	return plan;
}

export function updatePlan(id: number, fields: Partial<Plan>): void {
	const current = getPlan(id);
	if (!current) return;
	db.query(
		`UPDATE plans SET name = ?2, locked = ?3, approved = ?4, pan_curve = ?5, settings = ?6,
		 updated_at = datetime('now') WHERE id = ?1`
	).run(
		id,
		fields.name ?? current.name,
		fields.locked ?? current.locked,
		fields.approved ?? current.approved,
		fields.pan_curve ?? current.pan_curve,
		fields.settings ?? current.settings
	);
}

// ---------- models / nerves / implants / measurements ----------

export function listModels(caseId: number): Model[] {
	return db.query('SELECT * FROM models WHERE case_id = ?1 ORDER BY created_at').all(caseId) as Model[];
}

export function listNerves(planId: number): Nerve[] {
	return db.query('SELECT * FROM nerves WHERE plan_id = ?1 ORDER BY created_at').all(planId) as Nerve[];
}

export function listImplants(planId: number): Implant[] {
	return db
		.query('SELECT * FROM implants WHERE plan_id = ?1 ORDER BY created_at')
		.all(planId) as Implant[];
}

export function listMeasurements(planId: number): Measurement[] {
	return db
		.query('SELECT * FROM measurements WHERE plan_id = ?1 ORDER BY created_at')
		.all(planId) as Measurement[];
}
