/**
 * One-shot volume reorientation (bake-in resample) for the
 * "Align Patient Coordinate System" dialog.
 */

const DEG = Math.PI / 180;
const FILL_HU = -1000;

/** Row-major 3×3 of R = Rz(yaw)·Ry(pitch)·Rx(roll), degrees — the rotation applied to anatomy. */
export function rotationMatrix(yaw: number, pitch: number, roll: number): number[] {
	const cosY = Math.cos(yaw * DEG);
	const sinY = Math.sin(yaw * DEG);
	const cosP = Math.cos(pitch * DEG);
	const sinP = Math.sin(pitch * DEG);
	const cosR = Math.cos(roll * DEG);
	const sinR = Math.sin(roll * DEG);
	return [
		cosY * cosP, cosY * sinP * sinR - sinY * cosR, cosY * sinP * cosR + sinY * sinR,
		sinY * cosP, sinY * sinP * sinR + cosY * cosR, sinY * sinP * cosR - cosY * sinR,
		-sinP, cosP * sinR, cosP * cosR
	];
}

/**
 * Rotate an HU volume about its center in physical (mm) space by
 * R = Rz(yaw)·Ry(pitch)·Rx(roll) (angles in degrees; x = cols axis,
 * y = rows axis, z = slices axis).
 *
 * The output has the same dims and spacing. Each output voxel's mm position
 * is mapped through R⁻¹ (= Rᵀ) around the volume center and trilinearly
 * sampled from the source; out-of-bounds samples become -1000 HU.
 */
export function rotateVolume(
	vol: Int16Array,
	dims: [number, number, number],
	spacing: [number, number, number],
	yaw: number,
	pitch: number,
	roll: number
): Int16Array {
	const [nx, ny, nz] = dims;
	const [sx, sy, sz] = spacing;

	const cosY = Math.cos(yaw * DEG);
	const sinY = Math.sin(yaw * DEG);
	const cosP = Math.cos(pitch * DEG);
	const sinP = Math.sin(pitch * DEG);
	const cosR = Math.cos(roll * DEG);
	const sinR = Math.sin(roll * DEG);

	// R = Rz(yaw)·Ry(pitch)·Rx(roll)
	const r00 = cosY * cosP;
	const r01 = cosY * sinP * sinR - sinY * cosR;
	const r02 = cosY * sinP * cosR + sinY * sinR;
	const r10 = sinY * cosP;
	const r11 = sinY * sinP * sinR + cosY * cosR;
	const r12 = sinY * sinP * cosR - cosY * sinR;
	const r20 = -sinP;
	const r21 = cosP * sinR;
	const r22 = cosP * cosR;

	// inverse mapping (output → source) is the transpose
	const t00 = r00, t01 = r10, t02 = r20;
	const t10 = r01, t11 = r11, t12 = r21;
	const t20 = r02, t21 = r12, t22 = r22;

	// volume center in mm (voxel-center convention: voxel i sits at i·spacing)
	const cx = ((nx - 1) / 2) * sx;
	const cy = ((ny - 1) / 2) * sy;
	const cz = ((nz - 1) / 2) * sz;

	// per-step source deltas (in source voxel coords) for one step along output x
	const du = (t00 * sx) / sx;
	const dv = (t10 * sx) / sy;
	const dw = (t20 * sx) / sz;

	const nxy = nx * ny;
	const maxU = nx - 1;
	const maxV = ny - 1;
	const maxW = nz - 1;
	const out = new Int16Array(nx * ny * nz);

	for (let k = 0; k < nz; k++) {
		const dz = k * sz - cz;
		for (let j = 0; j < ny; j++) {
			const dy = j * sy - cy;
			// source position (voxel coords) for output voxel (0, j, k)
			let u = (t00 * -cx + t01 * dy + t02 * dz + cx) / sx;
			let v = (t10 * -cx + t11 * dy + t12 * dz + cy) / sy;
			let w = (t20 * -cx + t21 * dy + t22 * dz + cz) / sz;
			let idx = k * nxy + j * nx;
			for (let i = 0; i < nx; i++, idx++, u += du, v += dv, w += dw) {
				if (u < 0 || v < 0 || w < 0 || u > maxU || v > maxV || w > maxW) {
					out[idx] = FILL_HU;
					continue;
				}
				const u0 = u | 0; // u ≥ 0, so trunc == floor
				const v0 = v | 0;
				const w0 = w | 0;
				const fu = u - u0;
				const fv = v - v0;
				const fw = w - w0;
				const u1 = u0 < maxU ? u0 + 1 : u0;
				const v1 = v0 < maxV ? v0 + 1 : v0;
				const w1 = w0 < maxW ? w0 + 1 : w0;
				const b00 = w0 * nxy + v0 * nx;
				const b01 = w0 * nxy + v1 * nx;
				const b10 = w1 * nxy + v0 * nx;
				const b11 = w1 * nxy + v1 * nx;
				const x00 = vol[b00 + u0] + (vol[b00 + u1] - vol[b00 + u0]) * fu;
				const x01 = vol[b01 + u0] + (vol[b01 + u1] - vol[b01 + u0]) * fu;
				const x10 = vol[b10 + u0] + (vol[b10 + u1] - vol[b10 + u0]) * fu;
				const x11 = vol[b11 + u0] + (vol[b11 + u1] - vol[b11 + u0]) * fu;
				const y0 = x00 + (x01 - x00) * fv;
				const y1 = x10 + (x11 - x10) * fv;
				out[idx] = Math.round(y0 + (y1 - y0) * fw);
			}
		}
	}
	return out;
}
