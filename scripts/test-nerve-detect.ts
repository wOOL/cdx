/**
 * Automatic nerve detection smoke test: synthetic 96^3 bone block (HU 1200)
 * containing a curved low-HU tube (HU -100, radius 2 voxels); the detected
 * path must follow the tube centreline.
 *   bun run scripts/test-nerve-detect.ts
 */
import { detectNervePath, type VolumeGrid, type Pt3 } from '../src/lib/server/nervePath';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- build the synthetic volume ----
const N = 96;
const SP = 0.5; // mm, isotropic
const data = new Int16Array(N * N * N).fill(1200);

// Curved centreline in voxel coords: x sweeps 16→80, y bows out by 12 voxels, z drifts 36→52.
function centerVox(t: number): { x: number; y: number; z: number } {
	return { x: 16 + 64 * t, y: 48 + 12 * Math.sin(Math.PI * t), z: 36 + 16 * t };
}

// Carve the tube (radius 2 voxels) at HU -100.
const R = 2;
for (let s = 0; s <= 800; s++) {
	const c = centerVox(s / 800);
	const cx = Math.round(c.x);
	const cy = Math.round(c.y);
	const cz = Math.round(c.z);
	for (let dz = -R - 1; dz <= R + 1; dz++) {
		for (let dy = -R - 1; dy <= R + 1; dy++) {
			for (let dx = -R - 1; dx <= R + 1; dx++) {
				const x = cx + dx;
				const y = cy + dy;
				const z = cz + dz;
				if (x < 0 || x >= N || y < 0 || y >= N || z < 0 || z >= N) continue;
				const ddx = x - c.x;
				const ddy = y - c.y;
				const ddz = z - c.z;
				if (ddx * ddx + ddy * ddy + ddz * ddz <= R * R) {
					data[z * N * N + y * N + x] = -100;
				}
			}
		}
	}
}

const vol: VolumeGrid = {
	data,
	dims: { x: N, y: N, z: N },
	spacing: { x: SP, y: SP, z: SP }
};

const toMm = (v: { x: number; y: number; z: number }): Pt3 => ({
	x: v.x * SP,
	y: v.y * SP,
	z: v.z * SP
});

// Dense centreline samples in mm for distance checks.
const centreline: Pt3[] = [];
for (let s = 0; s <= 800; s++) centreline.push(toMm(centerVox(s / 800)));

function distToCentreline(p: Pt3): number {
	let best = Infinity;
	for (const c of centreline) {
		const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
		if (d < best) best = d;
	}
	return best;
}

/** Resample a polyline at ~0.25 mm intervals. */
function densify(pts: Pt3[]): Pt3[] {
	const out: Pt3[] = [];
	for (let i = 0; i + 1 < pts.length; i++) {
		const a = pts[i];
		const b = pts[i + 1];
		const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
		const steps = Math.max(1, Math.ceil(len / 0.25));
		for (let s = 0; s < steps; s++) {
			const t = s / steps;
			out.push({
				x: a.x + (b.x - a.x) * t,
				y: a.y + (b.y - a.y) * t,
				z: a.z + (b.z - a.z) * t
			});
		}
	}
	out.push(pts[pts.length - 1]);
	return out;
}

// ---- test 1: detection through the tube ----
const A = toMm(centerVox(0));
const B = toMm(centerVox(1));
const t0 = performance.now();
const res = detectNervePath(vol, A, B);
const ms = Math.round(performance.now() - t0);

check('detection returns points', res.points.length >= 2, `${res.points.length} points, ${ms}ms`);
check('at most 25 points', res.points.length <= 25, `${res.points.length}`);
check('warning is non-null', res.warning !== null, String(res.warning));
check(
	'warning carries the manual-verification caution',
	(res.warning ?? '').includes('verify the nerve course manually')
);
check(
	'no low-confidence note for an in-canal path',
	!(res.warning ?? '').includes('low confidence'),
	String(res.warning)
);

const startErr = Math.hypot(res.points[0].x - A.x, res.points[0].y - A.y, res.points[0].z - A.z);
const endLast = res.points[res.points.length - 1];
const endErr = Math.hypot(endLast.x - B.x, endLast.y - B.y, endLast.z - B.z);
check('path starts at the first seed', startErr <= 1.0, `${startErr.toFixed(2)}mm`);
check('path ends at the second seed', endErr <= 1.0, `${endErr.toFixed(2)}mm`);

const samples = densify(res.points);
let within = 0;
let worst = 0;
for (const p of samples) {
	const d = distToCentreline(p);
	if (d <= 2.0) within++;
	if (d > worst) worst = d;
}
const frac = within / samples.length;
check(
	'>90% of path within 2mm of tube centreline',
	frac > 0.9,
	`${(frac * 100).toFixed(1)}% within, worst ${worst.toFixed(2)}mm`
);

// ---- test 2: seeds in solid bone (no corridor) ----
// A path always exists (just expensive through HU 1200), so the high-cost
// warning must trigger instead of a failure.
const A2 = toMm({ x: 10, y: 10, z: 10 });
const B2 = toMm({ x: 40, y: 12, z: 12 });
const res2 = detectNervePath(vol, A2, B2);
check('solid-bone seeds still yield a path', res2.points.length >= 2, `${res2.points.length} points`);
check('solid-bone path has at most 25 points', res2.points.length <= 25);
check(
	'low-confidence warning triggers in solid bone',
	(res2.warning ?? '').includes('low confidence: path crosses high-density voxels'),
	String(res2.warning)
);
check(
	'solid-bone warning still carries the manual-verification caution',
	(res2.warning ?? '').includes('verify the nerve course manually')
);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
