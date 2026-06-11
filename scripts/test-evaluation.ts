/**
 * Treatment Evaluation end-to-end test.
 *   bun scripts/test-evaluation.ts   (exit 0 = all pass; needs the dev server)
 *
 * Builds two synthetic meshes in code:
 *   - base 'scan': a random bumpy plane (the planning surface), and
 *   - postop mesh: the same plane (with the implant site cut out) plus a
 *     Ø4 × 10 mm cylinder planted at a KNOWN lateral offset and tilt versus
 *     the planned implant, then rigidly misaligned so the study's ICP
 *     registration has real work to do.
 *
 * Plants scratch DB rows (patient/case/plans/implant/models) with real STL
 * files under data/cases/<scratch>, runs the study via the live API (cookie
 * login) and asserts the measured deviations against the planted ground
 * truth. Cleans up rows + files in `finally`. Also asserts the HELP content
 * has every required topic key non-empty.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { meshToStlBinary } from '../src/lib/server/stl';
import { HELP } from '../src/lib/helpContent';

const BASE = process.env.CDX_BASE ?? 'http://localhost:5173';
const DATA_DIR = process.env.CDX_DATA_DIR ?? join(import.meta.dir, '..', 'data');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

/* ---------------- HELP content checks (pure) ---------------- */

const HELP_KEYS = [
	'dentaldb',
	'data',
	'align',
	'pano',
	'nerve',
	'implant',
	'sleeve',
	'guide',
	'report',
	'segmentation',
	'images',
	'inbox',
	'contacts',
	'settings',
	'account',
	'evaluation',
	'catalogs',
	'sleeves-admin',
	'designer'
];
{
	const missing = HELP_KEYS.filter(
		(k) =>
			!HELP[k] ||
			!HELP[k].title.trim() ||
			HELP[k].body.length === 0 ||
			HELP[k].body.some((p) => !p.trim())
	);
	check('HELP has all topic keys non-empty', missing.length === 0, missing.join(', ') || `${HELP_KEYS.length} keys`);
}

/* ---------------- synthetic geometry ---------------- */

type P3 = { x: number; y: number; z: number };

const SIZE = 48; // plane extent (mm)
const STEP = 0.8; // grid step (mm)

/** deterministic "random bumpy" height field */
function bumpZ(x: number, y: number): number {
	return 1.2 * Math.sin(0.5 * x) * Math.cos(0.45 * y) + 0.6 * Math.sin(1.3 * x + 0.7 * y);
}

/** triangle soup of the bumpy plane; cells whose centroid passes `skip` are omitted */
function buildPlane(skip?: (cx: number, cy: number) => boolean): number[] {
	const n = Math.round(SIZE / STEP);
	const coords: number[] = [];
	const push = (x: number, y: number) => coords.push(x, y, bumpZ(x, y));
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			const x0 = i * STEP;
			const y0 = j * STEP;
			const x1 = x0 + STEP;
			const y1 = y0 + STEP;
			if (skip && skip(x0 + STEP / 2, y0 + STEP / 2)) continue;
			// two triangles per cell
			push(x0, y0);
			push(x1, y0);
			push(x1, y1);
			push(x0, y0);
			push(x1, y1);
			push(x0, y1);
		}
	}
	return coords;
}

/** open cylinder soup around base + t·dir (t in [0, length]) */
function buildCylinder(
	base: P3,
	dir: P3,
	radius: number,
	length: number,
	segs: number,
	rows: number
): number[] {
	// orthonormal frame around dir
	const ax = Math.abs(dir.x);
	const ref: P3 = ax < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
	const cross = (a: P3, b: P3): P3 => ({
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x
	});
	const norm = (a: P3): P3 => {
		const l = Math.hypot(a.x, a.y, a.z) || 1;
		return { x: a.x / l, y: a.y / l, z: a.z / l };
	};
	const u = norm(cross(dir, ref));
	const v = norm(cross(dir, u));

	const pt = (t: number, theta: number): P3 => ({
		x: base.x + dir.x * t + radius * (u.x * Math.cos(theta) + v.x * Math.sin(theta)),
		y: base.y + dir.y * t + radius * (u.y * Math.cos(theta) + v.y * Math.sin(theta)),
		z: base.z + dir.z * t + radius * (u.z * Math.cos(theta) + v.z * Math.sin(theta))
	});

	const coords: number[] = [];
	const push = (p: P3) => coords.push(p.x, p.y, p.z);
	for (let r = 0; r < rows; r++) {
		const t0 = (r / rows) * length;
		const t1 = ((r + 1) / rows) * length;
		for (let s = 0; s < segs; s++) {
			const a0 = (s / segs) * Math.PI * 2;
			const a1 = ((s + 1) / segs) * Math.PI * 2;
			const p00 = pt(t0, a0);
			const p10 = pt(t0, a1);
			const p01 = pt(t1, a0);
			const p11 = pt(t1, a1);
			push(p00);
			push(p10);
			push(p11);
			push(p00);
			push(p11);
			push(p01);
		}
	}
	return coords;
}

/** bake a small rigid misalignment into coords: 2° about z around (24,24,0) + translation */
function misalign(coords: number[]): number[] {
	const ang = (2 * Math.PI) / 180;
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	const tx = 1.0;
	const ty = -0.7;
	const tz = 0.4;
	const out = coords.slice();
	for (let i = 0; i < out.length; i += 3) {
		const dx = out[i] - 24;
		const dy = out[i + 1] - 24;
		out[i] = 24 + c * dx - s * dy + tx;
		out[i + 1] = 24 + s * dx + c * dy + ty;
		out[i + 2] = out[i + 2] + tz;
	}
	return out;
}

/* ---------------- ground truth ---------------- */

const HEAD: P3 = { x: 24, y: 24, z: bumpZ(24, 24) }; // planned entry on the surface
const PLANNED_AXIS: P3 = { x: 0, y: 0, z: -1 }; // straight down into "bone"
const LENGTH = 10;

const OFFSET_MM = 1.2; // planted lateral entry offset (along +x)
const TILT_DEG = 6; // planted tilt (in the y-z plane, orthogonal to the offset)
const tiltRad = (TILT_DEG * Math.PI) / 180;
const ACHIEVED_ENTRY: P3 = { x: HEAD.x + OFFSET_MM, y: HEAD.y, z: HEAD.z };
const ACHIEVED_DIR: P3 = { x: 0, y: Math.sin(tiltRad), z: -Math.cos(tiltRad) };

// expected apex deviation at planned depth (achieved entry orthogonal to offset)
const EXP_APEX = Math.hypot(
	OFFSET_MM,
	LENGTH * Math.sin(tiltRad),
	LENGTH - LENGTH * Math.cos(tiltRad)
);

/* ---------------- HTTP helpers ---------------- */

let cookie = '';
async function api(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		...init,
		redirect: 'manual',
		headers: { origin: BASE, cookie, ...(init.headers ?? {}) }
	});
}

async function login(): Promise<boolean> {
	const r = await api('/login', {
		method: 'POST',
		headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			email: 'cdx@surrey.ac',
			password: 'devpassword1'
		}).toString()
	});
	const m = (r.headers.get('set-cookie') ?? '').match(/cdx_session=([^;]+)/);
	if (!m) return false;
	cookie = `cdx_session=${m[1]}`;
	return true;
}

/* ---------------- scratch DB rows + study run ---------------- */

const db = new Database(join(DATA_DIR, 'codiagnostix.db'));
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');

let patientId = 0;
let caseId = 0;
const studyIds: string[] = [];
let caseDir = '';

try {
	check('login as admin', await login());
	if (!cookie) throw new Error('no session — cannot run HTTP checks');

	// ---- scratch rows ----
	const patient = db
		.query(
			`INSERT INTO patients (external_id, first_name, last_name) VALUES (?1, ?2, ?3) RETURNING id`
		)
		.get(`eval-test-${Date.now().toString(36)}`, 'Eval', 'Scratch') as { id: number };
	patientId = patient.id;

	const caseRow = db
		.query(`INSERT INTO cases (patient_id, title) VALUES (?1, 'Evaluation scratch case') RETURNING id`)
		.get(patientId) as { id: number };
	caseId = caseRow.id;

	const planA = db
		.query(`INSERT INTO plans (case_id, name, is_master) VALUES (?1, 'Eval plan', 1) RETURNING id`)
		.get(caseId) as { id: number };
	const planB = db
		.query(`INSERT INTO plans (case_id, name) VALUES (?1, 'Eval plan degenerate') RETURNING id`)
		.get(caseId) as { id: number };

	// planned implant (plan A) at the ground-truth pose
	db.query(
		`INSERT INTO implants (plan_id, tooth, manufacturer, line, diameter, length, x, y, z, ax, ay, az)
		 VALUES (?1, '46', 'Generic', 'Test', 4.1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
	).run(planA.id, LENGTH, HEAD.x, HEAD.y, HEAD.z, PLANNED_AXIS.x, PLANNED_AXIS.y, PLANNED_AXIS.z);

	// plan B implant floats 30 mm above the surface → no mesh points near it
	db.query(
		`INSERT INTO implants (plan_id, tooth, manufacturer, line, diameter, length, x, y, z, ax, ay, az)
		 VALUES (?1, '36', 'Generic', 'Test', 4.1, ?2, ?3, ?4, ?5, 0, 0, -1)`
	).run(planB.id, LENGTH, HEAD.x, HEAD.y, HEAD.z + 30);

	// ---- mesh files ----
	caseDir = join(DATA_DIR, 'cases', String(caseId));
	mkdirSync(caseDir, { recursive: true });

	const baseCoords = buildPlane();
	const holed = buildPlane((cx, cy) => Math.hypot(cx - HEAD.x, cy - HEAD.y) < 5);
	const cyl = buildCylinder(ACHIEVED_ENTRY, ACHIEVED_DIR, 2.0, LENGTH, 24, 6);
	const postopCoords = misalign([...holed, ...cyl]);

	await Bun.write(
		join(caseDir, 'eval_base.stl'),
		meshToStlBinary(Float32Array.from(baseCoords), 'eval base')
	);
	await Bun.write(
		join(caseDir, 'eval_postop.stl'),
		meshToStlBinary(Float32Array.from(postopCoords), 'eval postop')
	);

	const baseModel = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path) VALUES (?1, 'Eval base scan', 'scan', ?2) RETURNING id`
		)
		.get(caseId, `cases/${caseId}/eval_base.stl`) as { id: number };
	const postopModel = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path) VALUES (?1, 'Eval postop model', 'other', ?2) RETURNING id`
		)
		.get(caseId, `cases/${caseId}/eval_postop.stl`) as { id: number };

	// ---- options endpoint ----
	const opts = await api(`/api/evaluation/options?caseId=${caseId}`);
	const optsBody = await opts.json();
	check(
		'GET /api/evaluation/options returns plans + models of the case',
		opts.ok &&
			optsBody.plans?.length === 2 &&
			optsBody.models?.some((m: { id: number }) => m.id === postopModel.id)
	);

	// ---- create study ----
	const create = await api('/api/evaluation', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: 'Eval e2e study',
			caseId,
			planId: planA.id,
			type: 'postopCT',
			modelId: postopModel.id
		})
	});
	const created = await create.json();
	check('POST /api/evaluation → 201', create.status === 201, JSON.stringify(created).slice(0, 200));
	const studyId: string = created?.study?.id ?? '';
	if (studyId) studyIds.push(studyId);
	check(
		'created study shape',
		!!created?.study &&
			created.study.name === 'Eval e2e study' &&
			created.study.caseId === caseId &&
			created.study.planId === planA.id &&
			created.study.type === 'postopCT' &&
			created.study.modelId === postopModel.id &&
			typeof created.study.createdAt === 'string'
	);

	const badCreate = await api('/api/evaluation', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'bad', caseId, planId: planA.id, type: 'nope', modelId: postopModel.id })
	});
	check('POST rejects bad study type → 400', badCreate.status === 400);

	// ---- run study A ----
	const run = await api(`/api/evaluation/${studyId}/run`, { method: 'POST' });
	const runBody = await run.json();
	check('POST /api/evaluation/[id]/run ok', run.ok, JSON.stringify(runBody).slice(0, 300));
	const result = runBody?.study?.result;
	check('result present with 1 implant row', !!result && result.implants?.length === 1);

	const dev = result?.implants?.[0] ?? {};
	const entry = dev.entryMM;
	const angle = dev.angleDeg;
	const apex = dev.apexMM;
	check('entry deviation is numeric', typeof entry === 'number', String(entry));
	if (typeof entry === 'number') {
		check(
			`entryMM within 0.6 mm of planted ${OFFSET_MM} mm offset`,
			Math.abs(entry - OFFSET_MM) <= 0.6,
			`measured ${entry.toFixed(3)} mm`
		);
	}
	if (typeof angle === 'number') {
		check(
			`angleDeg within 5° of planted ${TILT_DEG}° tilt`,
			Math.abs(angle - TILT_DEG) <= 5,
			`measured ${angle.toFixed(2)}°`
		);
	} else {
		check('angleDeg is numeric', false, String(angle));
	}
	if (typeof apex === 'number') {
		check(
			`apexMM near expected ${EXP_APEX.toFixed(2)} mm`,
			Math.abs(apex - EXP_APEX) <= 1.0,
			`measured ${apex.toFixed(3)} mm`
		);
	} else {
		check('apexMM is numeric', false, String(apex));
	}
	check(
		'ICP registration recovered the planted misalignment (rms < 1 mm)',
		typeof result?.alignedRmsICP === 'number' && result.alignedRmsICP < 1,
		`icp rms ${result?.alignedRmsICP}`
	);
	check('study rms equals single-implant entry rms', typeof result?.rms === 'number' && typeof entry === 'number' && Math.abs(result.rms - entry) < 1e-6);

	// ---- CSV ----
	const csvRes = await api(`/api/evaluation/${studyId}/csv`);
	const csvText = await csvRes.text();
	const csvLines = csvText.trim().split('\n');
	check(
		'CSV has header + 1 row',
		csvRes.ok &&
			(csvRes.headers.get('content-type') ?? '').includes('text/csv') &&
			csvLines.length === 2 &&
			csvLines[0] === 'tooth,entry_mm,apex_mm,angle_deg' &&
			csvLines[1].startsWith('46,'),
		csvLines.join(' | ')
	);
	check(
		'CSV served as attachment',
		(csvRes.headers.get('content-disposition') ?? '').startsWith('attachment')
	);

	// ---- degenerate sampling (plan B, implant far from any mesh) ----
	const createB = await api('/api/evaluation', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: 'Eval degenerate study',
			caseId,
			planId: planB.id,
			type: 'scanbody',
			modelId: postopModel.id
		})
	});
	const createdB = await createB.json();
	const studyBId: string = createdB?.study?.id ?? '';
	if (studyBId) studyIds.push(studyBId);
	const runB = await api(`/api/evaluation/${studyBId}/run`, { method: 'POST' });
	const runBBody = await runB.json();
	const devB = runBBody?.study?.result?.implants?.[0];
	check(
		"degenerate sampling (<30 points) → entry 'insufficient data'",
		runB.ok && devB?.entryMM === 'insufficient data' && devB?.apexMM === null && devB?.angleDeg === null,
		JSON.stringify(devB)
	);

	// ---- list join ----
	const list = await (await api('/api/evaluation')).json();
	const listed = list?.studies?.find((s: { id: string }) => s.id === studyId);
	check(
		'GET /api/evaluation joins case/plan/model names',
		!!listed &&
			listed.caseTitle === 'Evaluation scratch case' &&
			listed.planName === 'Eval plan' &&
			listed.modelName === 'Eval postop model' &&
			listed.patient.includes('Scratch'),
		JSON.stringify({ c: listed?.caseTitle, p: listed?.planName, m: listed?.modelName })
	);

	// ---- delete ----
	const del = await api(`/api/evaluation/${studyId}`, { method: 'DELETE' });
	check('DELETE /api/evaluation/[id] ok', del.ok);
	if (del.ok) studyIds.splice(studyIds.indexOf(studyId), 1);
	const after = await (await api('/api/evaluation')).json();
	check('deleted study gone from list', !after?.studies?.some((s: { id: string }) => s.id === studyId));
	check('CSV of deleted study → 404', (await api(`/api/evaluation/${studyId}/csv`)).status === 404);
} catch (e) {
	check(`unexpected error: ${e}`, false);
} finally {
	// remove remaining studies via the API (keeps evaluation_studies consistent)
	for (const id of studyIds) {
		await api(`/api/evaluation/${id}`, { method: 'DELETE' }).catch(() => {});
	}
	// remove scratch rows (patient cascades to cases/plans/implants/models)
	try {
		if (patientId) db.query('DELETE FROM patients WHERE id = ?1').run(patientId);
	} catch (e) {
		check(`cleanup: patient row removal failed: ${e}`, false);
	}
	// remove scratch files
	if (caseDir && existsSync(caseDir)) {
		try {
			rmSync(caseDir, { recursive: true, force: true });
		} catch (e) {
			check(`cleanup: case dir removal failed: ${e}`, false);
		}
	}
	db.close();
}

if (failures > 0) {
	console.error(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll evaluation checks passed');
