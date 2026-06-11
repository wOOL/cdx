/**
 * Augmentation / mesh editor / virtual tooth extraction / AI segmentation
 * smoke test on a synthetic scratch dataset (no dev server; scratch rows are
 * inserted into the shared DB and removed in finally).
 *   bun run scripts/test-augment-ai.ts
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, caseRel, db, resolveData } from '../src/lib/server/db';
import { runAugmentation, sanitizeOutlines } from '../src/lib/server/augment';
import { applyMeshEdit, extractToothFromSoup } from '../src/lib/server/meshEdit';
import { getAiSegState, startAiSegmentation } from '../src/lib/server/aiSeg';
import { evictVolume } from '../src/lib/server/volumeCache';
import type { Dataset } from '../src/lib/types';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// Synthetic meshes
// ---------------------------------------------------------------------------

/** Lat/long sphere soup at the origin; deterministic per-vertex radial noise. */
function sphereSoup(radius: number, noiseAmp: number): Float32Array {
	const stacks = 16;
	const slices = 24;
	const vert = (i: number, j: number): [number, number, number] => {
		const jj = i === 0 || i === stacks ? 0 : j % slices;
		const r = radius + noiseAmp * Math.sin(i * 12.9898 + jj * 78.233);
		const theta = (Math.PI * i) / stacks;
		const phi = (2 * Math.PI * (j % slices)) / slices;
		return [
			r * Math.sin(theta) * Math.cos(phi),
			r * Math.sin(theta) * Math.sin(phi),
			r * Math.cos(theta)
		];
	};
	const pos: number[] = [];
	for (let i = 0; i < stacks; i++) {
		for (let j = 0; j < slices; j++) {
			const a = vert(i, j);
			const b = vert(i + 1, j);
			const c = vert(i + 1, j + 1);
			const d = vert(i, j + 1);
			if (i !== stacks - 1) pos.push(...a, ...b, ...c);
			if (i !== 0) pos.push(...a, ...c, ...d);
		}
	}
	return Float32Array.from(pos);
}

/** Closed cube [0,size]^3 as 12 outward-wound triangles. */
function cubeSoup(size = 10): Float32Array {
	type V = [number, number, number];
	const s = size;
	const q = (v0: V, v1: V, v2: V, v3: V): number[] => [...v0, ...v1, ...v2, ...v0, ...v2, ...v3];
	return Float32Array.from([
		...q([0, 0, 0], [0, s, 0], [s, s, 0], [s, 0, 0]), // z=0
		...q([0, 0, s], [s, 0, s], [s, s, s], [0, s, s]), // z=s
		...q([0, 0, 0], [s, 0, 0], [s, 0, s], [0, 0, s]), // y=0
		...q([0, s, 0], [0, s, s], [s, s, s], [s, s, 0]), // y=s
		...q([0, 0, 0], [0, 0, s], [0, s, s], [0, s, 0]), // x=0
		...q([s, 0, 0], [s, s, 0], [s, s, s], [s, 0, s]) // x=s
	]);
}

// ---------------------------------------------------------------------------
// Mesh metrics (recomputed independently of meshEdit.ts)
// ---------------------------------------------------------------------------

function vertKey(x: number, y: number, z: number): string {
	return `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
}

/** Number of undirected edges used by exactly one triangle. */
function openEdgeCount(positions: Float32Array): number {
	const ids = new Map<string, number>();
	const tri: number[] = [];
	for (let i = 0; i + 2 < positions.length; i += 3) {
		const key = vertKey(positions[i], positions[i + 1], positions[i + 2]);
		let id = ids.get(key);
		if (id === undefined) {
			id = ids.size;
			ids.set(key, id);
		}
		tri.push(id);
	}
	const use = new Map<string, number>();
	for (let t = 0; t + 2 < tri.length; t += 3) {
		for (let e = 0; e < 3; e++) {
			const a = tri[t + e];
			const b = tri[t + ((e + 1) % 3)];
			if (a === b) continue;
			const k = a < b ? `${a}|${b}` : `${b}|${a}`;
			use.set(k, (use.get(k) ?? 0) + 1);
		}
	}
	let open = 0;
	for (const n of use.values()) if (n === 1) open++;
	return open;
}

/**
 * Local roughness of a (noisy) sphere: variance over welded vertices of
 * dot(vertexNormal, radialDirection). 0 for a perfect sphere.
 */
function normalRoughness(positions: Float32Array): number {
	const ids = new Map<string, number>();
	const verts: number[] = [];
	const tri: number[] = [];
	for (let i = 0; i + 2 < positions.length; i += 3) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		const key = vertKey(x, y, z);
		let id = ids.get(key);
		if (id === undefined) {
			id = ids.size;
			ids.set(key, id);
			verts.push(x, y, z);
		}
		tri.push(id);
	}
	const normals = new Float64Array(verts.length);
	for (let t = 0; t + 2 < tri.length; t += 3) {
		const a = tri[t] * 3;
		const b = tri[t + 1] * 3;
		const c = tri[t + 2] * 3;
		const ux = verts[b] - verts[a];
		const uy = verts[b + 1] - verts[a + 1];
		const uz = verts[b + 2] - verts[a + 2];
		const vx = verts[c] - verts[a];
		const vy = verts[c + 1] - verts[a + 1];
		const vz = verts[c + 2] - verts[a + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		for (const o of [a, b, c]) {
			normals[o] += nx;
			normals[o + 1] += ny;
			normals[o + 2] += nz;
		}
	}
	let sum = 0;
	let sumSq = 0;
	let n = 0;
	for (let v = 0; v * 3 < verts.length; v++) {
		const o = v * 3;
		const nl = Math.hypot(normals[o], normals[o + 1], normals[o + 2]);
		const rl = Math.hypot(verts[o], verts[o + 1], verts[o + 2]);
		if (nl < 1e-12 || rl < 1e-12) continue;
		const d =
			(normals[o] * verts[o] + normals[o + 1] * verts[o + 1] + normals[o + 2] * verts[o + 2]) /
			(nl * rl);
		sum += d;
		sumSq += d * d;
		n++;
	}
	if (n === 0) return 0;
	const mean = sum / n;
	return sumSq / n - mean * mean;
}

// ---------------------------------------------------------------------------
// Scratch dataset: 64x64x16 @ 0.5mm — soft envelope, bone block, teeth block
// ---------------------------------------------------------------------------

const C = 64;
const R = 64;
const S = 16;
const SP = 0.5;
const CR = C * R;

const vol = new Int16Array(C * R * S).fill(-1000);
for (let z = 2; z < 14; z++) {
	for (let y = 8; y < 56; y++) {
		for (let x = 8; x < 56; x++) vol[z * CR + y * C + x] = 0; // soft tissue
	}
}
for (let z = 4; z < 12; z++) {
	for (let y = 16; y < 48; y++) {
		for (let x = 16; x < 48; x++) vol[z * CR + y * C + x] = 1000; // bone
	}
}
for (let z = 6; z < 10; z++) {
	for (let y = 28; y < 36; y++) {
		for (let x = 28; x < 36; x++) vol[z * CR + y * C + x] = 1600; // teeth
	}
}

let patientId: number | null = null;
let caseId: number | null = null;
let dsId: number | null = null;

try {
	// ---- scratch DB rows + volume file ----
	const patient = db
		.query(`INSERT INTO patients (first_name, last_name) VALUES ('Scratch', 'AugmentAI') RETURNING id`)
		.get() as { id: number };
	patientId = patient.id;
	const kase = db
		.query(`INSERT INTO cases (patient_id, title) VALUES (?1, 'augment-ai scratch') RETURNING id`)
		.get(patientId) as { id: number };
	caseId = kase.id;
	const volRel = join(caseRel(caseId), 'scratch_vol.i16');
	await Bun.write(resolveData(volRel), new Uint8Array(vol.buffer));
	const ds = db
		.query(
			`INSERT INTO datasets (case_id, kind, description, cols, rows, slices,
			   spacing_x, spacing_y, spacing_z, modality, volume_path, status)
			 VALUES (?1, 'ct', 'augment-ai scratch', ?2, ?3, ?4, ?5, ?5, ?5, 'CT', ?6, 'ready')
			 RETURNING *`
		)
		.get(caseId, C, R, S, SP, volRel) as Dataset;
	dsId = ds.id;

	// ---- 1. augmentation: two outlined slices 4 apart ----
	const square = [
		{ x: 10, y: 10 },
		{ x: 30, y: 10 },
		{ x: 30, y: 30 },
		{ x: 10, y: 30 }
	];
	const both = await runAugmentation(ds, sanitizeOutlines({ 4: [square], 8: [square] }, ds), 1);
	check(
		'augment creates model row (kind other, params.augmentation)',
		both.model.id > 0 &&
			both.model.kind === 'other' &&
			JSON.parse(both.model.params).augmentation === true
	);
	check('augment model file written', await Bun.file(resolveData(both.model.file_path)).exists());
	// 20x20 px filled on slices 4..8 → 5 * 400 voxels * 0.125 mm³ = 0.25 ml
	const expectedMl = (5 * 400 * SP * SP * SP) / 1000;
	check(
		'augment ml within ±30% of expected',
		Math.abs(both.ml - expectedMl) / expectedMl <= 0.3,
		`${both.ml} ml vs ${expectedMl} ml`
	);
	const single = await runAugmentation(ds, sanitizeOutlines({ 4: [square] }, ds), 1);
	check(
		'interpolated middle slices non-empty (two-slice ml >> one-slice ml)',
		both.ml > 3 * single.ml,
		`${both.ml} vs ${single.ml}`
	);

	// ---- 2. mesh editor: smooth reduces roughness on a noisy sphere ----
	const noisy = sphereSoup(10, 0.6);
	const rough0 = normalRoughness(noisy);
	const smoothed = applyMeshEdit(noisy, {
		op: 'smooth',
		center: { x: 0, y: 0, z: 0 },
		radius: 100
	});
	const rough1 = normalRoughness(smoothed.positions);
	check(
		'smooth reduces vertex-normal roughness',
		rough1 < rough0 && rough0 > 0,
		`${rough0.toFixed(5)} → ${rough1.toFixed(5)}`
	);

	// ---- 3. fillHoles closes a punctured cube ----
	const punctured = cubeSoup(10).slice(9);
	check('punctured cube has 3 open edges', openEdgeCount(punctured) === 3);
	const filled = applyMeshEdit(punctured, { op: 'fillHoles' });
	check(
		'fillHoles fills 1 hole',
		Number(filled.report.holesFilled) === 1,
		JSON.stringify(filled.report)
	);
	check('0 open edges after fillHoles', openEdgeCount(filled.positions) === 0);

	// ---- 4. virtual tooth extraction removes triangles ----
	const sphere = sphereSoup(10, 0);
	const cut = extractToothFromSoup(
		sphere,
		{ x: 0, y: 0, z: 10 },
		{ x: 0, y: 0, z: -1 },
		6,
		'cut'
	);
	check(
		'extract-tooth removes triangles',
		cut.removed > 0 && cut.positions.length < sphere.length,
		`${cut.removed} removed`
	);
	check('cut leaves an opening', openEdgeCount(cut.positions) > 0);
	const closed = extractToothFromSoup(
		sphere,
		{ x: 0, y: 0, z: 10 },
		{ x: 0, y: 0, z: -1 },
		6,
		'cutClose'
	);
	check(
		'cutClose fills the new opening',
		closed.holesFilled >= 1 && openEdgeCount(closed.positions) < openEdgeCount(cut.positions),
		`${closed.holesFilled} hole(s) filled, ${openEdgeCount(closed.positions)} open edges left`
	);

	// ---- 5. AI segmentation pipeline ----
	const { jobId } = startAiSegmentation(ds);
	check('ai-segment returns jobId immediately', typeof jobId === 'string' && jobId.length > 0);
	let state = getAiSegState(ds.id);
	for (let i = 0; i < 600 && state.status === 'running'; i++) {
		await Bun.sleep(100);
		state = getAiSegState(ds.id);
	}
	check('ai-segment reaches done', state.status === 'done', state.error ?? state.status);
	const models = state.models ?? [];
	const okModels = models.filter((m) => m.ok);
	check(
		'ai-segment ≥1 ok model',
		okModels.length >= 1,
		models.map((m) => `${m.class}:${m.triangles}`).join(' ')
	);
	check('ai bone model ok', models.find((m) => m.class === 'bone')?.ok === true);
	const aiRows = db
		.query(`SELECT COUNT(*) AS n FROM models WHERE case_id = ?1 AND params LIKE '%"ai":true%'`)
		.get(caseId) as { n: number };
	check('ai model rows in DB', aiRows.n === models.length, `${aiRows.n} rows`);
} finally {
	// remove every scratch row (cascade) and the case's files
	if (patientId != null) db.query('DELETE FROM patients WHERE id = ?1').run(patientId);
	if (caseId != null) rmSync(join(DATA_DIR, 'cases', String(caseId)), { recursive: true, force: true });
	if (dsId != null) evictVolume(dsId);
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All checks passed');
process.exit(0);
