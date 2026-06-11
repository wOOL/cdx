/**
 * AI-assistant review wizard test (AiReviewWizard + /api/datasets/[id]/ai-review):
 *
 *  Part A — pure data mapping ($lib/aiReviewMap, no server):
 *   - FDI chart rows (upper 18→28, lower 48→38),
 *   - classifyAiModel over both backends' model names (vendor + heuristic),
 *     cross-checked against the vendor pipeline's own toothFdi for all 32
 *     tooth classes,
 *   - canalCenterline on a synthetic canal tube mesh (accuracy, ordering,
 *     transform handling, degenerate rejection),
 *   - validateReviewApply payload validation,
 *   - rotationMatrix parity with $lib/server/resample.
 *
 *  Part B — endpoint bundle/apply against the dev server (:5173, dev admin):
 *   - scratch patient/case/dataset + model rows (tooth STL, canal tube STL,
 *     empty surface, registered scan),
 *   - GET bundle: model metadata incl. ok flags + FDI mapping, canal
 *     centerline proposal, scans, plan resolution,
 *   - POST apply: pano + nerve persistence, nerve upsert (no duplicate rows),
 *     validation 400s, locked-plan 409, unknown dataset 404.
 *
 *   bun scripts/test-aireview.ts
 *
 * Scratch DB rows/files are removed in the finally block.
 */
import { join } from 'node:path';
import { DATA_DIR, db } from '../src/lib/server/db';
import { createCase, createDataset, createPatient, deletePatient, getMasterPlan, updatePlan } from '../src/lib/server/db/repo';
import { meshToStlBinary } from '../src/lib/server/stl';
import { rotationMatrix as serverRotationMatrix } from '../src/lib/server/resample';
import { CLASS_LEGEND, toothFdi } from '../src/lib/server/aiSegVendor';
import {
	FDI_LOWER,
	FDI_UPPER,
	canalCenterline,
	classifyAiModel,
	fdiFromClassName,
	rotateAboutCenter,
	rotationMatrix,
	validateReviewApply,
	type Vec3
} from '../src/lib/aiReviewMap';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const EMAIL = 'cdx@surrey.ac';
const PASSWORD = 'devpassword1';

db.exec('PRAGMA busy_timeout = 3000');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

/* ================= Part A — pure mapping ================= */

console.log('--- FDI chart ---');
check('upper row has 16 positions 18→…→28', FDI_UPPER.length === 16 && FDI_UPPER[0] === 18 && FDI_UPPER[7] === 11 && FDI_UPPER[8] === 21 && FDI_UPPER[15] === 28);
check('lower row has 16 positions 48→…→38', FDI_LOWER.length === 16 && FDI_LOWER[0] === 48 && FDI_LOWER[7] === 41 && FDI_LOWER[8] === 31 && FDI_LOWER[15] === 38);
check(
	'all 32 chart entries are valid FDI numbers',
	[...FDI_UPPER, ...FDI_LOWER].every((n) => Math.floor(n / 10) >= 1 && Math.floor(n / 10) <= 4 && n % 10 >= 1 && n % 10 <= 8)
);

console.log('--- classifyAiModel ---');
{
	const t = classifyAiModel('AI — Tooth 23', { class: 'Upper Left Canine', fdi: 23 });
	check('vendor tooth row → tooth/23/upper', t.kind === 'tooth' && t.fdi === 23 && t.arch === 'upper');
	const t2 = classifyAiModel('AI — Tooth 36');
	check('tooth from name alone → tooth/36/lower', t2.kind === 'tooth' && t2.fdi === 36 && t2.arch === 'lower');
	const md = classifyAiModel('AI — Mandible', { class: 'Lower Jawbone' });
	check('mandible → jaw/lower', md.kind === 'jaw' && md.arch === 'lower' && md.label === 'Mandible');
	const mx = classifyAiModel('AI — Maxilla');
	check('maxilla → jaw/upper', mx.kind === 'jaw' && mx.arch === 'upper');
	const cl = classifyAiModel('AI — L inferior alveolar canal', { class: 'Left Inferior Alveolar Canal' });
	check('left canal → canal/left', cl.kind === 'canal' && cl.side === 'left' && cl.label === 'Left nerve canal');
	const cr = classifyAiModel('AI — R inferior alveolar canal');
	check('right canal (name only) → canal/right', cr.kind === 'canal' && cr.side === 'right');
	const si = classifyAiModel('AI — Left Maxillary Sinus', { class: 'Left Maxillary Sinus' });
	check('sinus beats maxilla-substring → sinus/left', si.kind === 'sinus' && si.side === 'left');
	const so = classifyAiModel('AI — Soft tissue');
	check('soft tissue → soft', so.kind === 'soft');
	const bone = classifyAiModel('AI — Bone');
	check("heuristic 'AI — Bone' → other (no fdi)", bone.kind === 'other' && bone.fdi === null && bone.label === 'Bone');
	const teeth = classifyAiModel('AI — Teeth');
	check("heuristic 'AI — Teeth' → other, NOT a tooth", teeth.kind === 'other' && teeth.fdi === null);
	const ph = classifyAiModel('AI — Pharynx');
	check('pharynx → other', ph.kind === 'other');
}

{
	// cross-check fdiFromClassName against the vendor pipeline for all classes
	let mismatches = 0;
	let toothCount = 0;
	for (const cls of Object.keys(CLASS_LEGEND)) {
		const expected = toothFdi(cls);
		const got = fdiFromClassName(cls);
		if (expected != null) toothCount++;
		if (expected !== got) mismatches++;
	}
	check('fdiFromClassName matches vendor toothFdi for all 42 classes', mismatches === 0, `${toothCount} tooth classes`);
}

console.log('--- canalCenterline ---');

/** Tube mesh (triangle soup) of radius r around a parametric centerline. */
function tubeMesh(center: (t: number) => Vec3, r: number, rings = 24, seg = 8): Float32Array {
	const ringPts: Vec3[][] = [];
	for (let i = 0; i <= rings; i++) {
		const t = i / rings;
		const c = center(t);
		const c2 = center(Math.min(1, t + 0.01));
		// frame perpendicular to the local direction
		let dx = c2.x - c.x;
		let dy = c2.y - c.y;
		let dz = c2.z - c.z;
		const dl = Math.hypot(dx, dy, dz) || 1;
		dx /= dl; dy /= dl; dz /= dl;
		// u = d × z (fallback d × y)
		let ux = dy, uy = -dx, uz = 0;
		const ul = Math.hypot(ux, uy, uz);
		if (ul < 1e-6) { ux = 0; uy = dz; uz = -dy; }
		const ul2 = Math.hypot(ux, uy, uz) || 1;
		ux /= ul2; uy /= ul2; uz /= ul2;
		const vx = dy * uz - dz * uy;
		const vy = dz * ux - dx * uz;
		const vz = dx * uy - dy * ux;
		const ring: Vec3[] = [];
		for (let s = 0; s < seg; s++) {
			const a = (2 * Math.PI * s) / seg;
			ring.push({
				x: c.x + r * (Math.cos(a) * ux + Math.sin(a) * vx),
				y: c.y + r * (Math.cos(a) * uy + Math.sin(a) * vy),
				z: c.z + r * (Math.cos(a) * uz + Math.sin(a) * vz)
			});
		}
		ringPts.push(ring);
	}
	const tris: number[] = [];
	for (let i = 0; i < rings; i++) {
		for (let s = 0; s < seg; s++) {
			const a = ringPts[i][s];
			const b = ringPts[i][(s + 1) % seg];
			const c = ringPts[i + 1][s];
			const d = ringPts[i + 1][(s + 1) % seg];
			tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
			tris.push(b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
		}
	}
	return new Float32Array(tris);
}

const canalPath = (t: number): Vec3 => ({ x: 10 + 22 * t, y: 12 + 5 * Math.sin(Math.PI * t), z: 10 + 3 * t });
const tube = tubeMesh(canalPath, 1.4);

function distToPath(p: Vec3): number {
	let best = Infinity;
	for (let i = 0; i <= 200; i++) {
		const c = canalPath(i / 200);
		const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
		if (d < best) best = d;
	}
	return best;
}

{
	const line = canalCenterline(tube, null, 12);
	check('centerline returned', !!line && line.length >= 4, `${line?.length ?? 0} points`);
	if (line) {
		const worst = Math.max(...line.map(distToPath));
		check('all centerline points within 1.5 mm of the true path', worst <= 1.5, `worst ${worst.toFixed(2)} mm`);
		let monotonic = true;
		for (let i = 1; i < line.length; i++) if (line[i].x <= line[i - 1].x && line[0].x < line[line.length - 1].x) monotonic = false;
		check('points are ordered along the canal', monotonic);
	}
	// translation via column-major transform
	const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, -3, 2, 1];
	const moved = canalCenterline(tube, T, 12);
	check(
		'transform is applied (translation +5/−3/+2)',
		!!moved && !!line && Math.abs(moved[0].x - line[0].x - 5) < 0.2 && Math.abs(moved[0].y - line[0].y + 3) < 0.2 && Math.abs(moved[0].z - line[0].z - 2) < 0.2
	);
	check('degenerate mesh → null', canalCenterline(new Float32Array(9).fill(1), null, 12) === null);
}

console.log('--- validateReviewApply ---');
{
	const good = validateReviewApply({
		planId: 7,
		pano: { control: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 5 }], z: 12.4 },
		nerves: { left: { points: [{ x: 1, y: 2, z: 3 }, { x: 2, y: 3, z: 4 }] } }
	});
	check('valid payload accepted', good.ok);
	if (good.ok) {
		check('z is rounded to a slice index', good.value.pano?.z === 12);
		check('nerve diameter defaults to 2 mm', good.value.nerves?.left?.diameter === 2);
	}
	check('empty payload rejected', !validateReviewApply({}).ok);
	check('non-object rejected', !validateReviewApply('x').ok);
	check('1-point curve rejected', !validateReviewApply({ pano: { control: [{ x: 1, y: 2 }], z: 0 } }).ok);
	check('NaN coordinate rejected', !validateReviewApply({ pano: { control: [{ x: NaN, y: 2 }, { x: 1, y: 1 }], z: 0 } }).ok);
	check("bad nerve side 'center' rejected", !validateReviewApply({ nerves: { center: { points: [{ x: 1, y: 2, z: 3 }, { x: 2, y: 3, z: 4 }] } } }).ok);
	check('1-point nerve rejected', !validateReviewApply({ nerves: { left: { points: [{ x: 1, y: 2, z: 3 }] } } }).ok);
	check('diameter 99 rejected', !validateReviewApply({ nerves: { left: { points: [{ x: 1, y: 2, z: 3 }, { x: 2, y: 3, z: 4 }], diameter: 99 } } }).ok);
	check('fractional planId rejected', !validateReviewApply({ planId: 1.5, pano: { control: [{ x: 1, y: 2 }, { x: 3, y: 4 }], z: 0 } }).ok);
}

console.log('--- rotation convention ---');
{
	const a = rotationMatrix(17, -8, 5);
	const b = serverRotationMatrix(17, -8, 5);
	const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
	check('rotationMatrix matches $lib/server/resample', diff < 1e-12, `max diff ${diff.toExponential(1)}`);
	const c = { x: 10, y: 10, z: 10 };
	const p = rotateAboutCenter(rotationMatrix(90, 0, 0), c, { x: 11, y: 10, z: 10 });
	check('rotateAboutCenter: 90° yaw moves +x offset onto ±y', Math.abs(Math.abs(p.y - c.y) - 1) < 1e-9 && Math.abs(p.x - c.x) < 1e-9);
}

/* ================= Part B — endpoint tests ================= */

let cookie = '';
async function login(): Promise<boolean> {
	const form = new FormData();
	form.set('email', EMAIL);
	form.set('password', PASSWORD);
	const res = await fetch(`${BASE}/login`, { method: 'POST', body: form, redirect: 'manual' });
	for (const c of res.headers.getSetCookie()) {
		const m = c.match(/cdx_session=([^;]+)/);
		if (m) cookie = `cdx_session=${m[1]}`;
	}
	return (res.status === 303 || res.ok) && cookie !== '';
}

function api(path: string, method = 'GET', body?: unknown): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		method,
		headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
		body: body !== undefined ? JSON.stringify(body) : undefined,
		redirect: 'manual'
	});
}

function insertModel(
	caseId: number,
	name: string,
	kind: string,
	filePath: string,
	params: unknown,
	transform: number[] | null = null
): number {
	const row = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, params, transform)
			 VALUES (?1, ?2, ?3, ?4, '#cbbf9a', ?5, ?6) RETURNING id`
		)
		.get(caseId, name, kind, filePath, JSON.stringify(params), transform ? JSON.stringify(transform) : '') as { id: number };
	return row.id;
}

function cube(cx: number, cy: number, cz: number, s: number): Float32Array {
	const h = s / 2;
	const v = [
		[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
		[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]
	].map(([x, y, z]) => [cx + x, cy + y, cz + z]);
	const faces = [
		[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
		[1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]
	];
	const out: number[] = [];
	for (const f of faces) for (const i of f) out.push(...v[i]);
	return new Float32Array(out);
}

console.log('--- endpoint tests ---');
const auditMaxBefore = (db.query('SELECT COALESCE(MAX(id), 0) AS m FROM audit').get() as { m: number }).m;
let scratchPatientId: number | null = null;

try {
	check('login (cookie jar)', await login());

	const patient = createPatient({ first_name: 'Scratch', last_name: 'AiReview' });
	scratchPatientId = patient.id;
	const kase = createCase(patient.id, 'ai-review test');
	const caseDirRel = join('cases', String(kase.id));

	const N = 48;
	const vol = new Int16Array(N * N * N).fill(-1000);
	await Bun.write(join(DATA_DIR, caseDirRel, 'ar_vol.i16'), new Uint8Array(vol.buffer));
	const ds = createDataset({
		case_id: kase.id,
		kind: 'ct',
		description: 'ai-review scratch volume',
		cols: N, rows: N, slices: N,
		spacing_x: 0.5, spacing_y: 0.5, spacing_z: 0.5,
		modality: 'CT',
		volume_path: join(caseDirRel, 'ar_vol.i16')
	});
	const plan = getMasterPlan(kase.id);

	// model rows: tooth, canal tube, empty surface, registered scan
	const toothRel = join(caseDirRel, 'ar_tooth.stl');
	await Bun.write(join(DATA_DIR, toothRel), meshToStlBinary(cube(12, 12, 12, 5), 'tooth'));
	const toothId = insertModel(kase.id, 'AI — Tooth 36', 'segmentation', toothRel, {
		ai: true, vendor: true, class: 'Lower Left First Molar', fdi: 36, dataset_id: ds.id
	});

	const canalRel = join(caseDirRel, 'ar_canal.stl');
	await Bun.write(join(DATA_DIR, canalRel), meshToStlBinary(tube, 'canal'));
	const canalId = insertModel(kase.id, 'AI — L inferior alveolar canal', 'segmentation', canalRel, {
		ai: true, vendor: true, class: 'Left Inferior Alveolar Canal', dataset_id: ds.id
	});

	const emptyRel = join(caseDirRel, 'ar_empty.stl');
	await Bun.write(join(DATA_DIR, emptyRel), meshToStlBinary(new Float32Array(0), 'empty'));
	const emptyId = insertModel(kase.id, 'AI — Maxilla', 'segmentation', emptyRel, {
		ai: true, vendor: true, class: 'Upper Jawbone', dataset_id: ds.id
	});

	const scanRel = join(caseDirRel, 'ar_scan.stl');
	await Bun.write(join(DATA_DIR, scanRel), meshToStlBinary(cube(15, 15, 15, 8), 'scan'));
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	const scanId = insertModel(kase.id, 'Model scan (registered)', 'scan', scanRel, {}, identity);

	/* ---- GET bundle ---- */
	let res = await api(`/api/datasets/${ds.id}/ai-review`);
	check('GET bundle → 200', res.status === 200, `status ${res.status}`);
	const bundle = (await res.json()) as {
		dataset: { id: number; caseId: number; cols: number; spacing: { x: number } };
		plan: { id: number; locked: boolean };
		models: { id: number; name: string; ok: boolean; objectKind: string; fdi: number | null; side: string | null; kind: string }[];
		canals: { modelId: number; side: string; points: Vec3[] }[];
		pano: { control: { x: number; y: number }[]; z: number } | null;
		scans: { id: number; transform: number[] }[];
	};
	check('bundle dataset geometry', bundle.dataset.id === ds.id && bundle.dataset.cols === N && bundle.dataset.spacing.x === 0.5);
	check('bundle resolves the master plan', bundle.plan.id === plan.id && bundle.plan.locked === false);
	const bTooth = bundle.models.find((m) => m.id === toothId);
	check('tooth row: ok + objectKind/fdi mapped', !!bTooth && bTooth.ok && bTooth.objectKind === 'tooth' && bTooth.fdi === 36);
	const bEmpty = bundle.models.find((m) => m.id === emptyId);
	check('empty surface row: ok=false', !!bEmpty && bEmpty.ok === false);
	const bCanalRow = bundle.models.find((m) => m.id === canalId);
	check('canal row: objectKind canal / side left', !!bCanalRow && bCanalRow.objectKind === 'canal' && bCanalRow.side === 'left');
	const bCanal = bundle.canals.find((c) => c.modelId === canalId);
	check('canal centerline proposal present', !!bCanal && bCanal.side === 'left' && bCanal.points.length >= 4, `${bCanal?.points.length ?? 0} points`);
	if (bCanal) {
		const worst = Math.max(...bCanal.points.map(distToPath));
		check('server centerline within 1.5 mm of the tube path', worst <= 1.5, `worst ${worst.toFixed(2)} mm`);
	}
	check('pano is null before review', bundle.pano === null);
	check('registered scan listed', bundle.scans.length === 1 && bundle.scans[0].id === scanId && bundle.scans[0].transform.length === 16);

	/* ---- POST apply ---- */
	const control = [{ x: 5, y: 18 }, { x: 12, y: 8 }, { x: 19, y: 18 }];
	const nervePts = [{ x: 10, y: 12, z: 10 }, { x: 16, y: 15, z: 11 }, { x: 22, y: 13, z: 12 }];
	res = await api(`/api/datasets/${ds.id}/ai-review`, 'POST', {
		planId: plan.id,
		pano: { control, z: 20 },
		nerves: { left: { points: nervePts } }
	});
	check('POST apply → 200', res.status === 200, `status ${res.status}`);
	const applied = (await res.json()) as { ok: boolean; planId: number; applied: { pano: boolean; nerves: string[] } };
	check('apply summary', applied.ok && applied.planId === plan.id && applied.applied.pano && applied.applied.nerves.includes('left'));

	const planRow = db.query('SELECT pan_curve FROM plans WHERE id = ?1').get(plan.id) as { pan_curve: string };
	const savedCurve = JSON.parse(planRow.pan_curve);
	check('pan_curve persisted (control + z)', savedCurve.control.length === 3 && savedCurve.z === 20);

	let nerveRows = db.query("SELECT * FROM nerves WHERE plan_id = ?1 AND name = 'Left nerve canal'").all(plan.id) as {
		id: number; points: string; diameter: number;
	}[];
	check('nerve row created with default diameter', nerveRows.length === 1 && JSON.parse(nerveRows[0].points).length === 3 && nerveRows[0].diameter === 2);

	// upsert: second apply must update, not duplicate
	res = await api(`/api/datasets/${ds.id}/ai-review`, 'POST', {
		planId: plan.id,
		nerves: { left: { points: [...nervePts, { x: 25, y: 12, z: 12 }], diameter: 2.5 } }
	});
	check('second apply → 200', res.status === 200);
	nerveRows = db.query("SELECT * FROM nerves WHERE plan_id = ?1 AND name = 'Left nerve canal'").all(plan.id) as {
		id: number; points: string; diameter: number;
	}[];
	check('nerve upsert: still one row, points + diameter updated', nerveRows.length === 1 && JSON.parse(nerveRows[0].points).length === 4 && nerveRows[0].diameter === 2.5);

	// GET after apply reflects the saved curve
	res = await api(`/api/datasets/${ds.id}/ai-review`);
	const bundle2 = (await res.json()) as typeof bundle;
	check('GET after apply: pano present', bundle2.pano !== null && bundle2.pano!.control.length === 3);

	/* ---- validation / errors ---- */
	res = await api(`/api/datasets/${ds.id}/ai-review`, 'POST', { pano: { control: [{ x: 1, y: 1 }], z: 0 } });
	check('1-point curve → 400', res.status === 400, `status ${res.status}`);
	res = await api(`/api/datasets/${ds.id}/ai-review`, 'POST', {});
	check('empty apply → 400', res.status === 400, `status ${res.status}`);
	res = await api(`/api/datasets/${ds.id}/ai-review`, 'POST', { nerves: { middle: { points: nervePts } } });
	check('bad nerve side → 400', res.status === 400, `status ${res.status}`);
	res = await api(`/api/datasets/999999/ai-review`);
	check('unknown dataset → 404', res.status === 404, `status ${res.status}`);

	updatePlan(plan.id, { locked: 1 });
	res = await api(`/api/datasets/${ds.id}/ai-review`, 'POST', { planId: plan.id, pano: { control, z: 10 } });
	check('locked plan → 409', res.status === 409, `status ${res.status}`);
	updatePlan(plan.id, { locked: 0 });

	/* ---- audit trail ---- */
	const auditRows = db
		.query(`SELECT detail FROM audit WHERE action = 'aireview.apply' AND id > ?1`)
		.all(auditMaxBefore) as { detail: string }[];
	check('audit: aireview.apply logged', auditRows.length === 2, `${auditRows.length} rows`);
} finally {
	try {
		if (scratchPatientId != null) deletePatient(scratchPatientId);
		db.query(`DELETE FROM audit WHERE action = 'aireview.apply' AND id > ?1`).run(auditMaxBefore);
	} catch (e) {
		console.error('cleanup failed:', e);
		failures++;
	}
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
