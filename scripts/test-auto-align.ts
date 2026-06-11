/**
 * Synthetic test for the automatic scan → CBCT registration
 * ($lib/server/autoAlign — the "Align using AI assistant" backend):
 *
 *   - builds the same 256×256×160 @ 0.4 mm mandible-arch phantom geometry as
 *     scripts/make-synthetic-dicom.ts (bone ridge + tooth crowns/roots, mild
 *     noise) directly as an in-memory HU volume (that script writes files at
 *     import time, so its formulas are mirrored here instead of imported),
 *   - extracts the CBCT target iso-surface, meshes the crowns region with
 *     marching cubes as a stand-in "intraoral scan",
 *   - displaces the scan mesh by known rigid transforms (yaw-dominant and a
 *     180°-flipped pose) and checks autoAlign recovers the inverse within
 *     rotation ≤ 3° / max point error ≤ 1 mm, with small RMS and
 *     quality 'good', under the 5 s synchronous budget,
 *   - checks the hopeless-input path reports quality 'failed' (the endpoint's
 *     422 case).
 *
 *   bun run scripts/test-auto-align.ts
 *
 * Prints PASS/FAIL per check plus stage timings; exits non-zero on failure.
 * No dev server or real case data needed (DB side effects are pointed at a
 * scratch dir before the server modules are imported).
 */
process.env.CDX_DATA_DIR ??= '/tmp/cdx-autoalign-test-data';

import {
	applyMat4,
	composeMat4,
	type Mat4,
	type Point3
} from '../src/lib/registration';

// dynamic imports so CDX_DATA_DIR above takes effect before $lib/server/db loads
const { autoAlign, extractIsoSurfacePoints, sampleScanSurface, TEETH_ISO_HU } = await import(
	'../src/lib/server/autoAlign'
);
const { marchingCubes } = await import('../src/lib/server/marchingCubes');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
	if (!ok) failures++;
}

/* ---------------- rigid-transform helpers ---------------- */

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

/** Rotation angle (deg) of a rigid mat4's 3×3 part. */
function rotationAngleDeg(m: Mat4): number {
	const tr = m[0] + m[5] + m[10];
	const c = Math.max(-1, Math.min(1, (tr - 1) / 2));
	return (Math.acos(c) * 180) / Math.PI;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/* ---------------- phantom volume (mirrors make-synthetic-dicom.ts) ------- */

const COLS = 256;
const ROWS = 256;
const SLICES = 160;
const SP = 0.4; // mm, isotropic

// mandibular arch centerline (horseshoe opening posteriorly), t in [-1, 1]
function archPoint(t: number): { x: number; y: number } {
	const a = t * 1.25;
	return { x: 42 * Math.sin(a), y: 30 * Math.cos(a) - 6 };
}

const ARCH: { x: number; y: number }[] = [];
for (let i = 0; i <= 128; i++) ARCH.push(archPoint(-1 + (2 * i) / 128));

// teeth along the arch: 14 positions, two gaps
const MISSING = new Set([3, 10]);
const TEETH = Array.from({ length: 14 }, (_, i) => archPoint(-0.88 + (1.76 * i) / 13)).filter(
	(_, i) => !MISSING.has(i)
);

console.log('Building 256×256×160 @ 0.4 mm phantom volume…');
const tVol0 = performance.now();

// per-pixel distance to arch centerline / nearest tooth
const distArch = new Float32Array(COLS * ROWS);
const distTooth = new Float32Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
	const y = (r - ROWS / 2 + 0.5) * SP;
	for (let c = 0; c < COLS; c++) {
		const x = (c - COLS / 2 + 0.5) * SP;
		const idx = r * COLS + c;
		let best = 1e9;
		for (const p of ARCH) {
			const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
			if (d < best) best = d;
		}
		distArch[idx] = Math.sqrt(best);
		let dt = 1e9;
		for (const tooth of TEETH) {
			const d = Math.hypot(tooth.x - x, tooth.y - y);
			if (d < dt) dt = d;
		}
		distTooth[idx] = dt;
	}
}

const CREST = 36; // mm
const BOTTOM = 8;

function huAt(idx: number, z: number): number {
	let hu = -1000;
	const d = distArch[idx];
	// mandible body: ridge narrows toward the crest, cortical shell + cancellous core
	if (z >= BOTTOM && z <= CREST) {
		const halfWidth = z > 30 ? 5.5 - (z - 30) * 0.25 : 5.5;
		if (d < halfWidth) {
			const cortical = halfWidth - d < 1.6 || z - BOTTOM < 1.6 || CREST - z < 1.2;
			hu = cortical ? 1400 : 350;
		}
	}
	// teeth: crowns above the crest, roots inside the bone
	const dt = distTooth[idx];
	if (dt < 3.2 && z > 26 && z < 45) {
		if (z >= CREST) hu = 2200;
		else {
			const taper = 1.9 * ((z - 26) / 10);
			if (dt < Math.max(0.7, taper)) hu = 2400;
		}
	}
	return hu;
}

const vol = new Int16Array(COLS * ROWS * SLICES);
for (let k = 0; k < SLICES; k++) {
	const z = k * SP;
	const base = k * COLS * ROWS;
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const noise = ((k * 73 + r * 31 + c * 17) % 7) - 3;
			vol[base + r * COLS + c] = huAt(r * COLS + c, z) + noise * 5;
		}
	}
}
console.log(`  volume built in ${(performance.now() - tVol0).toFixed(0)} ms`);

/* ---------------- CBCT target + synthetic "intraoral scan" --------------- */

const dims: [number, number, number] = [COLS, ROWS, SLICES];
const spacing: [number, number, number] = [SP, SP, SP];

const tExtract0 = performance.now();
const target = extractIsoSurfacePoints(vol, dims, spacing, TEETH_ISO_HU, 15000);
const extractMs = performance.now() - tExtract0;
console.log(`  iso-surface extraction: ${extractMs.toFixed(0)} ms, ${target.length} points`);
check('target iso-surface has enough points', target.length >= 5000, `${target.length} points`);
check('target iso-surface respects maxPoints', target.length <= 15000, `${target.length} ≤ 15000`);

// "scan" = marching-cubes mesh of the crowns region (z ≥ 28 mm), in volume mm
const K0 = Math.round(28 / SP);
const NZ2 = Math.round(46 / SP) - K0 + 1;
const sub = vol.subarray(K0 * COLS * ROWS, (K0 + NZ2) * COLS * ROWS) as Int16Array;
const mesh = marchingCubes(sub, [COLS, ROWS, NZ2], spacing, TEETH_ISO_HU);
for (let i = 2; i < mesh.positions.length; i += 3) mesh.positions[i] += K0 * SP;
const triangles = mesh.positions.length / 9;
check('scan mesh meshed from crowns region', triangles > 1000, `${triangles} triangles`);

// true crown-surface reference points for the displacement check
const refPts: Point3[] = [];
const refStride = Math.max(1, Math.floor(mesh.positions.length / 3 / 500)) * 3;
for (let i = 0; i + 2 < mesh.positions.length; i += refStride) {
	refPts.push({ x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] });
}
let pcx = 0;
let pcy = 0;
let pcz = 0;
for (const p of refPts) {
	pcx += p.x;
	pcy += p.y;
	pcz += p.z;
}
const pivot = { x: pcx / refPts.length, y: pcy / refPts.length, z: pcz / refPts.length };

/* ---------------- scenarios ---------------- */

function runScenario(name: string, displace: Mat4): void {
	// the "imported scan": mesh vertices in their own (displaced) frame
	const movedPositions = new Float32Array(mesh.positions.length);
	for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
		const q = applyMat4(displace, {
			x: mesh.positions[i],
			y: mesh.positions[i + 1],
			z: mesh.positions[i + 2]
		});
		movedPositions[i] = q.x;
		movedPositions[i + 1] = q.y;
		movedPositions[i + 2] = q.z;
	}

	const source = sampleScanSurface(movedPositions, 3000);
	check(`${name}: scan sampling yields enough points`, source.length >= 500, `${source.length} points`);

	const t0 = performance.now();
	const res = autoAlign(source, target);
	const dt = performance.now() - t0;
	console.log(
		`  ${name}: autoAlign ${dt.toFixed(0)} ms — rms ${res.rms.toFixed(3)} mm, ` +
			`${Math.round(res.inlierFraction * 100)}% inliers, quality ${res.quality}, ` +
			`${res.candidatesTried} coarse candidates`
	);

	// recovered ∘ displace should be the identity on the scanned anatomy
	const E = composeMat4(res.transform, displace);
	const rotErr = rotationAngleDeg(E);
	let maxPtErr = 0;
	for (const p of refPts) {
		const q = applyMat4(E, p);
		const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
		if (d > maxPtErr) maxPtErr = d;
	}

	check(`${name}: rotation recovered ≤ 3°`, rotErr <= 3, `${rotErr.toFixed(2)}°`);
	check(`${name}: max point error ≤ 1 mm`, maxPtErr <= 1, `${maxPtErr.toFixed(3)} mm`);
	check(`${name}: rms small`, Number.isFinite(res.rms) && res.rms <= 1.0, `${res.rms.toFixed(3)} mm`);
	check(`${name}: quality is 'good'`, res.quality === 'good', res.quality);
	check(`${name}: within the 5 s synchronous bound`, dt < 5000, `${dt.toFixed(0)} ms`);
}

runScenario(
	'yaw-dominant pose (47°, skew axis, 7/-5/3 mm)',
	rigidAbout({ x: 0.08, y: -0.12, z: 1 }, 47, pivot, { x: 7, y: -5, z: 3 })
);

runScenario(
	'flipped pose (180° about x + 30° yaw, -6/4/-8 mm)',
	composeMat4(
		rigidAbout({ x: 0, y: 0, z: 1 }, 30, pivot, { x: -6, y: 4, z: -8 }),
		rigidAbout({ x: 1, y: 0, z: 0 }, 180, pivot, { x: 0, y: 0, z: 0 })
	)
);

/* ---------------- hopeless input → 'failed' (endpoint 422 path) ---------- */

{
	const rand = mulberry32(20260611);
	const junk: Point3[] = [];
	for (let i = 0; i < 400; i++) {
		junk.push({ x: rand() * 60, y: rand() * 60, z: rand() * 60 });
	}
	const src = sampleScanSurface(mesh.positions, 3000);
	const res = autoAlign(src, junk);
	check(
		"hopeless target: quality 'failed'",
		res.quality === 'failed',
		`quality ${res.quality}, rms ${Number.isFinite(res.rms) ? res.rms.toFixed(2) : '∞'}, ` +
			`${Math.round(res.inlierFraction * 100)}% inliers`
	);
}

/* ---------------- summary ---------------- */

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks PASSED');
