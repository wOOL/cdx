import type { Dataset } from '$lib/types';

/** Bilinear sample of one axial plane at fractional voxel coords (vx, vy). */
function sampleXY(vol: Int16Array, ds: Dataset, vx: number, vy: number, z: number): number {
	const C = ds.cols;
	const R = ds.rows;
	if (vx < 0 || vy < 0 || vx > C - 1 || vy > R - 1) return -1000;
	const x0 = Math.floor(vx);
	const y0 = Math.floor(vy);
	const x1 = Math.min(C - 1, x0 + 1);
	const y1 = Math.min(R - 1, y0 + 1);
	const fx = vx - x0;
	const fy = vy - y0;
	const base = z * C * R;
	const v00 = vol[base + y0 * C + x0];
	const v10 = vol[base + y0 * C + x1];
	const v01 = vol[base + y1 * C + x0];
	const v11 = vol[base + y1 * C + x1];
	return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/**
 * Curved planar reformation along a polyline (mm coords in volume space).
 * Output: width = polyline length, height = slices; row 0 = top of volume (max z).
 * thickness: slab half-width in mm averaged along the curve normal.
 */
export function panoImage(
	vol: Int16Array,
	ds: Dataset,
	polyline: { x: number; y: number }[],
	normals: { x: number; y: number }[] | null = null,
	thickness = 0
): { width: number; height: number; data: Int16Array } {
	const W = polyline.length;
	const S = ds.slices;
	const out = new Int16Array(W * S);
	const sx = ds.spacing_x;
	const sy = ds.spacing_y;

	const slabOffsets: number[] = [0];
	if (thickness > 0 && normals) {
		const step = Math.min(sx, sy);
		for (let o = step; o <= thickness; o += step) {
			slabOffsets.push(o, -o);
		}
	}

	for (let i = 0; i < W; i++) {
		const p = polyline[i];
		const n = normals?.[i] ?? { x: 0, y: 0 };
		for (let z = 0; z < S; z++) {
			let acc = 0;
			for (const o of slabOffsets) {
				const vx = (p.x + n.x * o) / sx;
				const vy = (p.y + n.y * o) / sy;
				acc += sampleXY(vol, ds, vx, vy, z);
			}
			out[(S - 1 - z) * W + i] = acc / slabOffsets.length;
		}
	}
	return { width: W, height: S, data: out };
}

/**
 * Cross-section perpendicular to the curve at a point:
 * plane spanned by `dir` (unit, mm, in xy) and the z axis.
 * Output: width = 2*halfWidth/step+1 (col 0 = -halfWidth side), height = slices (row 0 = max z).
 */
export function crossImage(
	vol: Int16Array,
	ds: Dataset,
	origin: { x: number; y: number },
	dir: { x: number; y: number },
	halfWidth: number,
	step: number
): { width: number; height: number; data: Int16Array } {
	const half = Math.max(1, Math.round(halfWidth / step));
	const W = half * 2 + 1;
	const S = ds.slices;
	const out = new Int16Array(W * S);
	const sx = ds.spacing_x;
	const sy = ds.spacing_y;

	for (let i = 0; i < W; i++) {
		const o = (i - half) * step;
		const vx = (origin.x + dir.x * o) / sx;
		const vy = (origin.y + dir.y * o) / sy;
		for (let z = 0; z < S; z++) {
			out[(S - 1 - z) * W + i] = sampleXY(vol, ds, vx, vy, z);
		}
	}
	return { width: W, height: S, data: out };
}
