/**
 * Segmentation boundary polylines: per axial slice, closed polylines (slice
 * pixel coordinates) that constrain paint and flood fill.
 *
 * Constraint model: each slice's polylines are rasterized once (cached) onto
 * a scratch C×R bitmap with 8-connected Bresenham lines, including the
 * closing edge last→first. Those "barrier" pixels can neither be painted nor
 * traversed; because the tools grow 4-connected regions, an 8-connected line
 * is gap-free for them and a fill cannot leak across the boundary.
 *
 * Storage: one sidecar JSON per dataset next to the mask files
 * (`mask_<id>.boundaries.json`), shared by all mask slots.
 */
import { join } from 'node:path';
import { caseRel, resolveData } from '$lib/server/db';
import { applyMat4, type Mat4 } from '$lib/registration';
import type { Dataset } from '$lib/types';

export interface BoundaryPoint {
	x: number;
	y: number;
}

/** sliceIndex → list of closed polylines (pixel coords) */
export type BoundarySet = Record<number, BoundaryPoint[][]>;

const MAX_POLYLINES_PER_SLICE = 64;
const MAX_POINTS_PER_POLYLINE = 10_000;
const MAX_TOTAL_POINTS = 200_000;

function boundaryRelPath(ds: Dataset): string {
	return join(caseRel(ds.case_id), `mask_${ds.id}.boundaries.json`);
}

interface CacheEntry {
	version: number;
	set: BoundarySet;
}

const cache = new Map<number, CacheEntry>();
/** key `${dsId}:${slice}` → rasterized barrier (null = slice has no boundaries) */
const barrierCache = new Map<string, { version: number; bitmap: Uint8Array | null }>();

/**
 * Validate/clamp a raw boundary set. Returns null when the overall structure
 * is malformed; individual out-of-range values are clamped, degenerate
 * polylines (< 3 points) are rejected as malformed input.
 */
export function sanitizeBoundaries(raw: unknown, ds: Dataset): BoundarySet | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const out: BoundarySet = {};
	let totalPoints = 0;
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const index = Number(key);
		if (!Number.isInteger(index) || index < 0 || index >= ds.slices) return null;
		if (!Array.isArray(value) || value.length > MAX_POLYLINES_PER_SLICE) return null;
		const polys: BoundaryPoint[][] = [];
		for (const poly of value) {
			if (!Array.isArray(poly) || poly.length < 3 || poly.length > MAX_POINTS_PER_POLYLINE) {
				return null;
			}
			const pts: BoundaryPoint[] = [];
			for (const p of poly) {
				const x = Number((p as BoundaryPoint)?.x);
				const y = Number((p as BoundaryPoint)?.y);
				if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
				pts.push({
					x: Math.round(Math.max(0, Math.min(ds.cols - 1, x)) * 100) / 100,
					y: Math.round(Math.max(0, Math.min(ds.rows - 1, y)) * 100) / 100
				});
			}
			totalPoints += pts.length;
			if (totalPoints > MAX_TOTAL_POINTS) return null;
			polys.push(pts);
		}
		if (polys.length > 0) out[index] = polys;
	}
	return out;
}

export async function loadBoundaries(ds: Dataset): Promise<BoundarySet> {
	const hit = cache.get(ds.id);
	if (hit) return hit.set;
	let set: BoundarySet = {};
	const file = Bun.file(resolveData(boundaryRelPath(ds)));
	if (await file.exists()) {
		try {
			set = sanitizeBoundaries(await file.json(), ds) ?? {};
		} catch {
			set = {};
		}
	}
	cache.set(ds.id, { version: 1, set });
	return set;
}

export async function saveBoundaries(ds: Dataset, set: BoundarySet): Promise<void> {
	await Bun.write(resolveData(boundaryRelPath(ds)), JSON.stringify(set));
	const prev = cache.get(ds.id);
	cache.set(ds.id, { version: (prev?.version ?? 1) + 1, set });
}

/** Drop cached boundaries (e.g. when a dataset is replaced). */
export function evictBoundaries(dsId: number): void {
	cache.delete(dsId);
	for (const k of [...barrierCache.keys()]) {
		if (k.startsWith(`${dsId}:`)) barrierCache.delete(k);
	}
}

/** 8-connected Bresenham line onto the bitmap. */
function rasterLine(
	bitmap: Uint8Array,
	C: number,
	R: number,
	x0f: number,
	y0f: number,
	x1f: number,
	y1f: number
): void {
	let x0 = Math.round(x0f);
	let y0 = Math.round(y0f);
	const x1 = Math.round(x1f);
	const y1 = Math.round(y1f);
	const dx = Math.abs(x1 - x0);
	const dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	for (;;) {
		if (x0 >= 0 && x0 < C && y0 >= 0 && y0 < R) bitmap[y0 * C + x0] = 1;
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
	}
}

/**
 * Rasterized barrier bitmap (C×R, 1 = boundary pixel) for an axial slice, or
 * null when the slice has no boundary polylines. Cached per boundary version.
 */
export async function getBarrier(ds: Dataset, index: number): Promise<Uint8Array | null> {
	const set = await loadBoundaries(ds);
	const version = cache.get(ds.id)?.version ?? 1;
	const key = `${ds.id}:${index}`;
	const hit = barrierCache.get(key);
	if (hit && hit.version === version) return hit.bitmap;

	const polys = set[index];
	let bitmap: Uint8Array | null = null;
	if (polys && polys.length > 0) {
		const C = ds.cols;
		const R = ds.rows;
		bitmap = new Uint8Array(C * R);
		for (const poly of polys) {
			for (let i = 0; i < poly.length; i++) {
				const a = poly[i];
				const b = poly[(i + 1) % poly.length]; // closing edge included
				rasterLine(bitmap, C, R, a.x, a.y, b.x, b.y);
			}
		}
	}
	barrierCache.set(key, { version, bitmap });
	while (barrierCache.size > 128) {
		const oldest = barrierCache.keys().next().value as string;
		barrierCache.delete(oldest);
	}
	return bitmap;
}

// ---------------------------------------------------------------------------
// Boundary import from a surface model
// ---------------------------------------------------------------------------

/** Chain loose segments [x1,y1,x2,y2,...] into polylines by matching endpoints. */
function chainSegments(segs: number[]): BoundaryPoint[][] {
	const segCount = segs.length / 4;
	// endpoints quantized to a 0.5 px grid for matching
	const key = (x: number, y: number): string => `${Math.round(x * 2)},${Math.round(y * 2)}`;
	const byEnd = new Map<string, number[]>(); // key → seg indices
	for (let s = 0; s < segCount; s++) {
		for (const k of [key(segs[s * 4], segs[s * 4 + 1]), key(segs[s * 4 + 2], segs[s * 4 + 3])]) {
			const list = byEnd.get(k);
			if (list) list.push(s);
			else byEnd.set(k, [s]);
		}
	}
	const used = new Uint8Array(segCount);

	function takeNext(x: number, y: number): [number, number] | null {
		const list = byEnd.get(key(x, y));
		if (!list) return null;
		for (const s of list) {
			if (used[s]) continue;
			used[s] = 1;
			const ax = segs[s * 4];
			const ay = segs[s * 4 + 1];
			const bx = segs[s * 4 + 2];
			const by = segs[s * 4 + 3];
			// return the far endpoint
			if (key(ax, ay) === key(x, y)) return [bx, by];
			return [ax, ay];
		}
		return null;
	}

	const polylines: BoundaryPoint[][] = [];
	for (let s = 0; s < segCount; s++) {
		if (used[s]) continue;
		used[s] = 1;
		const chain: BoundaryPoint[] = [
			{ x: segs[s * 4], y: segs[s * 4 + 1] },
			{ x: segs[s * 4 + 2], y: segs[s * 4 + 3] }
		];
		// extend at the tail
		for (;;) {
			const tail = chain[chain.length - 1];
			const next = takeNext(tail.x, tail.y);
			if (!next) break;
			chain.push({ x: next[0], y: next[1] });
			if (chain.length > MAX_POINTS_PER_POLYLINE) break;
		}
		// extend at the head
		for (;;) {
			const head = chain[0];
			const next = takeNext(head.x, head.y);
			if (!next) break;
			chain.unshift({ x: next[0], y: next[1] });
			if (chain.length > MAX_POINTS_PER_POLYLINE) break;
		}
		// drop the duplicated closing point of closed loops
		if (
			chain.length > 3 &&
			key(chain[0].x, chain[0].y) === key(chain[chain.length - 1].x, chain[chain.length - 1].y)
		) {
			chain.pop();
		}
		if (chain.length >= 3) {
			polylines.push(
				chain.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }))
			);
		}
	}
	return polylines;
}

/**
 * Intersect a (transformed) triangle soup with every axial slice plane
 * (z = k * spacing_z, volume-local mm) and chain the resulting segments into
 * boundary polylines (slice pixel coordinates).
 *
 * Known limits of the approximate chaining:
 *  - non-manifold meshes / duplicate faces can split a loop into several
 *    open chains; chains with fewer than 3 points are discarded;
 *  - open chains are still stored as "closed" polylines (the rasterizer adds
 *    a closing chord), which can over-constrain near mesh holes;
 *  - vertices lying exactly on a slice plane are nudged by an epsilon, so
 *    contours there can shift by a sub-pixel amount.
 */
export function boundariesFromMesh(
	positions: Float32Array,
	transform: Mat4 | null,
	ds: Dataset
): BoundarySet {
	const sz = ds.spacing_z;
	const segsBySlice = new Map<number, number[]>();
	const EPS = 1e-6;

	const v = [
		{ x: 0, y: 0, z: 0 },
		{ x: 0, y: 0, z: 0 },
		{ x: 0, y: 0, z: 0 }
	];

	for (let t = 0; t + 8 < positions.length; t += 9) {
		for (let i = 0; i < 3; i++) {
			let p = { x: positions[t + i * 3], y: positions[t + i * 3 + 1], z: positions[t + i * 3 + 2] };
			if (transform) p = applyMat4(transform, p);
			v[i].x = p.x;
			v[i].y = p.y;
			v[i].z = p.z;
		}
		const zmin = Math.min(v[0].z, v[1].z, v[2].z);
		const zmax = Math.max(v[0].z, v[1].z, v[2].z);
		let k0 = Math.ceil(zmin / sz - 1e-9);
		let k1 = Math.floor(zmax / sz + 1e-9);
		if (k0 < 0) k0 = 0;
		if (k1 > ds.slices - 1) k1 = ds.slices - 1;
		for (let k = k0; k <= k1; k++) {
			const z = k * sz;
			// signed distances, nudged off zero so each crossing edge is unambiguous
			const d = [v[0].z - z, v[1].z - z, v[2].z - z];
			for (let i = 0; i < 3; i++) if (Math.abs(d[i]) < EPS) d[i] = EPS;
			const pts: number[] = [];
			for (let e = 0; e < 3; e++) {
				const a = v[e];
				const b = v[(e + 1) % 3];
				const da = d[e];
				const db = d[(e + 1) % 3];
				if ((da > 0) === (db > 0)) continue;
				const tt = da / (da - db);
				pts.push(a.x + (b.x - a.x) * tt, a.y + (b.y - a.y) * tt);
			}
			if (pts.length !== 4) continue;
			const x1 = pts[0] / ds.spacing_x;
			const y1 = pts[1] / ds.spacing_y;
			const x2 = pts[2] / ds.spacing_x;
			const y2 = pts[3] / ds.spacing_y;
			if (Math.hypot(x2 - x1, y2 - y1) < 0.05) continue; // degenerate sliver
			let list = segsBySlice.get(k);
			if (!list) {
				list = [];
				segsBySlice.set(k, list);
			}
			list.push(x1, y1, x2, y2);
		}
	}

	const out: BoundarySet = {};
	for (const [k, segs] of segsBySlice) {
		const polys = chainSegments(segs).slice(0, MAX_POLYLINES_PER_SLICE);
		if (polys.length > 0) out[k] = polys;
	}
	return out;
}
