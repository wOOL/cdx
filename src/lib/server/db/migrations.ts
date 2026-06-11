import type { Database } from 'bun:sqlite';

/**
 * Sequential migrations applied via PRAGMA user_version.
 * Never edit an entry after it has shipped — append a new one.
 */
const MIGRATIONS: string[] = [
	// 1 — core schema
	`
	CREATE TABLE patients (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		external_id TEXT NOT NULL DEFAULT '',
		first_name TEXT NOT NULL DEFAULT '',
		last_name TEXT NOT NULL DEFAULT '',
		date_of_birth TEXT NOT NULL DEFAULT '',
		sex TEXT NOT NULL DEFAULT '',
		notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE cases (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
		title TEXT NOT NULL DEFAULT 'New case',
		status TEXT NOT NULL DEFAULT 'new',
		notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_cases_patient ON cases(patient_id);

	CREATE TABLE datasets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
		kind TEXT NOT NULL DEFAULT 'ct',
		description TEXT NOT NULL DEFAULT '',
		cols INTEGER NOT NULL DEFAULT 0,
		rows INTEGER NOT NULL DEFAULT 0,
		slices INTEGER NOT NULL DEFAULT 0,
		spacing_x REAL NOT NULL DEFAULT 1,
		spacing_y REAL NOT NULL DEFAULT 1,
		spacing_z REAL NOT NULL DEFAULT 1,
		window_center REAL NOT NULL DEFAULT 400,
		window_width REAL NOT NULL DEFAULT 1800,
		patient_name TEXT NOT NULL DEFAULT '',
		study_date TEXT NOT NULL DEFAULT '',
		modality TEXT NOT NULL DEFAULT '',
		series_description TEXT NOT NULL DEFAULT '',
		volume_path TEXT NOT NULL DEFAULT '',
		preview_path TEXT NOT NULL DEFAULT '',
		preview_cols INTEGER NOT NULL DEFAULT 0,
		preview_rows INTEGER NOT NULL DEFAULT 0,
		preview_slices INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'ready',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_datasets_case ON datasets(case_id);

	CREATE TABLE models (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
		name TEXT NOT NULL DEFAULT 'Model',
		kind TEXT NOT NULL DEFAULT 'scan',
		file_path TEXT NOT NULL DEFAULT '',
		color TEXT NOT NULL DEFAULT '#c8b89a',
		opacity REAL NOT NULL DEFAULT 1,
		visible INTEGER NOT NULL DEFAULT 1,
		transform TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_models_case ON models(case_id);

	CREATE TABLE plans (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
		name TEXT NOT NULL DEFAULT 'Plan 1',
		is_master INTEGER NOT NULL DEFAULT 0,
		locked INTEGER NOT NULL DEFAULT 0,
		approved INTEGER NOT NULL DEFAULT 0,
		pan_curve TEXT NOT NULL DEFAULT '',
		settings TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_plans_case ON plans(case_id);

	CREATE TABLE nerves (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
		name TEXT NOT NULL DEFAULT 'Nerve',
		color TEXT NOT NULL DEFAULT '#e8d44d',
		diameter REAL NOT NULL DEFAULT 2.0,
		points TEXT NOT NULL DEFAULT '[]',
		visible INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_nerves_plan ON nerves(plan_id);

	CREATE TABLE implants (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
		tooth TEXT NOT NULL DEFAULT '',
		manufacturer TEXT NOT NULL DEFAULT 'Generic',
		line TEXT NOT NULL DEFAULT '',
		article TEXT NOT NULL DEFAULT '',
		diameter REAL NOT NULL DEFAULT 4.1,
		length REAL NOT NULL DEFAULT 10,
		x REAL NOT NULL DEFAULT 0,
		y REAL NOT NULL DEFAULT 0,
		z REAL NOT NULL DEFAULT 0,
		ax REAL NOT NULL DEFAULT 0,
		ay REAL NOT NULL DEFAULT 0,
		az REAL NOT NULL DEFAULT -1,
		rotation REAL NOT NULL DEFAULT 0,
		color TEXT NOT NULL DEFAULT '#3aa757',
		sleeve TEXT NOT NULL DEFAULT '',
		visible INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_implants_plan ON implants(plan_id);

	CREATE TABLE measurements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
		type TEXT NOT NULL DEFAULT 'distance',
		points TEXT NOT NULL DEFAULT '[]',
		value REAL NOT NULL DEFAULT 0,
		label TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_measurements_plan ON measurements(plan_id);
	`,
	// 2 — app settings (key/value)
	`
	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT ''
	);
	`,
	// 3 — plan jaw + guide→plan linkage
	`
	ALTER TABLE plans ADD COLUMN jaw TEXT NOT NULL DEFAULT 'mandible';
	ALTER TABLE models ADD COLUMN plan_id INTEGER;
	`,
	// 4 — user accounts + sessions
	`
	CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		name TEXT NOT NULL DEFAULT '',
		work_mode TEXT NOT NULL DEFAULT 'expert',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE TABLE sessions (
		token TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_sessions_user ON sessions(user_id);
	`,
	// 5 — image management (view snapshots per patient/case)
	`
	CREATE TABLE images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
		case_id INTEGER REFERENCES cases(id) ON DELETE SET NULL,
		name TEXT NOT NULL DEFAULT 'Snapshot',
		file_path TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_images_patient ON images(patient_id);
	`,
	// 6 — model generation parameters (e.g. segmentation threshold)
	`
	ALTER TABLE models ADD COLUMN params TEXT NOT NULL DEFAULT '';
	`,
	// 7 — abutment planning per implant
	`
	ALTER TABLE implants ADD COLUMN abutment TEXT NOT NULL DEFAULT '';
	`
];

export function migrate(db: Database): void {
	const row = db.query('PRAGMA user_version').get() as { user_version: number } | null;
	let version = row?.user_version ?? 0;
	while (version < MIGRATIONS.length) {
		const sql = MIGRATIONS[version];
		db.transaction(() => {
			db.exec(sql);
		})();
		version += 1;
		db.exec(`PRAGMA user_version = ${version}`);
	}
}
