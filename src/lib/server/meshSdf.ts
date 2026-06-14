/**
 * Mesh offset / thickening via a voxel distance field.
 *
 * The robust primitive several restoration design steps need: turn a surface
 * mesh (possibly OPEN, like a scan or a library-tooth shell) into a watertight
 * SOLID by thickening it ±halfThickness. Each triangle splats its true 3-D
 * unsigned distance into a voxel grid (value = halfThickness − distance), and
 * marching cubes extracts the iso-0 surface — a shell of total thickness
 * 2·halfThickness that hugs the input. No inside/outside test is required, so
 * it is robust on open meshes. Reused by copings, splints, models and the
 * crown intrados (offset + boolean).
 */
import { marchingCubes } from './marchingCubes';

const SCALE = 1000; // mm → field units (clamped to int16, ±32 mm)

/** Squared distance from point p to triangle abc (Ericson, closest-point). */
function pointTriSq(
	px: number, py: number, pz: number,
	ax: number, ay: number, az: number,
	bx: number, by: number, bz: number,
	cx: number, cy: number, cz: number
): number {
	const abx = bx - ax, aby = by - ay, abz = bz - az;
	const acx = cx - ax, acy = cy - ay, acz = cz - az;
	const apx = px - ax, apy = py - ay, apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

	const bpx = px - bx, bpy = py - by, bpz = pz - bz;
	const d3 = abx * bpx + aby * bpy + abz * bpz;
	const d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		const qx = apx - v * abx, qy = apy - v * aby, qz = apz - v * abz;
		return qx * qx + qy * qy + qz * qz;
	}

	const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
	const d5 = abx * cpx + aby * cpy + abz * cpz;
	const d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		const qx = apx - w * acx, qy = apy - w * acy, qz = apz - w * acz;
		return qx * qx + qy * qy + qz * qz;
	}

	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		const qx = bpx + w * (cx - bx), qy = bpy + w * (cy - by), qz = bpz + w * (cz - bz);
		return qx * qx + qy * qy + qz * qz;
	}

	const denom = 1 / (va + vb + vc);
	const v = vb * denom, w = vc * denom;
	const qx = apx - (abx * v + acx * w), qy = apy - (aby * v + acy * w), qz = apz - (abz * v + acz * w);
	return qx * qx + qy * qy + qz * qz;
}

export interface ThickenOptions {
	/** half the shell thickness in mm (shell is 2·halfThickness thick) */
	halfThickness: number;
	/** voxel size in mm (default 0.2) */
	voxel?: number;
	/** hard cap on grid voxels per axis to bound memory (default 400) */
	maxAxis?: number;
}

/**
 * Thicken a triangle mesh (soup or indexed) into a watertight solid shell.
 * Returns a triangle soup (Float32, length divisible by 9), in input coords.
 */
export function thickenSurface(
	positions: Float32Array,
	index: Uint32Array | undefined,
	opts: ThickenOptions
): Float32Array {
	const halfT = opts.halfThickness;
	let voxel = opts.voxel ?? 0.2;
	const maxAxis = opts.maxAxis ?? 400;
	const triCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
	if (triCount === 0) return new Float32Array(0);

	const vx = (t: number, c: number, k: number) => {
		const vi = index ? index[t * 3 + c] : t * 3 + c;
		return positions[vi * 3 + k];
	};

	// bbox, padded so the shell closes inside the grid
	let minx = Infinity, miny = Infinity, minz = Infinity;
	let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i], y = positions[i + 1], z = positions[i + 2];
		if (x < minx) minx = x; if (x > maxx) maxx = x;
		if (y < miny) miny = y; if (y > maxy) maxy = y;
		if (z < minz) minz = z; if (z > maxz) maxz = z;
	}
	const pad = halfT + 2 * voxel;
	const ox = minx - pad, oy = miny - pad, oz = minz - pad;
	const ext = [maxx - minx + 2 * pad, maxy - miny + 2 * pad, maxz - minz + 2 * pad];
	// clamp voxel up so no axis exceeds maxAxis
	const need = Math.max(ext[0], ext[1], ext[2]) / voxel;
	if (need > maxAxis) voxel = Math.max(ext[0], ext[1], ext[2]) / maxAxis;

	const nx = Math.ceil(ext[0] / voxel) + 1;
	const ny = Math.ceil(ext[1] / voxel) + 1;
	const nz = Math.ceil(ext[2] / voxel) + 1;
	const field = new Int16Array(nx * ny * nz).fill(-32767);

	const reach = halfT + voxel;
	for (let t = 0; t < triCount; t++) {
		const ax = vx(t, 0, 0), ay = vx(t, 0, 1), az = vx(t, 0, 2);
		const bx = vx(t, 1, 0), by = vx(t, 1, 1), bz = vx(t, 1, 2);
		const cx = vx(t, 2, 0), cy = vx(t, 2, 1), cz = vx(t, 2, 2);
		const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - reach - ox) / voxel));
		const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) + reach - ox) / voxel));
		const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - reach - oy) / voxel));
		const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) + reach - oy) / voxel));
		const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - reach - oz) / voxel));
		const k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) + reach - oz) / voxel));
		for (let k = k0; k <= k1; k++) {
			const pz = oz + k * voxel;
			for (let j = j0; j <= j1; j++) {
				const py = oy + j * voxel;
				const rowBase = j * nx + k * nx * ny;
				for (let i = i0; i <= i1; i++) {
					const px = ox + i * voxel;
					const d = Math.sqrt(pointTriSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz));
					let val = (halfT - d) * SCALE;
					if (val < -32767) val = -32767; else if (val > 32767) val = 32767;
					const o = i + rowBase;
					if (val > field[o]) field[o] = val;
				}
			}
		}
	}

	const { positions: out } = marchingCubes(field, [nx, ny, nz], [voxel, voxel, voxel], 0);
	for (let i = 0; i + 2 < out.length; i += 3) {
		out[i] += ox;
		out[i + 1] += oy;
		out[i + 2] += oz;
	}
	return out;
}
