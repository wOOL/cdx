/**
 * Level-of-detail presets for "convert segmentation → 3D model" plus the mesh
 * post-processing pipeline they configure:
 *
 *   noise      — drop 6-connected mask components smaller than 50 voxels
 *   resolution — 'half' max-pools the mask 2× (spacing doubled) before
 *                marching cubes; 'full' meshes at native resolution
 *   smoothing  — N (0–3) Laplacian passes over welded mesh vertices
 *   reduction  — 0–0.9 vertex-clustering decimation (grid snap; cell size
 *                grows with the factor, triangles collapsing inside one cell
 *                are dropped)
 *
 * Presets are persisted as JSON in the settings table (key
 * 'seg_lod_presets'), no schema change required.
 */
import { getSettings, setSetting } from '$lib/server/db/repo';
import { marchingCubes } from '$lib/server/marchingCubes';

export type LodResolution = 'full' | 'half';

export interface LodParams {
	resolution: LodResolution;
	/** Laplacian smoothing passes, 0–3 */
	smoothing: number;
	/** decimation strength, 0 (off) – 0.9 */
	reduction: number;
	/** 1 = remove connected components < 50 voxels before meshing */
	noise: 0 | 1;
}

export interface LodPreset extends LodParams {
	id: string;
	name: string;
	isDefault: boolean;
}

const SETTINGS_KEY = 'seg_lod_presets';
const NOISE_MIN_VOXELS = 50;

// ---------------------------------------------------------------------------
// Preset CRUD (settings-backed)
// ---------------------------------------------------------------------------

export function sanitizeLodParams(raw: unknown): LodParams | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const resolution = r.resolution ?? 'full';
	if (resolution !== 'full' && resolution !== 'half') return null;
	const smoothing = Number(r.smoothing ?? 0);
	if (!Number.isInteger(smoothing) || smoothing < 0 || smoothing > 3) return null;
	const reduction = Number(r.reduction ?? 0);
	if (!Number.isFinite(reduction) || reduction < 0 || reduction > 0.9) return null;
	const noise = Number(r.noise ?? 0);
	if (noise !== 0 && noise !== 1) return null;
	return { resolution, smoothing, reduction, noise };
}

function readPresets(): LodPreset[] {
	const raw = getSettings()[SETTINGS_KEY];
	if (!raw) return [];
	try {
		const list = JSON.parse(raw);
		if (!Array.isArray(list)) return [];
		const out: LodPreset[] = [];
		for (const item of list) {
			const params = sanitizeLodParams(item);
			if (!params || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
			out.push({ id: item.id, name: item.name, isDefault: item.isDefault === true, ...params });
		}
		return out;
	} catch {
		return [];
	}
}

function writePresets(presets: LodPreset[]): void {
	setSetting(SETTINGS_KEY, JSON.stringify(presets));
}

export function listLodPresets(): LodPreset[] {
	return readPresets();
}

export function getLodPreset(id: string): LodPreset | null {
	return readPresets().find((p) => p.id === id) ?? null;
}

export function createLodPreset(raw: unknown): LodPreset | null {
	const params = sanitizeLodParams(raw);
	const r = raw as Record<string, unknown>;
	const name = typeof r?.name === 'string' ? r.name.trim() : '';
	if (!params || !name) return null;
	const presets = readPresets();
	const preset: LodPreset = {
		id: crypto.randomUUID().slice(0, 8),
		name,
		isDefault: r.isDefault === true,
		...params
	};
	if (preset.isDefault) for (const p of presets) p.isDefault = false;
	presets.push(preset);
	writePresets(presets);
	return preset;
}

export function updateLodPreset(id: string, raw: unknown): LodPreset | null {
	const presets = readPresets();
	const current = presets.find((p) => p.id === id);
	if (!current || !raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	const merged = {
		resolution: r.resolution ?? current.resolution,
		smoothing: r.smoothing ?? current.smoothing,
		reduction: r.reduction ?? current.reduction,
		noise: r.noise ?? current.noise
	};
	const params = sanitizeLodParams(merged);
	if (!params) return null;
	if ('name' in r) {
		if (typeof r.name !== 'string' || !r.name.trim()) return null;
		current.name = r.name.trim();
	}
	Object.assign(current, params);
	if ('isDefault' in r) {
		current.isDefault = r.isDefault === true;
		if (current.isDefault) for (const p of presets) if (p.id !== id) p.isDefault = false;
	}
	writePresets(presets);
	return current;
}

export function deleteLodPreset(id: string): boolean {
	const presets = readPresets();
	const next = presets.filter((p) => p.id !== id);
	if (next.length === presets.length) return false;
	writePresets(next);
	return true;
}

// ---------------------------------------------------------------------------
// Mask preprocessing
// ---------------------------------------------------------------------------

/**
 * Zero every 6-connected component smaller than minVoxels (in place).
 * Returns the number of voxels removed.
 */
export function removeSmallComponents(
	mask: Uint8Array,
	dims: [number, number, number],
	minVoxels = NOISE_MIN_VOXELS
): number {
	const [nx, ny, nz] = dims;
	const nxny = nx * ny;
	const visited = new Uint8Array(mask.length);
	const queue = new Int32Array(mask.length);
	let removed = 0;

	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || visited[start]) continue;
		let head = 0;
		let tail = 0;
		queue[tail++] = start;
		visited[start] = 1;
		while (head < tail) {
			const p = queue[head++];
			const x = p % nx;
			const y = ((p / nx) | 0) % ny;
			const z = (p / nxny) | 0;
			if (x > 0 && mask[p - 1] && !visited[p - 1]) (visited[p - 1] = 1), (queue[tail++] = p - 1);
			if (x < nx - 1 && mask[p + 1] && !visited[p + 1])
				(visited[p + 1] = 1), (queue[tail++] = p + 1);
			if (y > 0 && mask[p - nx] && !visited[p - nx])
				(visited[p - nx] = 1), (queue[tail++] = p - nx);
			if (y < ny - 1 && mask[p + nx] && !visited[p + nx])
				(visited[p + nx] = 1), (queue[tail++] = p + nx);
			if (z > 0 && mask[p - nxny] && !visited[p - nxny])
				(visited[p - nxny] = 1), (queue[tail++] = p - nxny);
			if (z < nz - 1 && mask[p + nxny] && !visited[p + nxny])
				(visited[p + nxny] = 1), (queue[tail++] = p + nxny);
		}
		if (tail < minVoxels) {
			for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
			removed += tail;
		}
	}
	return removed;
}

/** Max-pool the binary mask 2× on every axis (keeps thin structures). */
export function downsampleMask2x(
	mask: Uint8Array,
	dims: [number, number, number]
): { mask: Uint8Array; dims: [number, number, number] } {
	const [nx, ny, nz] = dims;
	const ox = Math.max(1, Math.ceil(nx / 2));
	const oy = Math.max(1, Math.ceil(ny / 2));
	const oz = Math.max(1, Math.ceil(nz / 2));
	const out = new Uint8Array(ox * oy * oz);
	const nxny = nx * ny;
	for (let z = 0; z < nz; z++) {
		const zo = (z >> 1) * ox * oy;
		for (let y = 0; y < ny; y++) {
			const yo = zo + (y >> 1) * ox;
			const src = z * nxny + y * nx;
			for (let x = 0; x < nx; x++) {
				if (mask[src + x]) out[yo + (x >> 1)] = 1;
			}
		}
	}
	return { mask: out, dims: [ox, oy, oz] };
}

// ---------------------------------------------------------------------------
// Mesh post-processing (triangle-soup based)
// ---------------------------------------------------------------------------

interface Welded {
	verts: Float64Array; // xyz per unique vertex
	count: number;
	tris: Uint32Array; // 3 vertex ids per triangle
}

function weld(positions: Float32Array): Welded {
	const map = new Map<string, number>();
	const verts: number[] = [];
	const tris = new Uint32Array(positions.length / 3);
	for (let i = 0, vi = 0; i + 2 < positions.length; i += 3, vi++) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
		let id = map.get(key);
		if (id === undefined) {
			id = verts.length / 3;
			map.set(key, id);
			verts.push(x, y, z);
		}
		tris[vi] = id;
	}
	return { verts: Float64Array.from(verts), count: verts.length / 3, tris };
}

/**
 * N Laplacian passes (λ = 0.5) over the welded vertices of a triangle soup.
 * Returns a new soup; positions move toward their 1-ring average, slightly
 * shrinking the surface (acceptable for display models).
 */
export function laplacianSmooth(positions: Float32Array, passes: number): Float32Array {
	if (passes <= 0 || positions.length < 9) return positions;
	const { verts, count, tris } = weld(positions);

	// unique undirected edges
	const edgeSet = new Set<number>();
	const edges: number[] = [];
	for (let t = 0; t + 2 < tris.length; t += 3) {
		for (let e = 0; e < 3; e++) {
			const a = tris[t + e];
			const b = tris[t + ((e + 1) % 3)];
			if (a === b) continue;
			const lo = a < b ? a : b;
			const hi = a < b ? b : a;
			const key = lo * count + hi;
			if (edgeSet.has(key)) continue;
			edgeSet.add(key);
			edges.push(lo, hi);
		}
	}

	const acc = new Float64Array(count * 3);
	const deg = new Uint32Array(count);
	for (let pass = 0; pass < passes; pass++) {
		acc.fill(0);
		deg.fill(0);
		for (let e = 0; e + 1 < edges.length; e += 2) {
			const a = edges[e] * 3;
			const b = edges[e + 1] * 3;
			acc[a] += verts[b];
			acc[a + 1] += verts[b + 1];
			acc[a + 2] += verts[b + 2];
			acc[b] += verts[a];
			acc[b + 1] += verts[a + 1];
			acc[b + 2] += verts[a + 2];
			deg[edges[e]]++;
			deg[edges[e + 1]]++;
		}
		for (let v = 0; v < count; v++) {
			const d = deg[v];
			if (d === 0) continue;
			const o = v * 3;
			verts[o] += 0.5 * (acc[o] / d - verts[o]);
			verts[o + 1] += 0.5 * (acc[o + 1] / d - verts[o + 1]);
			verts[o + 2] += 0.5 * (acc[o + 2] / d - verts[o + 2]);
		}
	}

	const out = new Float32Array(positions.length);
	for (let i = 0; i < tris.length; i++) {
		const o = tris[i] * 3;
		out[i * 3] = verts[o];
		out[i * 3 + 1] = verts[o + 1];
		out[i * 3 + 2] = verts[o + 2];
	}
	return out;
}

/**
 * Vertex-clustering decimation: snap vertices to a regular grid of the given
 * cell size (mm), replace each cluster by its centroid and drop triangles
 * that collapse (two or more corners in the same cell).
 */
export function decimateMesh(positions: Float32Array, cellMm: number): Float32Array {
	if (!(cellMm > 0) || positions.length < 9) return positions;
	const clusterOf = new Map<string, number>();
	const sums: number[] = [];
	const counts: number[] = [];
	const vertCluster = new Uint32Array(positions.length / 3);
	for (let i = 0, vi = 0; i + 2 < positions.length; i += 3, vi++) {
		const key = `${Math.floor(positions[i] / cellMm)}|${Math.floor(
			positions[i + 1] / cellMm
		)}|${Math.floor(positions[i + 2] / cellMm)}`;
		let id = clusterOf.get(key);
		if (id === undefined) {
			id = counts.length;
			clusterOf.set(key, id);
			sums.push(0, 0, 0);
			counts.push(0);
		}
		sums[id * 3] += positions[i];
		sums[id * 3 + 1] += positions[i + 1];
		sums[id * 3 + 2] += positions[i + 2];
		counts[id]++;
		vertCluster[vi] = id;
	}
	const out: number[] = [];
	for (let t = 0; t + 2 < vertCluster.length; t += 3) {
		const a = vertCluster[t];
		const b = vertCluster[t + 1];
		const c = vertCluster[t + 2];
		if (a === b || b === c || a === c) continue;
		for (const id of [a, b, c]) {
			out.push(
				sums[id * 3] / counts[id],
				sums[id * 3 + 1] / counts[id],
				sums[id * 3 + 2] / counts[id]
			);
		}
	}
	return Float32Array.from(out);
}

/** Number of distinct vertex positions in a soup (for tests/UI). */
export function uniqueVertexCount(positions: Float32Array): number {
	return weld(positions).count;
}

// ---------------------------------------------------------------------------
// Full build pipeline
// ---------------------------------------------------------------------------

/**
 * Mesh a binary mask with optional LOD parameters.
 *
 * lod = null reproduces the legacy behavior exactly (marching-cubes stride 1
 * for volumes ≤ 320 on the longest axis, stride 2 above, no post-processing).
 * With lod set the pipeline is: noise removal → optional 2× downsample →
 * marching cubes (stride 1) → Laplacian smoothing → clustering decimation.
 * Note: smoothing/decimation invalidate the marching-cubes normals, so
 * `normals` is empty whenever post-processing ran (STL output recomputes
 * facet normals from the winding anyway).
 */
export function buildMaskMesh(
	mask: Uint8Array,
	dims: [number, number, number],
	spacing: [number, number, number],
	lod: LodParams | null
): { positions: Float32Array; normals: Float32Array } {
	let work = mask;
	let d = dims;
	let sp = spacing;

	if (lod) {
		if (lod.noise === 1) {
			work = work.slice();
			removeSmallComponents(work, d, NOISE_MIN_VOXELS);
		}
		if (lod.resolution === 'half') {
			const half = downsampleMask2x(work, d);
			work = half.mask;
			d = half.dims;
			sp = [sp[0] * 2, sp[1] * 2, sp[2] * 2];
		}
	}

	// marching cubes wants a smooth-ish scalar field: map 1 → 200, iso 100
	const scalars = new Uint8Array(work.length);
	for (let i = 0; i < work.length; i++) if (work[i]) scalars[i] = 200;

	const stride = lod ? 1 : Math.max(d[0], d[1], d[2]) <= 320 ? 1 : 2;
	const mesh = marchingCubes(scalars, d, sp, 100, stride);

	if (!lod || (lod.smoothing <= 0 && lod.reduction <= 0)) return mesh;

	let pos = mesh.positions;
	if (lod.smoothing > 0) pos = laplacianSmooth(pos, lod.smoothing);
	if (lod.reduction > 0) {
		const cellMm = Math.min(sp[0], sp[1], sp[2]) * (0.5 + 4.5 * lod.reduction);
		pos = decimateMesh(pos, cellMm);
	}
	return { positions: pos, normals: new Float32Array(0) };
}
