import { join } from 'node:path';
import { caseRel, resolveData } from '$lib/server/db';
import type { Dataset } from '$lib/types';

/**
 * Per-dataset binary segmentation mask: one byte per voxel (0 or 1), same
 * dims/layout as the HU volume (x fastest, then y, then z). Backs the
 * Scanview-style paint/fill editor.
 */

/** In-memory LRU of loaded masks, keyed by dataset id. */
const cache = new Map<number, Uint8Array>();
const MAX_ENTRIES = 2;

function remember(id: number, mask: Uint8Array): void {
	cache.delete(id);
	cache.set(id, mask);
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value as number;
		cache.delete(oldest);
	}
}

/** Stored (relative) path of a dataset's mask file. */
export function maskRelPath(ds: Dataset): string {
	return join(caseRel(ds.case_id), `mask_${ds.id}.u8`);
}

/**
 * Load a dataset's mask. Missing (or stale, wrong-sized) files yield an
 * all-zero mask without creating anything on disk.
 */
export async function loadMask(ds: Dataset): Promise<Uint8Array> {
	const hit = cache.get(ds.id);
	if (hit) {
		remember(ds.id, hit); // refresh LRU order
		return hit;
	}
	const size = ds.cols * ds.rows * ds.slices;
	let mask: Uint8Array | null = null;
	const file = Bun.file(resolveData(maskRelPath(ds)));
	if (await file.exists()) {
		const loaded = new Uint8Array(await file.arrayBuffer());
		if (loaded.length === size) mask = loaded;
	}
	mask ??= new Uint8Array(size);
	remember(ds.id, mask);
	return mask;
}

/** Drop a dataset's cached mask (e.g. after the file is replaced/deleted). */
export function evictMask(id: number): void {
	cache.delete(id);
}

/** Persist a dataset's mask and keep the cache coherent. */
export async function saveMask(ds: Dataset, mask: Uint8Array): Promise<void> {
	await Bun.write(resolveData(maskRelPath(ds)), mask);
	remember(ds.id, mask);
}

/** mask = 1 where lo <= HU <= hi, else 0. Returns the count of 1s. */
export function initFromThreshold(
	vol: Int16Array,
	mask: Uint8Array,
	lo: number,
	hi: number
): number {
	let filled = 0;
	for (let i = 0; i < mask.length; i++) {
		const v = vol[i];
		if (v >= lo && v <= hi) {
			mask[i] = 1;
			filled++;
		} else {
			mask[i] = 0;
		}
	}
	return filled;
}

/**
 * Set a filled disc on an axial slice (slice pixel coords, radius in pixels,
 * clamped to the slice bounds).
 */
export function paintDisc(
	mask: Uint8Array,
	ds: Dataset,
	plane: 'axial',
	index: number,
	cx: number,
	cy: number,
	radiusPx: number,
	value: 0 | 1
): void {
	void plane; // only 'axial' is supported
	if (!(radiusPx >= 0)) return;
	const C = ds.cols;
	const R = ds.rows;
	const k = Math.max(0, Math.min(ds.slices - 1, Math.trunc(index)));
	const base = k * C * R;
	const r2 = radiusPx * radiusPx;
	const y0 = Math.max(0, Math.ceil(cy - radiusPx));
	const y1 = Math.min(R - 1, Math.floor(cy + radiusPx));
	for (let y = y0; y <= y1; y++) {
		const dy = y - cy;
		const span = Math.sqrt(Math.max(0, r2 - dy * dy));
		const x0 = Math.max(0, Math.ceil(cx - span));
		const x1 = Math.min(C - 1, Math.floor(cx + span));
		if (x1 < x0) continue;
		const row = base + y * C;
		mask.fill(value, row + x0, row + x1 + 1);
	}
}

/** Safety cap on flooded region size (pixels). */
const FILL_VISIT_CAP = 4_000_000;

/**
 * BFS 4-connected flood fill on axial slice `index`: the region is the
 * connected set of pixels whose HU is within [lo, hi], starting at the seed
 * (which must itself satisfy the range, else 0 is returned). Sets
 * mask = value over the region and returns the filled pixel count.
 */
export function floodFill2D(
	vol: Int16Array,
	mask: Uint8Array,
	ds: Dataset,
	index: number,
	seedX: number,
	seedY: number,
	lo: number,
	hi: number,
	value: 0 | 1
): number {
	const C = ds.cols;
	const R = ds.rows;
	if (!Number.isInteger(index) || index < 0 || index >= ds.slices) return 0;
	const sx = Math.floor(seedX);
	const sy = Math.floor(seedY);
	if (sx < 0 || sx >= C || sy < 0 || sy >= R) return 0;

	const base = index * C * R;
	const inRange = (p: number): boolean => {
		const v = vol[base + p];
		return v >= lo && v <= hi;
	};

	const seed = sy * C + sx;
	if (!inRange(seed)) return 0;

	const visited = new Uint8Array(C * R);
	const queue: number[] = [seed];
	visited[seed] = 1;
	let head = 0;
	let filled = 0;

	while (head < queue.length) {
		const p = queue[head++];
		mask[base + p] = value;
		filled++;
		if (queue.length >= FILL_VISIT_CAP) break;
		const x = p % C;
		// 4-connected neighbours
		if (x > 0 && !visited[p - 1]) {
			visited[p - 1] = 1;
			if (inRange(p - 1)) queue.push(p - 1);
		}
		if (x < C - 1 && !visited[p + 1]) {
			visited[p + 1] = 1;
			if (inRange(p + 1)) queue.push(p + 1);
		}
		if (p >= C && !visited[p - C]) {
			visited[p - C] = 1;
			if (inRange(p - C)) queue.push(p - C);
		}
		if (p < C * (R - 1) && !visited[p + C]) {
			visited[p + C] = 1;
			if (inRange(p + C)) queue.push(p + C);
		}
	}
	return filled;
}
