/**
 * Canvas helpers for the AI review wizard — pure client-side, no imports from
 * the planning viewers. Slice bitmaps are windowed once per (plane, index)
 * and cached; overlays are redrawn cheaply on top.
 */
import type { Slice } from '$lib/client/sliceCache';

export type Plane = 'axial' | 'coronal' | 'sagittal';

/** Mesh entry for MeshCanvas (3D objects step). */
export interface WizardMesh {
	id: number;
	positions: Float32Array | null; // triangle soup, mesh-local mm
	color: string;
	visible: boolean;
	transform: number[] | null; // column-major 4×4 | null
}

/** Tooth chart entry (FDI position → detected AI tooth model). */
export interface ToothEntry {
	modelId: number;
	selected: boolean;
	ok: boolean;
}

export interface DsGeom {
	cols: number;
	rows: number;
	slices: number;
	sx: number;
	sy: number;
	sz: number;
	windowCenter: number;
	windowWidth: number;
}

/** In-plane mm extents of a plane's slice image. */
export function planeExtent(plane: Plane, g: DsGeom): { w: number; h: number } {
	if (plane === 'axial') return { w: g.cols * g.sx, h: g.rows * g.sy };
	if (plane === 'coronal') return { w: g.cols * g.sx, h: g.slices * g.sz };
	return { w: g.rows * g.sy, h: g.slices * g.sz };
}

export function planeSliceCount(plane: Plane, g: DsGeom): number {
	return plane === 'axial' ? g.slices : plane === 'coronal' ? g.rows : g.cols;
}

/**
 * Maps in-plane mm coordinates (u, v) ↔ canvas px. Plane conventions follow
 * the /slice endpoint's extractSlice:
 *  - axial:    u = x mm, v = y mm (row 0 = y 0)
 *  - coronal:  u = x mm, v = z mm (row 0 = TOP of head, z flipped)
 *  - sagittal: u = y mm, v = z mm (row 0 = TOP of head, z flipped)
 */
export interface ViewMap {
	plane: Plane;
	scale: number;
	ox: number;
	oy: number;
	wMm: number;
	hMm: number;
	flipV: boolean;
	toCanvas(u: number, v: number): { x: number; y: number };
	toMm(x: number, y: number): { u: number; v: number };
}

export function makeViewMap(plane: Plane, g: DsGeom, cw: number, ch: number): ViewMap {
	const { w, h } = planeExtent(plane, g);
	const scale = Math.min(cw / w, ch / h) || 1;
	const ox = (cw - w * scale) / 2;
	const oy = (ch - h * scale) / 2;
	const flipV = plane !== 'axial';
	return {
		plane,
		scale,
		ox,
		oy,
		wMm: w,
		hMm: h,
		flipV,
		toCanvas(u, v) {
			return { x: ox + u * scale, y: flipV ? oy + (h - v) * scale : oy + v * scale };
		},
		toMm(x, y) {
			const u = (x - ox) / scale;
			const vRaw = (y - oy) / scale;
			return { u, v: flipV ? h - vRaw : vRaw };
		}
	};
}

/** Window an Int16 HU slice into a grayscale canvas (done once, then cached). */
export function sliceToBitmap(slice: Slice, g: DsGeom): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = slice.width;
	c.height = slice.height;
	const ctx = c.getContext('2d')!;
	const img = ctx.createImageData(slice.width, slice.height);
	const lo = g.windowCenter - g.windowWidth / 2;
	const ww = g.windowWidth || 1;
	const d = img.data;
	const src = slice.data;
	for (let i = 0; i < src.length; i++) {
		let v = ((src[i] - lo) / ww) * 255;
		v = v < 0 ? 0 : v > 255 ? 255 : v;
		const o = i * 4;
		d[o] = d[o + 1] = d[o + 2] = v;
		d[o + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	return c;
}

/**
 * Mesh ∩ plane contour segments in in-plane mm: [u1,v1,u2,v2]×n.
 * positions = triangle soup (mesh-local), transform = column-major 4×4 | null,
 * mm = plane position (axial: z, coronal: y, sagittal: x).
 */
export function planeContours(
	positions: Float32Array,
	transform: number[] | null,
	plane: Plane,
	mm: number
): Float32Array {
	const t = transform && transform.length === 16 ? transform : null;
	// world-axis index sliced on + the two in-plane output axes
	const k = plane === 'axial' ? 2 : plane === 'coronal' ? 1 : 0;
	const ua = plane === 'sagittal' ? 1 : 0;
	const va = plane === 'axial' ? 1 : 2;
	const segs: number[] = [];
	const w = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // transformed triangle (x,y,z ×3)
	for (let i = 0; i < positions.length; i += 9) {
		for (let v = 0; v < 3; v++) {
			const x = positions[i + v * 3];
			const y = positions[i + v * 3 + 1];
			const z = positions[i + v * 3 + 2];
			if (t) {
				w[v * 3] = t[0] * x + t[4] * y + t[8] * z + t[12];
				w[v * 3 + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
				w[v * 3 + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
			} else {
				w[v * 3] = x;
				w[v * 3 + 1] = y;
				w[v * 3 + 2] = z;
			}
		}
		const d1 = w[k] - mm;
		const d2 = w[3 + k] - mm;
		const d3 = w[6 + k] - mm;
		if ((d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0)) continue;
		const pts: number[] = [];
		const edges: [number, number, number, number][] = [
			[0, 3, d1, d2],
			[3, 6, d2, d3],
			[6, 0, d3, d1]
		];
		for (const [a, b, da, db] of edges) {
			if ((da > 0) === (db > 0)) continue;
			const f = Math.abs(da) / (Math.abs(da) + Math.abs(db) || 1);
			pts.push(w[a + ua] + (w[b + ua] - w[a + ua]) * f, w[a + va] + (w[b + va] - w[a + va]) * f);
		}
		if (pts.length === 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
	}
	return new Float32Array(segs);
}

/** Axis-aligned bounds of a (transformed) triangle soup. */
export function meshBounds(
	positions: Float32Array,
	transform: number[] | null
): { min: [number, number, number]; max: [number, number, number]; center: [number, number, number] } {
	const t = transform && transform.length === 16 ? transform : null;
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	const stride = Math.max(3, Math.floor(positions.length / 3 / 20000) * 3);
	for (let i = 0; i + 2 < positions.length; i += stride) {
		let x = positions[i];
		let y = positions[i + 1];
		let z = positions[i + 2];
		if (t) {
			const tx = t[0] * x + t[4] * y + t[8] * z + t[12];
			const ty = t[1] * x + t[5] * y + t[9] * z + t[13];
			const tz = t[2] * x + t[6] * y + t[10] * z + t[14];
			x = tx;
			y = ty;
			z = tz;
		}
		if (x < min[0]) min[0] = x;
		if (y < min[1]) min[1] = y;
		if (z < min[2]) min[2] = z;
		if (x > max[0]) max[0] = x;
		if (y > max[1]) max[1] = y;
		if (z > max[2]) max[2] = z;
	}
	return {
		min,
		max,
		center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
	};
}

/**
 * Column-major rigid transform: rotate by ZYX Euler angles (deg) about
 * `center`, then translate by t — used to compose fine-alignment nudges.
 */
export function rigidFromEuler(
	rxDeg: number,
	ryDeg: number,
	rzDeg: number,
	t: { x: number; y: number; z: number },
	center: { x: number; y: number; z: number }
): number[] {
	const d = Math.PI / 180;
	const cx = Math.cos(rxDeg * d);
	const sx = Math.sin(rxDeg * d);
	const cy = Math.cos(ryDeg * d);
	const sy = Math.sin(ryDeg * d);
	const cz = Math.cos(rzDeg * d);
	const sz = Math.sin(rzDeg * d);
	// R = Rz·Ry·Rx, row-major rows
	const r00 = cz * cy;
	const r01 = cz * sy * sx - sz * cx;
	const r02 = cz * sy * cx + sz * sx;
	const r10 = sz * cy;
	const r11 = sz * sy * sx + cz * cx;
	const r12 = sz * sy * cx - cz * sx;
	const r20 = -sy;
	const r21 = cy * sx;
	const r22 = cy * cx;
	const tx = center.x + t.x - (r00 * center.x + r01 * center.y + r02 * center.z);
	const ty = center.y + t.y - (r10 * center.x + r11 * center.y + r12 * center.z);
	const tz = center.z + t.z - (r20 * center.x + r21 * center.y + r22 * center.z);
	// column-major layout
	return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, tx, ty, tz, 1];
}
