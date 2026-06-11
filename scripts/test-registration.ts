/**
 * Numerical tests for src/lib/registration.ts (Kabsch + ICP).
 *   bun run scripts/test-registration.ts
 * Prints PASS/FAIL per check and exits non-zero on any failure.
 */
import {
	applyMat4,
	composeMat4,
	icp,
	identityMat4,
	kabsch,
	type Mat4,
	type Point3
} from '../src/lib/registration';

let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
	if (!ok) failures++;
}

/* ---------- deterministic RNG ---------- */

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

function gaussian(rand: () => number): number {
	// Box-Muller
	let u = 0;
	while (u === 0) u = rand();
	const v = rand();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------- helpers ---------- */

function rotationTranslationMat4(
	axis: Point3,
	angleDeg: number,
	translation: Point3
): Mat4 {
	const l = Math.hypot(axis.x, axis.y, axis.z);
	const x = axis.x / l;
	const y = axis.y / l;
	const z = axis.z / l;
	const a = (angleDeg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	const t = 1 - c;
	// Rodrigues rotation, column-major with translation in the 4th column.
	return [
		t * x * x + c,
		t * x * y + s * z,
		t * x * z - s * y,
		0,
		t * x * y - s * z,
		t * y * y + c,
		t * y * z + s * x,
		0,
		t * x * z + s * y,
		t * y * z - s * x,
		t * z * z + c,
		0,
		translation.x,
		translation.y,
		translation.z,
		1
	];
}

function dist(a: Point3, b: Point3): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function maxAbsDiff(a: Mat4, b: Mat4): number {
	let m = 0;
	for (let i = 0; i < 16; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
	return m;
}

function allFinite(m: Mat4): boolean {
	return m.length === 16 && m.every((v) => Number.isFinite(v));
}

/** Max deviation of the upper-left 3x3 from orthonormality (|RᵀR − I|). */
function orthonormalityError(m: Mat4): number {
	const col = (c: number): [number, number, number] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
	let err = 0;
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			const a = col(i);
			const b = col(j);
			const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
			err = Math.max(err, Math.abs(dot - (i === j ? 1 : 0)));
		}
	}
	return err;
}

const rand = mulberry32(20260611);

/* ---------- test 1: kabsch recovers a known rigid transform ---------- */

// 500 random points in a 40 mm cube as the target cloud.
const targetCloud: Point3[] = [];
for (let i = 0; i < 500; i++) {
	targetCloud.push({
		x: (rand() - 0.5) * 40,
		y: (rand() - 0.5) * 40,
		z: (rand() - 0.5) * 40
	});
}

// Known pose: 25° around a skew axis + translation [8, -5, 12]; source = M·target.
const knownM = rotationTranslationMat4({ x: 1, y: 0.7, z: -0.4 }, 25, { x: 8, y: -5, z: 12 });
const sourceCloud = targetCloud.map((p) => applyMat4(knownM, p));

const recovered = kabsch(sourceCloud, targetCloud);
let kabschMaxErr = 0;
for (let i = 0; i < sourceCloud.length; i++) {
	kabschMaxErr = Math.max(kabschMaxErr, dist(applyMat4(recovered, sourceCloud[i]), targetCloud[i]));
}
check('kabsch recovers inverse of known transform', kabschMaxErr < 1e-6, `max point error ${kabschMaxErr.toExponential(3)} mm`);

// recovered · known should be the identity (also exercises composeMat4 / identityMat4).
const composed = composeMat4(recovered, knownM);
const composeErr = maxAbsDiff(composed, identityMat4());
check('composeMat4(kabsch, known) is identity', composeErr < 1e-6, `max entry error ${composeErr.toExponential(3)}`);

const orthoErr1 = orthonormalityError(recovered);
check('kabsch rotation is orthonormal', orthoErr1 < 1e-9, `|RᵀR − I| ${orthoErr1.toExponential(3)}`);

/* ---------- test 2: degenerate (colinear) input ---------- */

const lineSource: Point3[] = [];
for (let i = 0; i < 10; i++) {
	lineSource.push({ x: i, y: 2 * i, z: -i });
}
const lineM = rotationTranslationMat4({ x: 0.2, y: 1, z: 0.5 }, 40, { x: 3, y: -7, z: 2 });
const lineTarget = lineSource.map((p) => applyMat4(lineM, p));
const lineFit = kabsch(lineSource, lineTarget);
check('colinear points: no NaN in matrix', allFinite(lineFit), `entries finite: ${allFinite(lineFit)}`);
const lineOrtho = orthonormalityError(lineFit);
check('colinear points: rotation still orthonormal', lineOrtho < 1e-9, `|RᵀR − I| ${lineOrtho.toExponential(3)}`);
let lineErr = 0;
for (let i = 0; i < lineSource.length; i++) {
	lineErr = Math.max(lineErr, dist(applyMat4(lineFit, lineSource[i]), lineTarget[i]));
}
check('colinear points: line mapped onto line', lineErr < 1e-6, `max point error ${lineErr.toExponential(3)} mm`);

// Bonus degenerate case: fully coincident points must also stay finite.
const coincident: Point3[] = Array.from({ length: 5 }, () => ({ x: 1, y: 2, z: 3 }));
const coincidentTarget: Point3[] = Array.from({ length: 5 }, () => ({ x: -4, y: 0, z: 9 }));
const coincidentFit = kabsch(coincident, coincidentTarget);
check(
	'coincident points: no NaN, pure translation',
	allFinite(coincidentFit) && dist(applyMat4(coincidentFit, coincident[0]), coincidentTarget[0]) < 1e-9,
	`entries finite: ${allFinite(coincidentFit)}`
);

/* ---------- test 3: ICP with partial overlap and noise ---------- */

// Source: full cloud under a small pose (5° rotation, 2 mm translation).
const tDir = { x: 1, y: -1, z: 0.5 };
const tLen = Math.hypot(tDir.x, tDir.y, tDir.z);
const smallM = rotationTranslationMat4({ x: 0.3, y: 1, z: 0.2 }, 5, {
	x: (tDir.x / tLen) * 2,
	y: (tDir.y / tLen) * 2,
	z: (tDir.z / tLen) * 2
});
const icpSource = targetCloud.map((p) => applyMat4(smallM, p));

// Target: 20% of points removed (partial overlap) + gaussian noise σ = 0.05 mm.
const keep = targetCloud.map((_, i) => i);
for (let i = keep.length - 1; i > 0; i--) {
	const j = Math.floor(rand() * (i + 1));
	[keep[i], keep[j]] = [keep[j], keep[i]];
}
const keptIdx = keep.slice(0, Math.round(targetCloud.length * 0.8));
const icpTarget = keptIdx.map((i) => ({
	x: targetCloud[i].x + gaussian(rand) * 0.05,
	y: targetCloud[i].y + gaussian(rand) * 0.05,
	z: targetCloud[i].z + gaussian(rand) * 0.05
}));

// Coarse-to-fine: a default pass to absorb the initial pose, then a tight
// pass that rejects the ~20% of source points whose true match was removed.
const coarse = icp(icpSource, icpTarget);
const coarseAligned = icpSource.map((p) => applyMat4(coarse.transform, p));
const fine = icp(coarseAligned, icpTarget, { maxPairDistance: 0.6 });
const total = composeMat4(fine.transform, coarse.transform);

check(
	'icp converges (rms < 0.15 mm)',
	Number.isFinite(fine.rms) && fine.rms < 0.15,
	`rms ${fine.rms.toFixed(4)} mm after ${coarse.iterations}+${fine.iterations} iterations`
);

// Recovered transform must map every source point near its TRUE correspondence
// (the noise-free original target point), including points removed from target.
let sumSq = 0;
for (let i = 0; i < icpSource.length; i++) {
	const d = dist(applyMat4(total, icpSource[i]), targetCloud[i]);
	sumSq += d * d;
}
const trueRms = Math.sqrt(sumSq / icpSource.length);
check('icp recovers true pose (RMS < 0.3 mm vs true correspondences)', trueRms < 0.3, `true-correspondence RMS ${trueRms.toFixed(4)} mm`);

/* ---------- summary ---------- */

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks PASSED');
