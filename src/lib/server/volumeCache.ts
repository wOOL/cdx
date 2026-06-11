import type { Dataset } from '$lib/types';

/** In-memory LRU of loaded HU volumes (Int16, x fastest, then y, then z). */
const cache = new Map<number, Int16Array>();
const MAX_ENTRIES = 3;

export async function loadVolume(ds: Dataset): Promise<Int16Array> {
	const hit = cache.get(ds.id);
	if (hit) {
		// refresh LRU order
		cache.delete(ds.id);
		cache.set(ds.id, hit);
		return hit;
	}
	const buf = await Bun.file(ds.volume_path).arrayBuffer();
	const vol = new Int16Array(buf);
	if (vol.length !== ds.cols * ds.rows * ds.slices) {
		throw new Error(`Volume file size mismatch for dataset ${ds.id}`);
	}
	cache.set(ds.id, vol);
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value as number;
		cache.delete(oldest);
	}
	return vol;
}

/** Drop a dataset's cached volume (e.g. after its volume file is replaced). */
export function evictVolume(id: number): void {
	cache.delete(id);
}

export type Plane = 'axial' | 'coronal' | 'sagittal';

export interface SliceData {
	width: number;
	height: number;
	data: Int16Array;
}

/**
 * Extract a slice in display orientation:
 *  - axial:    width=cols (x→right), height=rows (y→down), at z=index
 *  - coronal:  width=cols (x→right), height=slices (z→up ⇒ row 0 = top of head), at y=index
 *  - sagittal: width=rows (y→right), height=slices (z→up), at x=index
 */
export function extractSlice(
	vol: Int16Array,
	ds: Dataset,
	plane: Plane,
	index: number
): SliceData {
	const C = ds.cols;
	const R = ds.rows;
	const S = ds.slices;
	const CR = C * R;

	if (plane === 'axial') {
		const k = Math.max(0, Math.min(S - 1, index));
		return { width: C, height: R, data: vol.subarray(k * CR, (k + 1) * CR) as Int16Array };
	}
	if (plane === 'coronal') {
		const r = Math.max(0, Math.min(R - 1, index));
		const out = new Int16Array(C * S);
		for (let z = 0; z < S; z++) {
			const src = z * CR + r * C;
			const dstRow = (S - 1 - z) * C;
			out.set(vol.subarray(src, src + C), dstRow);
		}
		return { width: C, height: S, data: out };
	}
	// sagittal
	const c = Math.max(0, Math.min(C - 1, index));
	const out = new Int16Array(R * S);
	for (let z = 0; z < S; z++) {
		const dstRow = (S - 1 - z) * R;
		const srcZ = z * CR;
		for (let y = 0; y < R; y++) {
			out[dstRow + y] = vol[srcZ + y * C + c];
		}
	}
	return { width: R, height: S, data: out };
}
