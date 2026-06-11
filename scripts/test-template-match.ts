/**
 * Marker-based dual-scan template registration test:
 *   - synthetic phantom pair (patient volume with soft tissue + bone arch +
 *     acrylic shell + 5 fiducial spheres; template volume with the shell and
 *     spheres under a known rigid transform)
 *   - detection accuracy (sub-voxel centroids, no false positives)
 *   - matching (confidence, pairs, RMS, recovered transform error)
 *   - degenerate (collinear), blob (ellipsoid) and streak-artifact cases
 *   - POST /api/cases/[id]/template-match endpoint incl. apply (model + STL)
 *
 *   bun run scripts/test-template-match.ts
 *
 * Endpoint tests need the dev server at http://localhost:5173 and the dev
 * admin account. Scratch DB rows/files are removed in the finally block.
 */
import { join } from 'node:path';
import { DATA_DIR, db, resolveData } from '../src/lib/server/db';
import { createCase, createDataset, createPatient, deletePatient } from '../src/lib/server/db/repo';
import {
	detectMarkers,
	matchMarkers,
	type Marker,
	type VolumeGrid
} from '../src/lib/server/markerReg';
import { applyMat4, type Mat4, type Point3 } from '../src/lib/registration';
import { parseStl } from '../src/lib/server/stl';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const EMAIL = 'cdx@surrey.ac';
const PASSWORD = 'devpassword1';

db.exec('PRAGMA busy_timeout = 3000');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

/* ---------------- HTTP helpers (cookie login) ---------------- */

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

function jsonApi(path: string, method: string, body: unknown): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		method,
		headers: { cookie, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		redirect: 'manual'
	});
}

/* ---------------- geometry helpers ---------------- */

function rotTrans(axis: Point3, angleDeg: number, translation: Point3): Mat4 {
	const l = Math.hypot(axis.x, axis.y, axis.z);
	const x = axis.x / l;
	const y = axis.y / l;
	const z = axis.z / l;
	const a = (angleDeg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	const t = 1 - c;
	return [
		t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
		t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
		t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
		translation.x, translation.y, translation.z, 1
	];
}

/** Rotation about a pivot point + extra translation. */
function rigidAbout(axis: Point3, angleDeg: number, pivot: Point3, t: Point3): Mat4 {
	const m = rotTrans(axis, angleDeg, { x: 0, y: 0, z: 0 });
	const rc = applyMat4(m, pivot);
	m[12] = pivot.x + t.x - rc.x;
	m[13] = pivot.y + t.y - rc.y;
	m[14] = pivot.z + t.z - rc.z;
	return m;
}

function invertRigid(m: Mat4): Mat4 {
	// transpose the rotation, t' = -Rᵀ·t
	const out: Mat4 = [
		m[0], m[4], m[8], 0,
		m[1], m[5], m[9], 0,
		m[2], m[6], m[10], 0,
		0, 0, 0, 1
	];
	out[12] = -(out[0] * m[12] + out[4] * m[13] + out[8] * m[14]);
	out[13] = -(out[1] * m[12] + out[5] * m[13] + out[9] * m[14]);
	out[14] = -(out[2] * m[12] + out[6] * m[13] + out[10] * m[14]);
	return out;
}

function dist(a: Point3, b: Point3): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/* ---------------- phantom builders ---------------- */

const N = 160;
const SP = 0.4; // mm, isotropic
const NN = N * N;

function newVol(n: number): Int16Array {
	return new Int16Array(n * n * n).fill(-1000);
}

function grid(data: Int16Array, n: number): VolumeGrid {
	return { data, dims: [n, n, n], spacing: [SP, SP, SP] };
}

/** Set every voxel whose center lies in the mm box to hu (overwrite). */
function boxFill(
	data: Int16Array,
	n: number,
	x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
	hu: number
): void {
	const i0 = Math.max(0, Math.ceil(x0 / SP));
	const i1 = Math.min(n - 1, Math.floor(x1 / SP));
	const j0 = Math.max(0, Math.ceil(y0 / SP));
	const j1 = Math.min(n - 1, Math.floor(y1 / SP));
	const k0 = Math.max(0, Math.ceil(z0 / SP));
	const k1 = Math.min(n - 1, Math.floor(z1 / SP));
	for (let k = k0; k <= k1; k++) {
		for (let j = j0; j <= j1; j++) {
			const row = k * n * n + j * n;
			for (let i = i0; i <= i1; i++) data[row + i] = hu;
		}
	}
}

/** Sphere with a one-voxel partial-volume ramp (peak HU at the core). */
function stampSphere(data: Int16Array, n: number, c: Point3, r: number, peak = 3000): void {
	const m = r + SP;
	const i0 = Math.max(0, Math.floor((c.x - m) / SP));
	const i1 = Math.min(n - 1, Math.ceil((c.x + m) / SP));
	const j0 = Math.max(0, Math.floor((c.y - m) / SP));
	const j1 = Math.min(n - 1, Math.ceil((c.y + m) / SP));
	const k0 = Math.max(0, Math.floor((c.z - m) / SP));
	const k1 = Math.min(n - 1, Math.ceil((c.z + m) / SP));
	for (let k = k0; k <= k1; k++) {
		for (let j = j0; j <= j1; j++) {
			for (let i = i0; i <= i1; i++) {
				const d = Math.hypot(i * SP - c.x, j * SP - c.y, k * SP - c.z);
				const cov = Math.max(0, Math.min(1, 0.5 + (r - d) / SP));
				if (cov <= 0) continue;
				const hu = Math.round(-1000 + (peak + 1000) * cov);
				const idx = k * n * n + j * n + i;
				if (hu > data[idx]) data[idx] = hu;
			}
		}
	}
}

/** Axis-aligned ellipsoid with a partial-volume ramp (gutta-percha blob). */
function stampEllipsoid(
	data: Int16Array,
	n: number,
	c: Point3,
	ax: number, ay: number, az: number,
	peak = 3000
): void {
	const amin = Math.min(ax, ay, az);
	const i0 = Math.max(0, Math.floor((c.x - ax - SP) / SP));
	const i1 = Math.min(n - 1, Math.ceil((c.x + ax + SP) / SP));
	const j0 = Math.max(0, Math.floor((c.y - ay - SP) / SP));
	const j1 = Math.min(n - 1, Math.ceil((c.y + ay + SP) / SP));
	const k0 = Math.max(0, Math.floor((c.z - az - SP) / SP));
	const k1 = Math.min(n - 1, Math.ceil((c.z + az + SP) / SP));
	for (let k = k0; k <= k1; k++) {
		for (let j = j0; j <= j1; j++) {
			for (let i = i0; i <= i1; i++) {
				const dn = Math.sqrt(
					((i * SP - c.x) / ax) ** 2 + ((j * SP - c.y) / ay) ** 2 + ((k * SP - c.z) / az) ** 2
				);
				const cov = Math.max(0, Math.min(1, 0.5 + ((1 - dn) * amin) / SP));
				if (cov <= 0) continue;
				const hu = Math.round(-1000 + (peak + 1000) * cov);
				const idx = k * n * n + j * n + i;
				if (hu > data[idx]) data[idx] = hu;
			}
		}
	}
}

/* ----- planted marker positions (asymmetric constellation, mm) ----- */

const P: Point3[] = [
	{ x: 17.0, y: 15.0, z: 43.0 },
	{ x: 46.6, y: 14.2, z: 42.2 },
	{ x: 31.0, y: 37.4, z: 43.4 },
	{ x: 22.6, y: 30.2, z: 41.8 },
	{ x: 40.2, y: 24.6, z: 44.2 }
];
const SPHERE_R = 1.5; // Ø3 mm

// known rigid transform A→B: ~7° about a skew axis through the shell center
// plus translation (6.4, -4.0, 2.8) mm
const M = rigidAbout(
	{ x: 0.3, y: 1, z: 0.5 },
	7,
	{ x: 32, y: 28, z: 43 },
	{ x: 6.4, y: -4.0, z: 2.8 }
);
const Minv = invertRigid(M);
const Q = P.map((p) => applyMat4(M, p));

// shell slab in A (mm)
const SHELL = { x0: 14, x1: 50, y0: 12, y1: 40, z0: 40, z1: 46 };
const NOISE_B: Point3 = { x: 8, y: 8, z: 8 }; // small floating chunk in B

/* ----- volume A: patient scan (template in mouth) ----- */

const A = newVol(N);
// soft tissue block
boxFill(A, N, 8, 56, 8, 56, 6, 30, 50);
// arch-ish bone: half annulus inside the soft block
for (let k = Math.ceil(10 / SP); k <= Math.floor(28 / SP); k++) {
	for (let j = 0; j < N; j++) {
		const y = j * SP;
		if (y > 34) continue;
		for (let i = 0; i < N; i++) {
			const x = i * SP;
			const r = Math.hypot(x - 32, y - 32);
			if (r >= 14 && r <= 20) A[k * NN + j * N + i] = 1200;
		}
	}
}
// acrylic shell (template) above the jaw
boxFill(A, N, SHELL.x0, SHELL.x1, SHELL.y0, SHELL.y1, SHELL.z0, SHELL.z1, -100);
// fiducial spheres embedded in the shell
for (const p of P) stampSphere(A, N, p, SPHERE_R);

/* ----- volume B: template scanned alone, posed by M ----- */

const B = newVol(N);
// shell transformed by M: evaluate A-space slab predicate at Minv·voxel
for (let k = 0; k < N; k++) {
	const z = k * SP;
	for (let j = 0; j < N; j++) {
		const y = j * SP;
		for (let i = 0; i < N; i++) {
			const x = i * SP;
			const ux = Minv[0] * x + Minv[4] * y + Minv[8] * z + Minv[12];
			if (ux < SHELL.x0 || ux > SHELL.x1) continue;
			const uy = Minv[1] * x + Minv[5] * y + Minv[9] * z + Minv[13];
			if (uy < SHELL.y0 || uy > SHELL.y1) continue;
			const uz = Minv[2] * x + Minv[6] * y + Minv[10] * z + Minv[14];
			if (uz < SHELL.z0 || uz > SHELL.z1) continue;
			B[k * NN + j * N + i] = -100;
		}
	}
}
// small disconnected chunk — must be dropped by the largest-component filter
boxFill(B, N, NOISE_B.x - 0.6, NOISE_B.x + 0.6, NOISE_B.y - 0.6, NOISE_B.y + 0.6, NOISE_B.z - 0.6, NOISE_B.z + 0.6, -100);
for (const q of Q) stampSphere(B, N, q, SPHERE_R);

/* ---------------- detection / matching checks ---------------- */

/** For each planted point: distance to the nearest detected marker. */
function plantErrors(markers: Marker[], planted: Point3[]): number[] {
	return planted.map((p) => Math.min(...markers.map((m) => dist(m, p))));
}

function fmt(v: number): string {
	return v.toFixed(3);
}

const gA = grid(A, N);
const gB = grid(B, N);

const mA = detectMarkers(gA);
const errA = plantErrors(mA, P);
check('volume A: 5/5 markers, 0 false positives', mA.length === 5, `${mA.length} markers`);
check('volume A: all kind=sphere', mA.every((m) => m.kind === 'sphere'));
check(
	'volume A: centroids within 0.25 mm of planted',
	errA.every((e) => e < 0.25),
	`max ${fmt(Math.max(...errA))} mm`
);

const mB = detectMarkers(gB);
const errB = plantErrors(mB, Q);
check('volume B: 5/5 markers, 0 false positives', mB.length === 5, `${mB.length} markers`);
check('volume B: all kind=sphere', mB.every((m) => m.kind === 'sphere'));
check(
	'volume B: centroids within 0.25 mm of planted',
	errB.every((e) => e < 0.25),
	`max ${fmt(Math.max(...errB))} mm`
);

// downsampled candidate pass + full-res refinement (forced on the small volume)
const mAds = detectMarkers(gA, { downsampleOver: 1_000_000 });
const errAds = plantErrors(mAds, P);
check(
	'downsample path: 5 markers within 0.25 mm',
	mAds.length === 5 && errAds.every((e) => e < 0.25),
	`${mAds.length} markers, max ${fmt(Math.max(...errAds))} mm`
);

// template (B) → patient (A)
const match = matchMarkers(mB, mA);
check('match: confidence good', match.confidence === 'good', match.confidence + (match.reason ? `: ${match.reason}` : ''));
check('match: 5 pairs', match.pairs.length === 5, `${match.pairs.length} pairs`);
check('match: rms < 0.2 mm', Number.isFinite(match.rmsMM) && match.rmsMM < 0.2, `rms ${fmt(match.rmsMM)} mm`);

let tErr = 0;
if (match.transform) {
	for (let i = 0; i < P.length; i++) {
		tErr = Math.max(tErr, dist(applyMat4(match.transform, Q[i]), P[i]));
	}
}
check(
	'match: recovered transform error < 0.3 mm on planted positions',
	match.transform !== null && tErr < 0.3,
	`max ${fmt(tErr)} mm`
);

/* ----- degenerate: 3 collinear markers must never be silent "good" ----- */

function mk(p: Point3): Marker {
	return { x: p.x, y: p.y, z: p.z, radiusMM: 1.5, voxels: 200, score: 1, kind: 'sphere' };
}
const colSrcPts: Point3[] = [
	{ x: 0, y: 0, z: 0 },
	{ x: 10, y: 0, z: 0 },
	{ x: 26, y: 0, z: 0 }
];
const colM = rotTrans({ x: 1, y: 0.4, z: 0.2 }, 20, { x: 5, y: 2, z: -3 });
const colRes = matchMarkers(colSrcPts.map(mk), colSrcPts.map((p) => mk(applyMat4(colM, p))));
check(
	"degenerate (collinear): 'low' or 'failed', never 'good'",
	colRes.confidence === 'low' || colRes.confidence === 'failed',
	`${colRes.confidence}${colRes.reason ? `: ${colRes.reason}` : ''}`
);

/* ----- blobs: irregular ~3x3x5-voxel ellipsoids detected and matched ----- */

const blobA = newVol(N);
const blobB = newVol(N);
for (const p of P) stampEllipsoid(blobA, N, p, 0.55, 0.55, 1.15);
for (const q of Q) stampEllipsoid(blobB, N, q, 0.55, 0.55, 1.15);
const mBlobA = detectMarkers(grid(blobA, N));
const mBlobB = detectMarkers(grid(blobB, N));
check('blob volumes: 5 markers each', mBlobA.length === 5 && mBlobB.length === 5, `${mBlobA.length}/${mBlobB.length}`);
check(
	"blobs detected as kind='blob'",
	mBlobA.every((m) => m.kind === 'blob') && mBlobB.every((m) => m.kind === 'blob'),
	[...mBlobA, ...mBlobB].map((m) => m.kind).join(',')
);
const blobMatch = matchMarkers(mBlobB, mBlobA);
check(
	'blobs matched (5 pairs, not failed)',
	blobMatch.pairs.length === 5 && blobMatch.confidence !== 'failed',
	`${blobMatch.confidence}, ${blobMatch.pairs.length} pairs, rms ${fmt(blobMatch.rmsMM)} mm`
);

/* ----- streak artifact (60x2x2 voxels, bright) must be rejected ----- */

const AStreak = A.slice();
for (let k = 50; k <= 51; k++) {
	for (let j = 125; j <= 126; j++) {
		for (let i = 25; i <= 84; i++) AStreak[k * NN + j * N + i] = 2500;
	}
}
const mStreak = detectMarkers(grid(AStreak, N));
const errStreak = plantErrors(mStreak, P);
check(
	'streak artifact rejected (still exactly 5 spheres)',
	mStreak.length === 5 && errStreak.every((e) => e < 0.25),
	`${mStreak.length} markers`
);

/* ---------------- endpoint tests ---------------- */

// volume C: only 2 markers → matching must fail
const NC = 64;
const C = newVol(NC);
stampSphere(C, NC, { x: 8, y: 8, z: 8 }, SPHERE_R);
stampSphere(C, NC, { x: 16, y: 12, z: 11 }, SPHERE_R);

const auditMaxBefore = (
	db.query('SELECT COALESCE(MAX(id), 0) AS m FROM audit').get() as { m: number }
).m;
let scratchPatientId: number | null = null;

interface MatchDto {
	markersPatient: Marker[];
	markersTemplate: Marker[];
	pairs: { si: number; di: number; residualMM: number }[];
	rmsMM: number | null;
	confidence: string;
	reason?: string;
	model?: { id: number; case_id: number; kind: string; name: string; file_path: string; transform: string };
	triangles?: number;
}

try {
	check('login (cookie jar)', await login());

	const patient = createPatient({ first_name: 'Scratch', last_name: 'TemplateMatch' });
	scratchPatientId = patient.id;
	const case1 = createCase(patient.id, 'template-match test');
	const case2 = createCase(patient.id, 'template-match other');

	const caseDirRel = join('cases', String(case1.id));
	await Bun.write(join(DATA_DIR, caseDirRel, 'tm_a.i16'), new Uint8Array(A.buffer));
	await Bun.write(join(DATA_DIR, caseDirRel, 'tm_b.i16'), new Uint8Array(B.buffer));
	await Bun.write(join(DATA_DIR, caseDirRel, 'tm_c.i16'), new Uint8Array(C.buffer));

	const dsCommon = {
		kind: 'ct' as const,
		spacing_x: SP,
		spacing_y: SP,
		spacing_z: SP,
		modality: 'CT'
	};
	const dsA = createDataset({
		...dsCommon,
		case_id: case1.id,
		description: 'phantom patient scan',
		cols: N, rows: N, slices: N,
		volume_path: join(caseDirRel, 'tm_a.i16')
	});
	const dsB = createDataset({
		...dsCommon,
		case_id: case1.id,
		description: 'phantom template scan',
		cols: N, rows: N, slices: N,
		volume_path: join(caseDirRel, 'tm_b.i16')
	});
	const dsC = createDataset({
		...dsCommon,
		case_id: case1.id,
		description: 'phantom 2-marker scan',
		cols: NC, rows: NC, slices: NC,
		volume_path: join(caseDirRel, 'tm_c.i16')
	});

	/* ----- dry run (no apply): markers + pairs, no writes ----- */
	let res = await jsonApi(`/api/cases/${case1.id}/template-match`, 'POST', {
		patientDatasetId: dsA.id,
		templateDatasetId: dsB.id
	});
	const dry = (await res.json()) as MatchDto;
	check('endpoint dry run -> 200', res.status === 200, `status ${res.status}`);
	check(
		'dry run: 5+5 markers, 5 pairs, confidence good',
		dry.markersPatient?.length === 5 &&
			dry.markersTemplate?.length === 5 &&
			dry.pairs?.length === 5 &&
			dry.confidence === 'good',
		`rms ${dry.rmsMM != null ? fmt(dry.rmsMM) : 'null'} mm`
	);
	const modelCount = (
		db.query('SELECT COUNT(*) AS c FROM models WHERE case_id = ?1').get(case1.id) as { c: number }
	).c;
	check('dry run writes no model rows', modelCount === 0, `${modelCount} models`);

	/* ----- dataset/case mismatch -> 404 ----- */
	res = await jsonApi(`/api/cases/${case2.id}/template-match`, 'POST', {
		patientDatasetId: dsA.id,
		templateDatasetId: dsB.id
	});
	check('datasets of another case -> 404', res.status === 404, `status ${res.status}`);

	res = await jsonApi(`/api/cases/${case1.id}/template-match`, 'POST', {
		patientDatasetId: dsA.id,
		templateDatasetId: 99999999
	});
	check('unknown dataset id -> 404', res.status === 404, `status ${res.status}`);

	/* ----- apply with failed confidence -> 409 ----- */
	res = await jsonApi(`/api/cases/${case1.id}/template-match`, 'POST', {
		patientDatasetId: dsA.id,
		templateDatasetId: dsC.id,
		apply: true
	});
	check('apply on failed match -> 409', res.status === 409, `status ${res.status}`);

	/* ----- apply -> model row + transformed STL ----- */
	res = await jsonApi(`/api/cases/${case1.id}/template-match`, 'POST', {
		patientDatasetId: dsA.id,
		templateDatasetId: dsB.id,
		apply: true,
		surfaceThreshold: -300
	});
	const applied = (await res.json()) as MatchDto;
	check('apply -> 200', res.status === 200, `status ${res.status}`);
	check(
		"apply: model kind 'scan' named 'Template (dual scan)'",
		applied.model?.kind === 'scan' && applied.model?.name === 'Template (dual scan)',
		`${applied.model?.kind}/${applied.model?.name}`
	);
	check('apply: model.transform stays unset', !applied.model?.transform, `'${applied.model?.transform}'`);
	check('apply: triangles > 0', (applied.triangles ?? 0) > 0, `${applied.triangles} triangles`);

	const modelRow = applied.model
		? (db.query('SELECT * FROM models WHERE id = ?1').get(applied.model.id) as {
				id: number;
				case_id: number;
				file_path: string;
			} | null)
		: null;
	check('apply: model row persisted on the case', modelRow?.case_id === case1.id);

	let surfaceOk = false;
	let probeDetail = 'no STL';
	let noiseOk = false;
	if (modelRow) {
		const bytes = new Uint8Array(await Bun.file(resolveData(modelRow.file_path)).arrayBuffer());
		const mesh = parseStl(bytes);
		if (mesh && mesh.positions.length > 0) {
			const pos = mesh.positions;
			// expected patient-space surface points on the shell slab (iso -300
			// between -1000 air and -100 acrylic sits ~0.78 voxel outside the
			// first inside voxel center)
			const probes: Point3[] = [
				{ x: 32, y: 26, z: 39.911 },
				{ x: 20, y: 16, z: 39.911 },
				{ x: 40, y: 30, z: 46.089 }
			];
			const minDistTo = (p: Point3): number => {
				let best = Infinity;
				for (let i = 0; i + 2 < pos.length; i += 3) {
					const d = Math.hypot(pos[i] - p.x, pos[i + 1] - p.y, pos[i + 2] - p.z);
					if (d < best) best = d;
				}
				return best;
			};
			const probeDists = probes.map(minDistTo);
			surfaceOk = probeDists.every((d) => d < 1.0);
			probeDetail = probeDists.map(fmt).join(' / ') + ' mm';
			// the floating noise chunk must have been removed by the
			// largest-component filter: nothing near its patient-space image
			const noiseInA = applyMat4(Minv, NOISE_B);
			noiseOk = minDistTo(noiseInA) > 2.0;
		}
	}
	check('apply: transformed surface within 1 mm of expected patient-space points', surfaceOk, probeDetail);
	check('apply: disconnected noise component filtered out', noiseOk);

	const auditRows = db
		.query(`SELECT detail FROM audit WHERE action = 'template.match' AND id > ?1`)
		.all(auditMaxBefore) as { detail: string }[];
	check(
		"audit: 'template.match' logged with rms + pairs",
		auditRows.length === 1 && /rms/.test(auditRows[0].detail) && /pairs/.test(auditRows[0].detail),
		auditRows[0]?.detail ?? 'no row'
	);
} finally {
	try {
		if (scratchPatientId != null) deletePatient(scratchPatientId);
		db.query(`DELETE FROM audit WHERE action = 'template.match' AND id > ?1`).run(auditMaxBefore);
	} catch (e) {
		console.error('cleanup failed:', e);
		failures++;
	}
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All checks passed');
