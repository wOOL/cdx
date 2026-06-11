/**
 * PCS + panoramic-curve auto-proposal test.
 *
 * Builds a synthetic horseshoe arch (HU 1200, half-width 3 mm, 12 mm tall
 * slab) whose level-frame geometry is known, stamps it into the volume tilted
 * by yaw = 12°, roll = 6° (the voxel positions are pulled back through the
 * inverse tilt, exactly how /align bakes rotations), and asserts:
 *  - proposePcs recovers the correcting angles (≈ Euler angles of the inverse
 *    tilt: yaw ≈ -12°, pitch ≈ 0°, roll ≈ -6°) within 4°,
 *  - the curve is non-null with ≥ 12 points whose mean distance to the true
 *    arch centreline (level frame = post-align frame) is < 4 mm,
 *  - confidence is 'good',
 *  - an empty volume yields confidence 'low', null curve, zero angles.
 *
 *   bun run scripts/test-pcs-proposal.ts
 */
import { proposePcs, type PcsVolume } from '../src/lib/server/pcsProposal';
import { rotationMatrix } from '../src/lib/server/resample';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- volume geometry (volumeCache conventions: Int16, x fastest, voxel centre = i·spacing) ----
const NX = 160;
const NY = 160;
const NZ = 100;
const SP = 0.5; // mm, isotropic
const cX = ((NX - 1) / 2) * SP;
const cY = ((NY - 1) / 2) * SP;
const cZ = ((NZ - 1) / 2) * SP;

// level-frame arch centreline: horseshoe opening towards -y (anterior = +y),
// parameter a ∈ [-1.25, 1.25] rad, relative to the volume centre
function archPoint(a: number): { x: number; y: number } {
	return { x: cX + 30 * Math.sin(a), y: cY + 22 * Math.cos(a) - 4 };
}
const CENTERLINE: { x: number; y: number }[] = [];
for (let i = 0; i <= 256; i++) {
	CENTERLINE.push(archPoint(-1.25 + (2.5 * i) / 256));
}
const HALF_WIDTH = 3; // mm — outer edge − 3 mm lands on the centreline
const HALF_HEIGHT = 6; // mm slab half-thickness

function dist2ToCenterline(x: number, y: number): number {
	let best = Infinity;
	for (const p of CENTERLINE) {
		const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
		if (d < best) best = d;
	}
	return best;
}

// ---- stamp the arch tilted by yaw=12°, roll=6° ----
// /align rotates anatomy by R = rotationMatrix(yaw, pitch, roll); to stamp a
// tilted arch we pull each voxel position back through Rᵀ (level frame) and
// test it against the level-frame arch.
const YAW = 12;
const ROLL = 6;
const R = rotationMatrix(YAW, 0, ROLL); // row-major, anatomy rotation

const data = new Int16Array(NX * NY * NZ).fill(-1000);
const hw2 = HALF_WIDTH * HALF_WIDTH;
for (let z = 0; z < NZ; z++) {
	const dz = z * SP - cZ;
	for (let y = 0; y < NY; y++) {
		const dy = y * SP - cY;
		for (let x = 0; x < NX; x++) {
			const dx = x * SP - cX;
			// level position q = Rᵀ·(p − c) + c
			const qz = cZ + R[2] * dx + R[5] * dy + R[8] * dz;
			if (Math.abs(qz - cZ) > HALF_HEIGHT) continue;
			const qxv = cX + R[0] * dx + R[3] * dy + R[6] * dz;
			const qyv = cY + R[1] * dx + R[4] * dy + R[7] * dz;
			if (dist2ToCenterline(qxv, qyv) <= hw2) {
				data[z * NX * NY + y * NX + x] = 1200;
			}
		}
	}
}

const vol: PcsVolume = {
	data,
	dims: { x: NX, y: NY, z: NZ },
	spacing: { x: SP, y: SP, z: SP }
};

// ---- run + assert ----
const t0 = performance.now();
const prop = proposePcs(vol);
const ms = (performance.now() - t0).toFixed(0);
console.log(
	`proposal: yaw=${prop.yaw.toFixed(2)}° pitch=${prop.pitch.toFixed(2)}° roll=${prop.roll.toFixed(2)}° ` +
		`curve=${prop.curve ? prop.curve.length + ' pts' : 'null'} confidence=${prop.confidence} (${ms} ms)`
);

check('confidence is good', prop.confidence === 'good');
// the exact correction is R_tiltᵀ; its ZYX Euler angles are ≈ (-11.94, -1.25, -5.87)
check('yaw recovered within 4°', Math.abs(prop.yaw - -YAW) <= 4, `${prop.yaw.toFixed(2)}° vs -12°`);
check('pitch recovered within 4°', Math.abs(prop.pitch) <= 4, `${prop.pitch.toFixed(2)}° vs ~0°`);
check('roll recovered within 4°', Math.abs(prop.roll - -ROLL) <= 4, `${prop.roll.toFixed(2)}° vs -6°`);
check(
	'angles compose to the inverse tilt (≤ 4° residual)',
	(() => {
		const C = rotationMatrix(prop.yaw, prop.pitch, prop.roll);
		// C should undo the tilt: Q = C·R ≈ I; residual angle = acos((tr(Q)−1)/2)
		const tr =
			C[0] * R[0] + C[1] * R[3] + C[2] * R[6] +
			C[3] * R[1] + C[4] * R[4] + C[5] * R[7] +
			C[6] * R[2] + C[7] * R[5] + C[8] * R[8];
			C[3] * R[3] + C[4] * R[4] + C[5] * R[5] +
			C[6] * R[6] + C[7] * R[7] + C[8] * R[8];
		const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * (180 / Math.PI);
		return ang <= 4;
	})()
);

check('curve is non-null', prop.curve !== null);
if (prop.curve) {
	check(
		`curve has ≥ 12 points (12–20)`,
		prop.curve.length >= 12 && prop.curve.length <= 20,
		`${prop.curve.length} points`
	);
	// curve is in the post-align frame == the level frame here
	let sum = 0;
	let worst = 0;
	for (const p of prop.curve) {
		const d = Math.sqrt(dist2ToCenterline(p.x, p.y));
		sum += d;
		if (d > worst) worst = d;
	}
	const mean = sum / prop.curve.length;
	check(
		'mean curve distance to true centreline < 4 mm',
		mean < 4,
		`mean ${mean.toFixed(2)} mm, worst ${worst.toFixed(2)} mm`
	);
	// anterior (curve middle) should sit near the front of the arch (max y)
	const mid = prop.curve[Math.floor(prop.curve.length / 2)];
	const front = archPoint(0);
	check(
		'curve middle is anterior',
		Math.hypot(mid.x - front.x, mid.y - front.y) < 8,
		`middle (${mid.x.toFixed(1)}, ${mid.y.toFixed(1)}) vs front (${front.x.toFixed(1)}, ${front.y.toFixed(1)})`
	);
}

// ---- degenerate: empty volume ----
const empty: PcsVolume = {
	data: new Int16Array(64 * 64 * 32).fill(-1000),
	dims: { x: 64, y: 64, z: 32 },
	spacing: { x: 0.5, y: 0.5, z: 0.5 }
};
const low = proposePcs(empty);
check(
	'empty volume → low confidence, null curve, zero angles',
	low.confidence === 'low' && low.curve === null && low.yaw === 0 && low.pitch === 0 && low.roll === 0
);

// ---- degenerate: tiny bone speck (area < 2 cm²) ----
const speck = new Int16Array(64 * 64 * 32).fill(-1000);
for (let z = 14; z < 18; z++)
	for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) speck[z * 64 * 64 + y * 64 + x] = 1200;
const lowSpeck = proposePcs({ data: speck, dims: { x: 64, y: 64, z: 32 }, spacing: { x: 0.5, y: 0.5, z: 0.5 } });
check('tiny bone speck → low confidence, null curve', lowSpeck.confidence === 'low' && lowSpeck.curve === null);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
