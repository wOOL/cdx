/**
 * Slice-plane contours of surface models (scan-match verification overlay).
 * Loads model meshes once, caches per-slice contour segments.
 */
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const positionsCache = new Map<number, Promise<Float32Array | null>>();

export function loadModelPositions(modelId: number): Promise<Float32Array | null> {
	const hit = positionsCache.get(modelId);
	if (hit) return hit;
	const p = (async () => {
		try {
			const res = await fetch(`/api/models/${modelId}/file`);
			if (!res.ok) return null;
			const fmt = res.headers.get('X-Format') ?? 'stl';
			const buf = await res.arrayBuffer();
			const geo = fmt === 'ply' ? new PLYLoader().parse(buf) : new STLLoader().parse(buf);
			const indexed = geo.index;
			const pos = geo.getAttribute('position').array as Float32Array;
			if (!indexed) return pos;
			// expand indexed geometry to triangle soup
			const out = new Float32Array(indexed.count * 3);
			for (let i = 0; i < indexed.count; i++) {
				const v = indexed.getX(i) * 3;
				out[i * 3] = pos[v];
				out[i * 3 + 1] = pos[v + 1];
				out[i * 3 + 2] = pos[v + 2];
			}
			return out;
		} catch {
			return null;
		}
	})();
	positionsCache.set(modelId, p);
	return p;
}

interface ContourCacheEntry {
	key: string;
	segments: Float32Array; // [x1,y1,x2,y2] * n (volume-local mm)
}

const contourCache = new Map<number, ContourCacheEntry>();
const transformedCache = new Map<number, { key: string; pos: Float32Array }>();

function transformedPositions(
	modelId: number,
	raw: Float32Array,
	transform: number[] | null
): Float32Array {
	const key = transform ? transform.map((v) => v.toFixed(3)).join(',') : 'id';
	const hit = transformedCache.get(modelId);
	if (hit && hit.key === key) return hit.pos;
	let pos = raw;
	if (transform) {
		const t = transform;
		pos = new Float32Array(raw.length);
		for (let i = 0; i < raw.length; i += 3) {
			const x = raw[i];
			const y = raw[i + 1];
			const z = raw[i + 2];
			pos[i] = t[0] * x + t[4] * y + t[8] * z + t[12];
			pos[i + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
			pos[i + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
		}
	}
	transformedCache.set(modelId, { key, pos });
	return pos;
}

/**
 * Intersection segments of a model with the axial plane z = zmm.
 * Synchronous — returns null until the mesh has loaded (kicks off the load).
 */
export function axialContours(
	modelId: number,
	transform: number[] | null,
	zmm: number
): Float32Array | null {
	const cached = contourCache.get(modelId);
	const key = `${zmm.toFixed(2)}:${transform ? transform.map((v) => v.toFixed(2)).join(',') : 'id'}`;
	if (cached && cached.key === key) return cached.segments;

	let raw: Float32Array | null = null;
	const pending = positionsCache.get(modelId);
	// only proceed if already resolved synchronously cached — use a side-channel
	loadModelPositions(modelId).then(() => {});
	if (pending && resolvedPositions.has(modelId)) {
		raw = resolvedPositions.get(modelId) ?? null;
	}
	if (!raw) return cached?.segments ?? null;

	const pos = transformedPositions(modelId, raw, transform);
	const segs: number[] = [];
	for (let i = 0; i < pos.length; i += 9) {
		const z1 = pos[i + 2] - zmm;
		const z2 = pos[i + 5] - zmm;
		const z3 = pos[i + 8] - zmm;
		// quick reject
		if ((z1 > 0 && z2 > 0 && z3 > 0) || (z1 < 0 && z2 < 0 && z3 < 0)) continue;
		const pts: number[] = [];
		const edges = [
			[i, i + 3, z1, z2],
			[i + 3, i + 6, z2, z3],
			[i + 6, i, z3, z1]
		] as const;
		for (const [a, b, za, zb] of edges) {
			if ((za > 0) === (zb > 0)) continue;
			const f = Math.abs(za) / (Math.abs(za) + Math.abs(zb) || 1);
			pts.push(pos[a] + (pos[b] - pos[a]) * f, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f);
		}
		if (pts.length === 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
	}
	const segments = new Float32Array(segs);
	contourCache.set(modelId, { key, segments });
	return segments;
}

// track resolved mesh data for synchronous access from canvas draw calls
const resolvedPositions = new Map<number, Float32Array | null>();
export function primeModel(modelId: number, onReady?: () => void): void {
	if (resolvedPositions.has(modelId)) return;
	loadModelPositions(modelId).then((pos) => {
		resolvedPositions.set(modelId, pos);
		onReady?.();
	});
}

export function dropModel(modelId: number): void {
	positionsCache.delete(modelId);
	resolvedPositions.delete(modelId);
	contourCache.delete(modelId);
	transformedCache.delete(modelId);
}
