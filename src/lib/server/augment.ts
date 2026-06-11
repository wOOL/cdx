/**
 * Augmentation objects (sinus lift / bone graft evaluation, SPEC §5.5).
 *
 * The case page lets the user draw closed outlines on axial slices (with the
 * existing segmentation-boundary tool). From those outlines we build a voxel
 * solid in the dataset grid:
 *
 *   1. Every outlined slice is rasterized with an even-odd scanline fill
 *      (all polygons of the slice contribute edges, so nested outlines make
 *      holes). Sampling is at pixel centers (x+0.5, y+0.5).
 *   2. Slices BETWEEN two outlined slices are interpolated with a
 *      morphological-interpolation approximation: for each (x, y) column the
 *      fill value is the linear blend of the nearest outlined slice below
 *      (k0) and above (k1): v = (1-t)·fill[k0] + t·fill[k1] with
 *      t = (k-k0)/(k1-k0); the voxel is set when v ≥ 0.5. Columns blend
 *      independently — there is no contour warping, so strongly offset
 *      outlines produce a stepped half-way transition rather than a smooth
 *      morph (documented limitation, acceptable for the volume estimate).
 *   3. The "filling material" slider (density, 0–1) scales the fill height
 *      per column: only the lowest round(density·n) of each column's n
 *      filled voxels are kept (minimum 1 layer so Apply always yields a
 *      body). density = 1 keeps the full solid.
 *
 * The solid is meshed with marching cubes (legacy LOD path of buildMaskMesh)
 * and stored as a model row of kind 'other'. The transform column keeps its
 * default (empty ⇒ identity), so the object is positionable afterwards via
 * the regular model PATCH endpoint (donor-site check).
 *
 * ml = filled voxel count × voxel volume (mm³) / 1000.
 */
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { buildMaskMesh } from '$lib/server/segLod';
import { meshToStlBinary } from '$lib/server/stl';
import type { Dataset, Model } from '$lib/types';

export interface OutlinePoint {
	x: number;
	y: number;
}

export const DEFAULT_AUGMENT_COLOR = '#c08a3a';
export const DEFAULT_AUGMENT_NAME = 'Augmentation';

/**
 * Validate the request-body outline set: keys must be integer slice indices
 * within the dataset, values arrays of polygons; polygons need ≥ 3 finite
 * points. Invalid entries are silently dropped.
 */
export function sanitizeOutlines(raw: unknown, ds: Dataset): Map<number, OutlinePoint[][]> {
	const out = new Map<number, OutlinePoint[][]>();
	if (!raw || typeof raw !== 'object') return out;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const idx = Number(key);
		if (!Number.isInteger(idx) || idx < 0 || idx >= ds.slices || !Array.isArray(value)) continue;
		const polys: OutlinePoint[][] = [];
		for (const poly of value) {
			if (!Array.isArray(poly)) continue;
			const pts: OutlinePoint[] = [];
			for (const p of poly) {
				const x = Number((p as OutlinePoint)?.x);
				const y = Number((p as OutlinePoint)?.y);
				if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
			}
			if (pts.length >= 3) polys.push(pts);
		}
		if (polys.length > 0) out.set(idx, polys);
	}
	return out;
}

/** Even-odd scanline rasterization of closed polygons into a C×R bitmap. */
export function rasterizeOutlines(polys: OutlinePoint[][], C: number, R: number): Uint8Array {
	const fill = new Uint8Array(C * R);
	const xs: number[] = [];
	for (let y = 0; y < R; y++) {
		const yc = y + 0.5;
		xs.length = 0;
		for (const poly of polys) {
			for (let i = 0; i < poly.length; i++) {
				const p = poly[i];
				const q = poly[(i + 1) % poly.length]; // closing edge included
				if ((p.y <= yc && q.y > yc) || (q.y <= yc && p.y > yc)) {
					const t = (yc - p.y) / (q.y - p.y);
					xs.push(p.x + t * (q.x - p.x));
				}
			}
		}
		if (xs.length < 2) continue;
		xs.sort((a, b) => a - b);
		const row = y * C;
		for (let i = 0; i + 1 < xs.length; i += 2) {
			// pixel centers x+0.5 in [xs[i], xs[i+1])
			const x0 = Math.max(0, Math.ceil(xs[i] - 0.5));
			const x1 = Math.min(C - 1, Math.ceil(xs[i + 1] - 0.5) - 1);
			for (let x = x0; x <= x1; x++) fill[row + x] = 1;
		}
	}
	return fill;
}

/**
 * Build the augmentation voxel solid (see module doc for the algorithm).
 * Returns the mask plus the filled voxel count.
 */
export function buildAugmentSolid(
	ds: Dataset,
	outlines: Map<number, OutlinePoint[][]>,
	density: number
): { solid: Uint8Array; voxels: number } {
	const C = ds.cols;
	const R = ds.rows;
	const S = ds.slices;
	const CR = C * R;
	const solid = new Uint8Array(C * R * S);

	const keys = [...outlines.keys()].sort((a, b) => a - b);
	const fills = new Map<number, Uint8Array>();
	for (const k of keys) fills.set(k, rasterizeOutlines(outlines.get(k)!, C, R));

	// outlined slices verbatim
	for (const k of keys) solid.set(fills.get(k)!, k * CR);

	// per-column linear blend between consecutive outlined slices
	for (let s = 0; s + 1 < keys.length; s++) {
		const k0 = keys[s];
		const k1 = keys[s + 1];
		const f0 = fills.get(k0)!;
		const f1 = fills.get(k1)!;
		for (let k = k0 + 1; k < k1; k++) {
			const t = (k - k0) / (k1 - k0);
			const base = k * CR;
			for (let p = 0; p < CR; p++) {
				if ((1 - t) * f0[p] + t * f1[p] >= 0.5) solid[base + p] = 1;
			}
		}
	}

	// filling-material slider: keep the lowest round(density·n) voxels per column
	const frac = Math.min(1, Math.max(0, density));
	if (frac < 1) {
		for (let p = 0; p < CR; p++) {
			let n = 0;
			for (let k = 0; k < S; k++) if (solid[k * CR + p]) n++;
			if (n === 0) continue;
			const keep = Math.max(1, Math.round(frac * n));
			let seen = 0;
			for (let k = 0; k < S; k++) {
				const i = k * CR + p;
				if (!solid[i]) continue;
				seen++;
				if (seen > keep) solid[i] = 0;
			}
		}
	}

	let voxels = 0;
	for (let i = 0; i < solid.length; i++) voxels += solid[i];
	return { solid, voxels };
}

/**
 * Full augmentation pipeline: solid → marching cubes → STL file → model row
 * (kind 'other', params { augmentation: true, density, ml }). Throws on an
 * empty solid/surface; callers map that to a 400.
 */
export async function runAugmentation(
	ds: Dataset,
	outlines: Map<number, OutlinePoint[][]>,
	density: number,
	color: string = DEFAULT_AUGMENT_COLOR,
	name: string = DEFAULT_AUGMENT_NAME
): Promise<{ model: Model; ml: number; voxels: number; triangles: number }> {
	if (outlines.size === 0) throw new Error('No valid closed outlines');

	const { solid, voxels } = buildAugmentSolid(ds, outlines, density);
	if (voxels === 0) throw new Error('Outlines enclose no voxels');

	const voxelMm3 = ds.spacing_x * ds.spacing_y * ds.spacing_z;
	const ml = Math.round(((voxels * voxelMm3) / 1000) * 10000) / 10000;

	const mesh = buildMaskMesh(
		solid,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		null
	);
	if (mesh.positions.length === 0) throw new Error('No surface in augmentation solid');

	const path = join(caseRel(ds.case_id), `augment_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(path), meshToStlBinary(mesh.positions, name));

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, params)
			 VALUES (?1, ?2, 'other', ?3, ?4, ?5) RETURNING *`
		)
		.get(
			ds.case_id,
			name,
			path,
			color,
			JSON.stringify({ augmentation: true, density: Math.min(1, Math.max(0, density)), ml, dataset_id: ds.id })
		) as Model;

	return { model, ml, voxels, triangles: mesh.positions.length / 9 };
}
