/**
 * Resample (bake-in rotation) smoke test: rotate a synthetic volume with an
 * off-center bright box and verify the result geometrically.
 *   bun run scripts/test-resample.ts
 */
import { rotateVolume } from '../src/lib/server/resample';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- build a 64^3 volume with an off-center bright box ----
const N = 64;
const DIMS: [number, number, number] = [N, N, N];
const SPACING: [number, number, number] = [0.5, 0.5, 0.5];
const vol = new Int16Array(N * N * N).fill(-1000);
for (let z = 28; z <= 36; z++) {
	for (let y = 28; y <= 36; y++) {
		for (let x = 40; x <= 50; x++) {
			vol[z * N * N + y * N + x] = 1000;
		}
	}
}

function centerOfMass(v: Int16Array): { com: [number, number, number]; count: number } {
	let sx = 0;
	let sy = 0;
	let sz = 0;
	let n = 0;
	for (let z = 0; z < N; z++) {
		for (let y = 0; y < N; y++) {
			for (let x = 0; x < N; x++) {
				if (v[z * N * N + y * N + x] > 0) {
					sx += x * SPACING[0];
					sy += y * SPACING[1];
					sz += z * SPACING[2];
					n++;
				}
			}
		}
	}
	return { com: n ? [sx / n, sy / n, sz / n] : [NaN, NaN, NaN], count: n };
}

// volume center in mm (voxel-center convention, matching rotateVolume)
const C = ((N - 1) / 2) * SPACING[0];

// ---- check 1: yaw=90 moves the box CoM to the analytically rotated spot ----
{
	const src = centerOfMass(vol);
	const rot = rotateVolume(vol, DIMS, SPACING, 90, 0, 0);
	const got = centerOfMass(rot);
	// Rz(90°): dx' = -dy, dy' = dx, dz' = dz
	const dx = src.com[0] - C;
	const dy = src.com[1] - C;
	const expected: [number, number, number] = [C - dy, C + dx, src.com[2]];
	const err = Math.hypot(
		got.com[0] - expected[0],
		got.com[1] - expected[1],
		got.com[2] - expected[2]
	);
	check(
		'yaw=90 CoM matches analytic rotation within 1.0 mm',
		got.count > 0 && err < 1.0,
		`expected [${expected.map((v) => v.toFixed(2)).join(', ')}], got [${got.com
			.map((v) => v.toFixed(2))
			.join(', ')}], err=${err.toFixed(3)} mm`
	);
}

// ---- check 2: small compound rotation conserves bright mass within 15% ----
{
	const src = centerOfMass(vol);
	const rot = rotateVolume(vol, DIMS, SPACING, 10, 5, -7);
	const got = centerOfMass(rot);
	const ratio = got.count / src.count;
	check(
		'yaw=10 pitch=5 roll=-7 conserves bright voxel count within 15%',
		ratio > 0.85 && ratio < 1.15,
		`${src.count} → ${got.count} voxels (ratio ${ratio.toFixed(3)})`
	);
}

// ---- check 3: out-of-bounds fill — corners are -1000 after 45° yaw ----
{
	const rot = rotateVolume(vol, DIMS, SPACING, 45, 0, 0);
	let ok = true;
	const bad: string[] = [];
	for (const z of [0, N - 1]) {
		for (const y of [0, N - 1]) {
			for (const x of [0, N - 1]) {
				const v = rot[z * N * N + y * N + x];
				if (v !== -1000) {
					ok = false;
					bad.push(`(${x},${y},${z})=${v}`);
				}
			}
		}
	}
	check('corners are -1000 after 45° yaw', ok, bad.length ? bad.join(' ') : 'all 8 corners');
}

process.exit(failures ? 1 : 0);
