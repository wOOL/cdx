/**
 * Mesh editor operations (SPEC §5.7) on triangle soups, plus the virtual
 * tooth extraction cut (SPEC §5.6).
 *
 * All ops weld the soup first (1e-4 mm tolerance) so topology queries
 * (neighbors, boundary loops) work, then emit a fresh soup. Degenerate
 * triangles (repeated welded vertices) are dropped on output.
 *
 *   smooth    — Laplacian (λ = 0.5, 3 iterations) on vertices within
 *               `radius` of `center` (no center ⇒ whole mesh). `points`
 *               selects the union of spheres around several centers instead
 *               (the editor's "select area" smoothing: drag marks, one op =
 *               one undo step). mode
 *               'flatten' is the wax knife: after smoothing, selected
 *               vertices are pushed inward along their area-weighted vertex
 *               normal ("smooth with a negative offset" — removes a thin
 *               layer of material); mode 'add' pushes outward instead
 *               (additive wax knife). The offset is picked by `strength`
 *               A–D (0.1 / 0.2 / 0.35 / 0.5 mm, default B = 0.2 mm — the
 *               historical flatten offset).
 *   remesh    — without `maxEdge`, one pass: triangles whose centroid lies
 *               within the radius and whose longest edge exceeds 2× the
 *               local mean edge length are midpoint-split (longest edge
 *               only). With `maxEdge` (mm), split passes repeat (≤ 10, with
 *               a triangle-count safety cap) until no selected triangle's
 *               longest edge exceeds it. Then `iterations` smoothing
 *               iterations (default 1, 0 = none — the "strength") run over
 *               the region. Shared split
 *               edges weld back together; if only one side of an edge
 *               splits a hairline T-junction remains (acceptable for a
 *               display mesh, documented limitation).
 *   partialFill — closes a SEGMENT of one hole: `a` and `b` snap to the
 *               nearest boundary vertices (b on the same loop as a), the
 *               shorter boundary arc between them (walked in loop
 *               direction, mm length) is filled with a triangle fan from
 *               the arc's first vertex — i.e. the region between the arc
 *               and the straight a–b chord. The chord becomes part of the
 *               remaining (smaller) boundary loop, winding stays
 *               consistent with the surrounding triangles.
 *   fillHoles — boundary loops are found via the directed-edge-use map
 *               (an edge with no reverse partner borders a hole); loops of
 *               ≤ `maxEdges` edges (default 60) are closed with a centroid
 *               fan oriented consistently with the surrounding triangles.
 *               Longer or non-walkable (non-manifold) loops are skipped and
 *               counted. `exceptLargest` keeps the biggest opening (by edge
 *               count) untouched; `hole` closes exactly one loop addressed
 *               by its index in the listHoles() ordering (largest first).
 *   boundarySmooth — constrained Laplacian over the open boundary rims only:
 *               each boundary-loop vertex moves toward the midpoint of its
 *               two NEIGHBORING loop vertices (1D curve smoothing, λ = 0.5,
 *               default 3 iterations) — never toward interior vertices,
 *               which would shrink the rim inward. Interior geometry is
 *               untouched. `loop` smooths a single loop addressed by its
 *               listHoles() index (largest first); absent ⇒ all loops.
 *   bridge    — connects the two boundary loops nearest to points `a` and
 *               `b` with a triangle strip: loops are aligned at their
 *               closest vertex pair, the walk direction of the second loop
 *               is chosen by proximity, then the rings are stitched by
 *               index ratio (n+m triangles). Limits: no twist
 *               minimization beyond the start/direction heuristic, loops
 *               that interleave in space can self-intersect, and the strip
 *               winding is not guaranteed to match both shells (STL facet
 *               normals are recomputed from the winding on save).
 *   parts     — connected components over the welded soup (shared-vertex
 *               connectivity, union-find). `action` deletes the selected
 *               part, keeps only the selected part, or keeps the largest
 *               one. Parts are addressed by their index in the listParts()
 *               ordering (triangle count desc, deterministic tie-break).
 *   reduce    — decimation to `targetPercent` of the current triangle
 *               count via uniform-grid vertex clustering: a cell size is
 *               binary-searched (≤ 14 O(n) passes) so that collapsing all
 *               vertices of a cell to their mean leaves ≈ target triangles.
 *               Approximation notes: feature edges are not preserved,
 *               coincident output triangles are deduplicated, the achieved
 *               count is approximate (the editor reports the real number),
 *               and topology may become non-manifold near thin features.
 *   invert    — flips the winding of every triangle (soup-level, no weld).
 *   erase     — deletes triangles whose centroid lies within `radius` of
 *               `center` (sphere). `deep` erases through-thickness instead:
 *               a cylinder of the same radius along `axis` (the pick
 *               normal), limited to ±`depth` mm (default 20) from the pick
 *               point. No rim fill is attempted — follow with fillHoles.
 *   marginCut — the user draws a closed margin line (≥ 3 picked points on
 *               the mesh). Triangles are classified by projecting their
 *               centroid and the polyline onto the loop's best-fit plane
 *               (Newell normal) and testing the winding number; the chosen
 *               side ('inside' of the loop or 'outside') is kept, the rest
 *               deleted. Approximation: classification happens in the
 *               projection plane, so strongly non-planar margin lines or
 *               surfaces that fold over the loop normal cut imprecisely
 *               near the line.
 *   combine   — merges another model's triangle soup into this one,
 *               transform-aware: the other mesh is mapped through
 *               inv(selfTransform) · otherTransform so both shells stay
 *               where the planning views show them. mode 'merge' (default)
 *               merely concatenates the shells (no boolean union). mode
 *               'subtract' is an approximate CSG difference A − B for
 *               visualization/planning (e.g. subtracting an AI-segmented
 *               tooth incl. root from a jaw scan leaves the extraction
 *               socket): triangles of this mesh whose centroid lies inside
 *               the other shell are removed, and the other shell's
 *               triangles whose centroid lies inside this mesh are added
 *               with flipped winding (the socket walls). Inside tests are
 *               +X ray-parity queries accelerated by a uniform grid over
 *               the tested mesh (degenerate edge/vertex/graze hits retry
 *               once with a jittered ray origin). No edge intersections
 *               are computed, so the cut is accurate to ~1 triangle.
 *
 * applyMeshEditOps() replays an ordered op list against a pristine
 * baseline; the list is client-held, so undo/redo are pop/re-push + replay
 * and the result is deterministic for a given (baseline, ops) pair.
 */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export type MeshEditOpName =
	| 'smooth'
	| 'remesh'
	| 'fillHoles'
	| 'boundarySmooth'
	| 'bridge'
	| 'partialFill'
	| 'parts'
	| 'reduce'
	| 'invert'
	| 'erase'
	| 'marginCut'
	| 'planeCut'
	| 'combine';

export interface MeshEditOp {
	op: MeshEditOpName;
	/**
	 * wax knife: 'flatten' = smooth + negative offset, 'add' = smooth + positive offset;
	 * combine: 'merge' = concatenate (default), 'subtract' = approximate CSG difference A − B
	 */
	mode?: 'flatten' | 'add' | 'merge' | 'subtract';
	/** wax knife offset preset (A 0.1 / B 0.2 / C 0.35 / D 0.5 mm, default B) */
	strength?: 'A' | 'B' | 'C' | 'D';
	center?: Vec3;
	radius?: number;
	/** bridge / partialFill pick points */
	a?: Vec3;
	b?: Vec3;
	/** parts */
	action?: 'deleteSelected' | 'keepSelected' | 'keepLargest';
	part?: number;
	/** fillHoles */
	hole?: number;
	exceptLargest?: boolean;
	maxEdges?: number;
	/**
	 * boundarySmooth: 1–10, default 3 (loop = listHoles index, absent ⇒ all);
	 * remesh: smoothing iterations after splitting (0–10, default 1 — the "strength")
	 */
	iterations?: number;
	loop?: number;
	/** remesh: split selected triangles until no edge exceeds this length (mm) */
	maxEdge?: number;
	/** reduce */
	targetPercent?: number;
	/** erase */
	deep?: boolean;
	axis?: Vec3;
	depth?: number;
	/** marginCut polyline / smooth select-area centers */
	points?: Vec3[];
	keep?: 'inside' | 'outside';
	/** planeCut: keep the half-space dot(p, axis) <= d (axis defaults to +z) */
	d?: number;
	/** combine */
	modelId?: number;
}

export interface MeshEditResult {
	positions: Float32Array;
	report: Record<string, number | string | boolean>;
}

/** Out-of-band data an op may need (combine loads sibling models). */
export interface MeshEditContext {
	/** resolve a sibling model id → its soup + stored column-major 4×4 (or null) */
	loadModel?: (modelId: number) => { positions: Float32Array; transform: number[] | null } | null;
	/** stored transform of the model being edited (column-major 4×4 or null) */
	selfTransform?: number[] | null;
}

const WELD_TOL = 1e-4; // mm
const MAX_HOLE_EDGES = 60;
const MAX_SELECTED_HOLE_EDGES = 5000;
const SMOOTH_LAMBDA = 0.5;
const DEEP_ERASE_DEPTH_MM = 20;
/** wax knife offset presets; B is the historical 0.2 mm flatten offset */
const WAX_STRENGTH_MM: Record<'A' | 'B' | 'C' | 'D', number> = {
	A: 0.1,
	B: 0.2,
	C: 0.35,
	D: 0.5
};

// ---------------------------------------------------------------------------
// Welded representation
// ---------------------------------------------------------------------------

interface Welded {
	verts: number[]; // xyz per unique vertex
	tris: number[]; // 3 vertex ids per triangle
	map: Map<string, number>;
}

function vKey(x: number, y: number, z: number): string {
	return `${Math.round(x / WELD_TOL)}|${Math.round(y / WELD_TOL)}|${Math.round(z / WELD_TOL)}`;
}

function addVertex(w: Welded, x: number, y: number, z: number): number {
	const key = vKey(x, y, z);
	let id = w.map.get(key);
	if (id === undefined) {
		id = w.verts.length / 3;
		w.map.set(key, id);
		w.verts.push(x, y, z);
	}
	return id;
}

function weld(positions: Float32Array): Welded {
	const w: Welded = { verts: [], tris: [], map: new Map() };
	for (let i = 0; i + 8 < positions.length; i += 9) {
		for (let v = 0; v < 3; v++) {
			w.tris.push(addVertex(w, positions[i + v * 3], positions[i + v * 3 + 1], positions[i + v * 3 + 2]));
		}
	}
	return w;
}

/** Back to a triangle soup, dropping triangles that collapsed in the weld. */
function toSoup(w: Welded): Float32Array {
	const out: number[] = [];
	for (let t = 0; t + 2 < w.tris.length; t += 3) {
		const a = w.tris[t];
		const b = w.tris[t + 1];
		const c = w.tris[t + 2];
		if (a === b || b === c || a === c) continue;
		for (const id of [a, b, c]) {
			out.push(w.verts[id * 3], w.verts[id * 3 + 1], w.verts[id * 3 + 2]);
		}
	}
	return Float32Array.from(out);
}

function vertexCount(w: Welded): number {
	return w.verts.length / 3;
}

function neighbors(w: Welded): number[][] {
	const n = vertexCount(w);
	const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
	for (let t = 0; t + 2 < w.tris.length; t += 3) {
		const a = w.tris[t];
		const b = w.tris[t + 1];
		const c = w.tris[t + 2];
		if (a !== b) (nb[a].add(b), nb[b].add(a));
		if (b !== c) (nb[b].add(c), nb[c].add(b));
		if (a !== c) (nb[a].add(c), nb[c].add(a));
	}
	return nb.map((s) => [...s]);
}

/** Area-weighted (un-normalized cross sums, normalized at the end) vertex normals. */
function vertexNormals(w: Welded): Float64Array {
	const n = vertexCount(w);
	const out = new Float64Array(n * 3);
	for (let t = 0; t + 2 < w.tris.length; t += 3) {
		const a = w.tris[t] * 3;
		const b = w.tris[t + 1] * 3;
		const c = w.tris[t + 2] * 3;
		const ux = w.verts[b] - w.verts[a];
		const uy = w.verts[b + 1] - w.verts[a + 1];
		const uz = w.verts[b + 2] - w.verts[a + 2];
		const vx = w.verts[c] - w.verts[a];
		const vy = w.verts[c + 1] - w.verts[a + 1];
		const vz = w.verts[c + 2] - w.verts[a + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		for (const i of [a, b, c]) {
			out[i] += nx;
			out[i + 1] += ny;
			out[i + 2] += nz;
		}
	}
	for (let v = 0; v < n; v++) {
		const o = v * 3;
		const len = Math.hypot(out[o], out[o + 1], out[o + 2]);
		if (len > 1e-12) {
			out[o] /= len;
			out[o + 1] /= len;
			out[o + 2] /= len;
		}
	}
	return out;
}

/** Selection flags for vertices within `radius` of ANY center (null/empty ⇒ all). */
function selectVerts(w: Welded, centers: Vec3[] | null, radius: number): Uint8Array {
	const n = vertexCount(w);
	const sel = new Uint8Array(n);
	if (!centers || centers.length === 0) {
		sel.fill(1);
		return sel;
	}
	const r2 = radius * radius;
	for (let v = 0; v < n; v++) {
		const x = w.verts[v * 3];
		const y = w.verts[v * 3 + 1];
		const z = w.verts[v * 3 + 2];
		for (const c of centers) {
			const dx = x - c.x;
			const dy = y - c.y;
			const dz = z - c.z;
			if (dx * dx + dy * dy + dz * dz <= r2) {
				sel[v] = 1;
				break;
			}
		}
	}
	return sel;
}

/** Simultaneous-update Laplacian over the selected vertices. Returns moved count. */
function smoothVerts(w: Welded, sel: Uint8Array, iterations: number, lambda: number): number {
	const nb = neighbors(w);
	let moved = 0;
	for (let it = 0; it < iterations; it++) {
		const snap = w.verts.slice();
		for (let v = 0; v < sel.length; v++) {
			if (!sel[v] || nb[v].length === 0) continue;
			let ax = 0;
			let ay = 0;
			let az = 0;
			for (const u of nb[v]) {
				ax += snap[u * 3];
				ay += snap[u * 3 + 1];
				az += snap[u * 3 + 2];
			}
			const d = nb[v].length;
			const o = v * 3;
			w.verts[o] += lambda * (ax / d - snap[o]);
			w.verts[o + 1] += lambda * (ay / d - snap[o + 1]);
			w.verts[o + 2] += lambda * (az / d - snap[o + 2]);
			if (it === 0) moved++;
		}
	}
	return moved;
}

// ---------------------------------------------------------------------------
// Boundary loops
// ---------------------------------------------------------------------------

/**
 * Open boundary loops via the directed-edge map: a triangle edge a→b with no
 * partner b→a borders a hole; those edges chain into directed cycles.
 * Non-walkable chains (non-manifold junctions, dead ends) are dropped.
 */
function boundaryLoops(w: Welded): { loops: number[][]; openEdges: number } {
	const n = vertexCount(w);
	const dir = new Set<number>();
	const key = (a: number, b: number): number => a * n + b;
	for (let t = 0; t + 2 < w.tris.length; t += 3) {
		const a = w.tris[t];
		const b = w.tris[t + 1];
		const c = w.tris[t + 2];
		if (a === b || b === c || a === c) continue;
		dir.add(key(a, b));
		dir.add(key(b, c));
		dir.add(key(c, a));
	}
	// boundary edges a→b (no reverse), indexed by start vertex
	const outBy = new Map<number, number[]>();
	let openEdges = 0;
	for (const k of dir) {
		const a = Math.floor(k / n);
		const b = k % n;
		if (dir.has(key(b, a))) continue;
		openEdges++;
		const list = outBy.get(a);
		if (list) list.push(b);
		else outBy.set(a, [b]);
	}

	const used = new Set<number>();
	const loops: number[][] = [];
	for (const [start, targets] of outBy) {
		for (const first of targets) {
			if (used.has(key(start, first))) continue;
			const loop: number[] = [start];
			let cur = first;
			used.add(key(start, first));
			let ok = false;
			for (let guard = 0; guard <= openEdges; guard++) {
				if (cur === start) {
					ok = true;
					break;
				}
				loop.push(cur);
				const outs = outBy.get(cur);
				let next = -1;
				if (outs) {
					for (const cand of outs) {
						if (!used.has(key(cur, cand))) {
							next = cand;
							break;
						}
					}
				}
				if (next < 0) break; // dead end / non-manifold
				used.add(key(cur, next));
				cur = next;
			}
			if (ok && loop.length >= 3) loops.push(loop);
		}
	}
	return { loops, openEdges };
}

function loopCentroid(w: Welded, loop: number[]): Vec3 {
	let x = 0;
	let y = 0;
	let z = 0;
	for (const v of loop) {
		x += w.verts[v * 3];
		y += w.verts[v * 3 + 1];
		z += w.verts[v * 3 + 2];
	}
	return { x: x / loop.length, y: y / loop.length, z: z / loop.length };
}

function dist2(ax: number, ay: number, az: number, b: Vec3): number {
	const dx = ax - b.x;
	const dy = ay - b.y;
	const dz = az - b.z;
	return dx * dx + dy * dy + dz * dz;
}

/**
 * Boundary loops in the deterministic "hole index" order used by listHoles()
 * and the per-hole fillHoles addressing: edge count descending, ties broken
 * by centroid x → y → z.
 */
function sortedLoops(w: Welded): { loops: number[][]; openEdges: number } {
	const { loops, openEdges } = boundaryLoops(w);
	const cen = loops.map((l) => loopCentroid(w, l));
	const order = loops.map((_, i) => i);
	order.sort((i, j) => {
		if (loops[i].length !== loops[j].length) return loops[j].length - loops[i].length;
		if (cen[i].x !== cen[j].x) return cen[i].x - cen[j].x;
		if (cen[i].y !== cen[j].y) return cen[i].y - cen[j].y;
		return cen[i].z - cen[j].z;
	});
	return { loops: order.map((i) => loops[i]), openEdges };
}

function fillOneLoop(w: Welded, loop: number[]): void {
	const c = loopCentroid(w, loop);
	const cid = addVertex(w, c.x, c.y, c.z);
	for (let i = 0; i < loop.length; i++) {
		const a = loop[i];
		const b = loop[(i + 1) % loop.length];
		w.tris.push(b, a, cid);
	}
}

interface FillOptions {
	maxEdges?: number;
	exceptLargest?: boolean;
	/** close exactly this loop (listHoles index); overrides the other options */
	hole?: number;
}

/**
 * Close boundary loops with a centroid fan. The boundary edges run a→b in the
 * direction of the surviving triangles, so fan triangles (b, a, c) provide
 * the missing reverse edges and stay consistently oriented.
 */
function fillLoops(
	w: Welded,
	opts: FillOptions
): { holesFilled: number; holesSkipped: number; openEdges: number } {
	const { loops, openEdges } = sortedLoops(w);
	let holesFilled = 0;
	let holesSkipped = 0;
	if (opts.hole != null) {
		const loop = loops[opts.hole];
		if (!loop) throw new Error(`Hole ${opts.hole} not found (${loops.length} open loops)`);
		if (loop.length > MAX_SELECTED_HOLE_EDGES) {
			throw new Error(`Hole too large to close (${loop.length} edges)`);
		}
		fillOneLoop(w, loop);
		return { holesFilled: 1, holesSkipped: 0, openEdges };
	}
	const maxEdges = opts.maxEdges ?? MAX_HOLE_EDGES;
	for (let i = 0; i < loops.length; i++) {
		if (opts.exceptLargest && i === 0) {
			holesSkipped++;
			continue; // loops are sorted largest-first
		}
		if (loops[i].length > maxEdges) {
			holesSkipped++;
			continue;
		}
		fillOneLoop(w, loops[i]);
		holesFilled++;
	}
	return { holesFilled, holesSkipped, openEdges };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function opSmooth(
	positions: Float32Array,
	centers: Vec3[] | null,
	radius: number,
	mode?: 'flatten' | 'add',
	strength?: 'A' | 'B' | 'C' | 'D'
): MeshEditResult {
	const w = weld(positions);
	const sel = selectVerts(w, centers, radius);
	const moved = smoothVerts(w, sel, 3, SMOOTH_LAMBDA);
	const offset = WAX_STRENGTH_MM[strength ?? 'B'];
	if (mode === 'flatten' || mode === 'add') {
		// wax knife: remove (flatten) or add material by offsetting along the normal
		const sign = mode === 'flatten' ? -1 : 1;
		const normals = vertexNormals(w);
		for (let v = 0; v < sel.length; v++) {
			if (!sel[v]) continue;
			const o = v * 3;
			w.verts[o] += sign * normals[o] * offset;
			w.verts[o + 1] += sign * normals[o + 1] * offset;
			w.verts[o + 2] += sign * normals[o + 2] * offset;
		}
	}
	return {
		positions: toSoup(w),
		report: {
			op: 'smooth',
			mode: mode ?? 'laplacian',
			...(mode ? { strength: strength ?? 'B', offsetMm: offset } : {}),
			...(centers && centers.length > 1 ? { centers: centers.length } : {}),
			vertices: moved,
			iterations: 3
		}
	};
}

/** Safety cap: maxEdge split passes stop once the mesh grows past this. */
const REMESH_MAX_TRIS = 1_200_000;
const REMESH_MAX_PASSES = 10;

function opRemesh(
	positions: Float32Array,
	center: Vec3 | null,
	radius: number,
	maxEdge?: number,
	iterations = 1
): MeshEditResult {
	const w = weld(positions);
	const r2 = radius * radius;

	const triInRegion = (t: number): boolean => {
		if (!center) return true;
		const a = w.tris[t * 3] * 3;
		const b = w.tris[t * 3 + 1] * 3;
		const c = w.tris[t * 3 + 2] * 3;
		const cx = (w.verts[a] + w.verts[b] + w.verts[c]) / 3;
		const cy = (w.verts[a + 1] + w.verts[b + 1] + w.verts[c + 1]) / 3;
		const cz = (w.verts[a + 2] + w.verts[b + 2] + w.verts[c + 2]) / 3;
		return dist2(cx, cy, cz, center) <= r2;
	};

	/** One split pass: midpoint-split the longest edge of every selected triangle longer than `limit`. */
	const splitPass = (limit: number, useRegion: boolean, selectedTri?: Uint8Array): number => {
		const triCount = w.tris.length / 3;
		let split = 0;
		const newTris: number[] = [];
		for (let t = 0; t < triCount; t++) {
			const ids = [w.tris[t * 3], w.tris[t * 3 + 1], w.tris[t * 3 + 2]];
			const inSel = selectedTri ? selectedTri[t] === 1 : !useRegion || triInRegion(t);
			if (inSel && limit > 0) {
				// find the longest edge
				let bestLen = -1;
				let bestE = 0;
				for (let e = 0; e < 3; e++) {
					const i = ids[e] * 3;
					const j = ids[(e + 1) % 3] * 3;
					const len = Math.hypot(
						w.verts[i] - w.verts[j],
						w.verts[i + 1] - w.verts[j + 1],
						w.verts[i + 2] - w.verts[j + 2]
					);
					if (len > bestLen) {
						bestLen = len;
						bestE = e;
					}
				}
				if (bestLen > limit) {
					const i0 = ids[bestE];
					const i1 = ids[(bestE + 1) % 3];
					const i2 = ids[(bestE + 2) % 3];
					const mid = addVertex(
						w,
						(w.verts[i0 * 3] + w.verts[i1 * 3]) / 2,
						(w.verts[i0 * 3 + 1] + w.verts[i1 * 3 + 1]) / 2,
						(w.verts[i0 * 3 + 2] + w.verts[i1 * 3 + 2]) / 2
					);
					newTris.push(i0, mid, i2, mid, i1, i2);
					split++;
					continue;
				}
			}
			newTris.push(ids[0], ids[1], ids[2]);
		}
		w.tris = newTris;
		return split;
	};

	let split = 0;
	let passes = 0;
	let meanEdge = 0;
	if (maxEdge != null && maxEdge > 0) {
		// explicit target: split until no selected triangle's longest edge exceeds maxEdge
		while (passes < REMESH_MAX_PASSES && w.tris.length / 3 <= REMESH_MAX_TRIS) {
			const n = splitPass(maxEdge, true);
			passes++;
			split += n;
			if (n === 0) break;
		}
	} else {
		// legacy heuristic: one pass at 2× the local mean edge length
		const triCount = w.tris.length / 3;
		const selectedTri = new Uint8Array(triCount);
		let edgeSum = 0;
		let edgeCount = 0;
		for (let t = 0; t < triCount; t++) {
			if (!triInRegion(t)) continue;
			selectedTri[t] = 1;
			const a = w.tris[t * 3] * 3;
			const b = w.tris[t * 3 + 1] * 3;
			const c = w.tris[t * 3 + 2] * 3;
			for (const [i, j] of [
				[a, b],
				[b, c],
				[c, a]
			]) {
				edgeSum += Math.hypot(
					w.verts[i] - w.verts[j],
					w.verts[i + 1] - w.verts[j + 1],
					w.verts[i + 2] - w.verts[j + 2]
				);
				edgeCount++;
			}
		}
		meanEdge = edgeCount > 0 ? edgeSum / edgeCount : 0;
		split = splitPass(2 * meanEdge, true, selectedTri);
		passes = 1;
	}

	// smoothing ("strength") over the (re-selected, midpoints included) region
	const it = Math.max(0, Math.min(10, Math.round(iterations)));
	const sel = selectVerts(w, center ? [center] : null, radius);
	const smoothed = it > 0 ? smoothVerts(w, sel, it, SMOOTH_LAMBDA) : 0;

	return {
		positions: toSoup(w),
		report: {
			op: 'remesh',
			split,
			...(maxEdge != null && maxEdge > 0
				? { maxEdgeMm: maxEdge, passes }
				: { meanEdgeMm: Math.round(meanEdge * 1000) / 1000 }),
			smoothedVertices: smoothed,
			iterations: it
		}
	};
}

function opFillHoles(positions: Float32Array, opts: FillOptions = {}): MeshEditResult {
	const w = weld(positions);
	const { holesFilled, holesSkipped, openEdges } = fillLoops(w, opts);
	return {
		positions: toSoup(w),
		report: { op: 'fillHoles', holesFilled, holesSkipped, openEdgesBefore: openEdges }
	};
}

/**
 * Boundary optimization: constrained Laplacian over boundary-loop vertices
 * only. Each rim vertex moves toward the midpoint of its two loop neighbors
 * (1D curve smoothing along the rim — averaging interior neighbors instead
 * would pull the rim inward). Interior vertices are untouched.
 */
function opBoundarySmooth(
	positions: Float32Array,
	iterations: number,
	loop?: number
): MeshEditResult {
	const w = weld(positions);
	const { loops } = sortedLoops(w);
	let selected = loops;
	if (loop != null) {
		if (!loops[loop]) throw new Error(`Boundary ${loop} not found (${loops.length} open loops)`);
		selected = [loops[loop]];
	}
	const moved = new Set<number>();
	for (const l of selected) {
		const n = l.length;
		for (let it = 0; it < iterations; it++) {
			// simultaneous update from a per-iteration snapshot of the loop
			const snap = new Float64Array(n * 3);
			for (let i = 0; i < n; i++) {
				snap[i * 3] = w.verts[l[i] * 3];
				snap[i * 3 + 1] = w.verts[l[i] * 3 + 1];
				snap[i * 3 + 2] = w.verts[l[i] * 3 + 2];
			}
			for (let i = 0; i < n; i++) {
				const a = ((i - 1 + n) % n) * 3;
				const b = ((i + 1) % n) * 3;
				const o = l[i] * 3;
				w.verts[o] += SMOOTH_LAMBDA * ((snap[a] + snap[b]) / 2 - snap[i * 3]);
				w.verts[o + 1] += SMOOTH_LAMBDA * ((snap[a + 1] + snap[b + 1]) / 2 - snap[i * 3 + 1]);
				w.verts[o + 2] += SMOOTH_LAMBDA * ((snap[a + 2] + snap[b + 2]) / 2 - snap[i * 3 + 2]);
				moved.add(l[i]);
			}
		}
	}
	// a rim vertex may have landed on a neighbor — re-weld so the collapsed
	// (degenerate) triangles are dropped on output like in the other ops
	return {
		positions: toSoup(weld(toSoup(w))),
		report: { op: 'boundarySmooth', loops: selected.length, vertices: moved.size, iterations }
	};
}

function opBridge(positions: Float32Array, a: Vec3, b: Vec3): MeshEditResult {
	const w = weld(positions);
	const { loops } = boundaryLoops(w);
	if (loops.length < 2) throw new Error('Bridge needs two open boundary loops');

	const centroids = loops.map((l) => loopCentroid(w, l));
	let ia = 0;
	for (let i = 1; i < loops.length; i++) {
		if (dist2(centroids[i].x, centroids[i].y, centroids[i].z, a) <
			dist2(centroids[ia].x, centroids[ia].y, centroids[ia].z, a)) ia = i;
	}
	let ib = ia === 0 ? 1 : 0;
	for (let i = 0; i < loops.length; i++) {
		if (i === ia) continue;
		if (dist2(centroids[i].x, centroids[i].y, centroids[i].z, b) <
			dist2(centroids[ib].x, centroids[ib].y, centroids[ib].z, b)) ib = i;
	}

	const L1 = loops[ia];
	const L2 = loops[ib];
	const n = L1.length;
	const m = L2.length;
	const P = (id: number): Vec3 => ({
		x: w.verts[id * 3],
		y: w.verts[id * 3 + 1],
		z: w.verts[id * 3 + 2]
	});

	// align loop starts at the closest vertex pair
	const p0 = P(L1[0]);
	let j0 = 0;
	for (let j = 1; j < m; j++) {
		const q = P(L2[j]);
		const best = P(L2[j0]);
		if (dist2(q.x, q.y, q.z, p0) < dist2(best.x, best.y, best.z, p0)) j0 = j;
	}
	// walk direction of L2 by proximity of the next vertices
	const p1 = P(L1[1 % n]);
	const fwd = P(L2[(j0 + 1) % m]);
	const back = P(L2[(j0 - 1 + m) % m]);
	const d = dist2(fwd.x, fwd.y, fwd.z, p1) <= dist2(back.x, back.y, back.z, p1) ? 1 : -1;

	const A = (k: number): number => L1[k % n];
	const B = (k: number): number => L2[(((j0 + d * k) % m) + m) % m];

	// stitch by index ratio: n + m triangles
	let i = 0;
	let j = 0;
	let added = 0;
	while (i < n || j < m) {
		if (j >= m || (i < n && (i + 1) * m <= (j + 1) * n)) {
			w.tris.push(A(i), A(i + 1), B(j));
			i++;
		} else {
			w.tris.push(A(i), B(j + 1), B(j));
			j++;
		}
		added++;
	}

	return {
		positions: toSoup(w),
		report: { op: 'bridge', loopA: n, loopB: m, trianglesAdded: added }
	};
}

/**
 * Partial hole repair: close only a segment of ONE boundary loop. `a` snaps
 * to the nearest boundary vertex of any loop, `b` to the nearest vertex of
 * THAT loop. The shorter arc between them (walked in loop direction, mm
 * length, ties → the a→b arc) is filled with a triangle fan from the arc's
 * first vertex — the region between the arc and the straight a–b chord. Fan
 * triangles (c[j+1], c[j], c[0]) provide the reverse of each directed
 * boundary edge, so winding stays consistent and the chord becomes a regular
 * boundary edge of the remaining (smaller) hole.
 */
function opPartialFill(positions: Float32Array, a: Vec3, b: Vec3): MeshEditResult {
	const w = weld(positions);
	const { loops } = sortedLoops(w);
	if (loops.length === 0) throw new Error('Mesh has no open boundaries');

	// nearest boundary vertex to a over ALL loops → picks the loop
	let li = 0;
	let ia = 0;
	let best = Infinity;
	for (let l = 0; l < loops.length; l++) {
		const loop = loops[l];
		for (let i = 0; i < loop.length; i++) {
			const o = loop[i] * 3;
			const d = dist2(w.verts[o], w.verts[o + 1], w.verts[o + 2], a);
			if (d < best) {
				best = d;
				li = l;
				ia = i;
			}
		}
	}
	const loop = loops[li];
	const n = loop.length;
	// nearest vertex to b on the SAME loop
	let ib = 0;
	best = Infinity;
	for (let i = 0; i < n; i++) {
		const o = loop[i] * 3;
		const d = dist2(w.verts[o], w.verts[o + 1], w.verts[o + 2], b);
		if (d < best) {
			best = d;
			ib = i;
		}
	}
	if (ia === ib) throw new Error('Pick two distinct points on the same open boundary');

	// arc length (mm) walking the loop direction from index `from` to `to`
	const segLen = (from: number, to: number): number => {
		let len = 0;
		for (let i = from; i !== to; i = (i + 1) % n) {
			const p = loop[i] * 3;
			const q = loop[(i + 1) % n] * 3;
			len += Math.hypot(
				w.verts[p] - w.verts[q],
				w.verts[p + 1] - w.verts[q + 1],
				w.verts[p + 2] - w.verts[q + 2]
			);
		}
		return len;
	};
	const lenF = segLen(ia, ib);
	const lenB = segLen(ib, ia);
	// the shorter arc, walked in loop direction (so its directed boundary
	// edges run c[j] → c[j+1] like the surviving triangles' edges)
	const start = lenF <= lenB ? ia : ib;
	const end = lenF <= lenB ? ib : ia;
	const chain: number[] = [];
	for (let i = start; ; i = (i + 1) % n) {
		chain.push(loop[i]);
		if (i === end) break;
	}
	const k = chain.length;
	if (k < 3) {
		throw new Error('Selected boundary segment is too short to fill — pick points further apart');
	}
	for (let j = 1; j < k - 1; j++) {
		w.tris.push(chain[j + 1], chain[j], chain[0]);
	}
	return {
		positions: toSoup(w),
		report: {
			op: 'partialFill',
			loop: li,
			segmentEdges: k - 1,
			segmentMm: Math.round(Math.min(lenF, lenB) * 100) / 100,
			trianglesAdded: k - 2
		}
	};
}

// ---------------------------------------------------------------------------
// Part detection (connected components over the welded soup)
// ---------------------------------------------------------------------------

/**
 * Connected components: triangle index lists, sorted deterministically by
 * triangle count desc → vertex count desc → first triangle index asc, so a
 * part index is stable across replays of the same intermediate mesh.
 */
function components(w: Welded): { tris: number[]; verts: number }[] {
	const n = vertexCount(w);
	const parent = new Int32Array(n);
	for (let i = 0; i < n; i++) parent[i] = i;
	const find = (a: number): number => {
		let r = a;
		while (parent[r] !== r) r = parent[r];
		while (parent[a] !== r) {
			const next = parent[a];
			parent[a] = r;
			a = next;
		}
		return r;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[rb] = ra;
	};
	const triCount = w.tris.length / 3;
	for (let t = 0; t < triCount; t++) {
		union(w.tris[t * 3], w.tris[t * 3 + 1]);
		union(w.tris[t * 3], w.tris[t * 3 + 2]);
	}
	const byRoot = new Map<number, { tris: number[]; vs: Set<number> }>();
	for (let t = 0; t < triCount; t++) {
		const r = find(w.tris[t * 3]);
		let entry = byRoot.get(r);
		if (!entry) {
			entry = { tris: [], vs: new Set() };
			byRoot.set(r, entry);
		}
		entry.tris.push(t);
		entry.vs.add(w.tris[t * 3]);
		entry.vs.add(w.tris[t * 3 + 1]);
		entry.vs.add(w.tris[t * 3 + 2]);
	}
	const parts = [...byRoot.values()].map((e) => ({ tris: e.tris, verts: e.vs.size }));
	parts.sort((a, b) => {
		if (a.tris.length !== b.tris.length) return b.tris.length - a.tris.length;
		if (a.verts !== b.verts) return b.verts - a.verts;
		return a.tris[0] - b.tris[0];
	});
	return parts;
}

export interface MeshPartInfo {
	index: number;
	triangles: number;
	vertices: number;
}

/** Inspection: connected parts (largest first) with per-part counts. */
export function listParts(positions: Float32Array): {
	triangles: number;
	vertices: number;
	parts: MeshPartInfo[];
} {
	const w = weld(positions);
	const parts = components(w).map((p, i) => ({
		index: i,
		triangles: p.tris.length,
		vertices: p.verts
	}));
	return { triangles: positions.length / 9, vertices: vertexCount(w), parts };
}

/** Triangle soup of one detected part (listParts index) — used to highlight it. */
export function partPositions(positions: Float32Array, index: number): Float32Array {
	const w = weld(positions);
	const part = components(w)[index];
	if (!part) throw new Error(`Part ${index} not found`);
	const out = new Float32Array(part.tris.length * 9);
	let o = 0;
	for (const t of part.tris) {
		for (let v = 0; v < 3; v++) {
			const id = w.tris[t * 3 + v] * 3;
			out[o++] = w.verts[id];
			out[o++] = w.verts[id + 1];
			out[o++] = w.verts[id + 2];
		}
	}
	return out;
}

function opParts(
	positions: Float32Array,
	action: 'deleteSelected' | 'keepSelected' | 'keepLargest',
	part?: number
): MeshEditResult {
	const w = weld(positions);
	const parts = components(w);
	if (parts.length === 0) throw new Error('Mesh has no parts');
	let keep: Set<number>;
	if (action === 'keepLargest') {
		keep = new Set(parts[0].tris);
	} else {
		if (part == null || !parts[part]) {
			throw new Error(`Part ${part ?? '?'} not found (${parts.length} parts)`);
		}
		if (action === 'keepSelected') keep = new Set(parts[part].tris);
		else {
			keep = new Set<number>();
			for (let i = 0; i < parts.length; i++) {
				if (i === part) continue;
				for (const t of parts[i].tris) keep.add(t);
			}
		}
	}
	const tris: number[] = [];
	const total = w.tris.length / 3;
	for (let t = 0; t < total; t++) {
		if (keep.has(t)) tris.push(w.tris[t * 3], w.tris[t * 3 + 1], w.tris[t * 3 + 2]);
	}
	w.tris = tris;
	return {
		positions: toSoup(w),
		report: {
			op: 'parts',
			action,
			...(part != null ? { part } : {}),
			partsBefore: parts.length,
			removedTriangles: total - tris.length / 3
		}
	};
}

// ---------------------------------------------------------------------------
// Hole inspection
// ---------------------------------------------------------------------------

export interface MeshHoleInfo {
	index: number;
	edges: number;
	lengthMm: number;
	centroid: Vec3;
	/** rim polyline for highlighting, subsampled to ≤ 256 points */
	loop: Vec3[];
}

/** Inspection: open boundary loops, largest (most edges) first. */
export function listHoles(positions: Float32Array): { holes: MeshHoleInfo[]; openEdges: number } {
	const w = weld(positions);
	const { loops, openEdges } = sortedLoops(w);
	const holes = loops.map((loop, index) => {
		let len = 0;
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i] * 3;
			const b = loop[(i + 1) % loop.length] * 3;
			len += Math.hypot(
				w.verts[a] - w.verts[b],
				w.verts[a + 1] - w.verts[b + 1],
				w.verts[a + 2] - w.verts[b + 2]
			);
		}
		const step = Math.max(1, Math.ceil(loop.length / 256));
		const pts: Vec3[] = [];
		for (let i = 0; i < loop.length; i += step) {
			const o = loop[i] * 3;
			pts.push({ x: w.verts[o], y: w.verts[o + 1], z: w.verts[o + 2] });
		}
		return {
			index,
			edges: loop.length,
			lengthMm: Math.round(len * 100) / 100,
			centroid: loopCentroid(w, loop),
			loop: pts
		};
	});
	return { holes, openEdges };
}

/** Triangle + welded-vertex counts (the editor's live status line). */
export function meshStats(positions: Float32Array): { triangles: number; vertices: number } {
	return { triangles: positions.length / 9, vertices: vertexCount(weld(positions)) };
}

// ---------------------------------------------------------------------------
// Reduce (uniform-grid vertex clustering)
// ---------------------------------------------------------------------------

function clusterCount(positions: Float32Array, cell: number): number {
	const seen = new Set<string>();
	let count = 0;
	const key = (i: number): string =>
		`${Math.floor(positions[i] / cell)}|${Math.floor(positions[i + 1] / cell)}|${Math.floor(positions[i + 2] / cell)}`;
	for (let i = 0; i + 8 < positions.length; i += 9) {
		const a = key(i);
		const b = key(i + 3);
		const c = key(i + 6);
		if (a === b || b === c || a === c) continue;
		const tri = [a, b, c].sort().join('/');
		if (seen.has(tri)) continue; // coincident result triangles collapse to one
		seen.add(tri);
		count++;
	}
	return count;
}

function opReduce(positions: Float32Array, targetPercent: number): MeshEditResult {
	const trianglesBefore = positions.length / 9;
	const pct = Math.min(100, Math.max(1, targetPercent));
	const target = Math.max(4, Math.round((trianglesBefore * pct) / 100));
	if (target >= trianglesBefore) {
		return {
			positions,
			report: { op: 'reduce', targetPercent: pct, trianglesBefore, trianglesAfter: trianglesBefore, cellMm: 0 }
		};
	}
	// bbox diagonal bounds the cell-size search
	let min = [Infinity, Infinity, Infinity];
	let max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i + 2 < positions.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			if (positions[i + k] < min[k]) min[k] = positions[i + k];
			if (positions[i + k] > max[k]) max[k] = positions[i + k];
		}
	}
	const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;

	// log-space bisection on the (monotone non-increasing) cluster count
	let lo = diag / 1e4;
	let hi = diag;
	let bestCell = hi;
	let bestDiff = Infinity;
	for (let it = 0; it < 14; it++) {
		const cell = Math.sqrt(lo * hi);
		const n = clusterCount(positions, cell);
		const diff = Math.abs(n - target);
		if (diff < bestDiff) {
			bestDiff = diff;
			bestCell = cell;
		}
		if (n > target) lo = cell;
		else hi = cell;
	}

	// representative = mean of all soup vertices in the cell
	const cell = bestCell;
	const acc = new Map<string, [number, number, number, number]>();
	const keyOf = (i: number): string =>
		`${Math.floor(positions[i] / cell)}|${Math.floor(positions[i + 1] / cell)}|${Math.floor(positions[i + 2] / cell)}`;
	for (let i = 0; i + 2 < positions.length; i += 3) {
		const k = keyOf(i);
		const a = acc.get(k);
		if (a) {
			a[0] += positions[i];
			a[1] += positions[i + 1];
			a[2] += positions[i + 2];
			a[3]++;
		} else acc.set(k, [positions[i], positions[i + 1], positions[i + 2], 1]);
	}
	const out: number[] = [];
	const seen = new Set<string>();
	for (let i = 0; i + 8 < positions.length; i += 9) {
		const ka = keyOf(i);
		const kb = keyOf(i + 3);
		const kc = keyOf(i + 6);
		if (ka === kb || kb === kc || ka === kc) continue;
		const tri = [ka, kb, kc].sort().join('/');
		if (seen.has(tri)) continue;
		seen.add(tri);
		for (const k of [ka, kb, kc]) {
			const a = acc.get(k)!;
			out.push(a[0] / a[3], a[1] / a[3], a[2] / a[3]);
		}
	}
	return {
		positions: Float32Array.from(out),
		report: {
			op: 'reduce',
			targetPercent: pct,
			trianglesBefore,
			trianglesAfter: out.length / 9,
			cellMm: Math.round(cell * 1000) / 1000
		}
	};
}

// ---------------------------------------------------------------------------
// Invert / erase / margin cut / combine
// ---------------------------------------------------------------------------

function opInvert(positions: Float32Array): MeshEditResult {
	const out = new Float32Array(positions.length);
	for (let i = 0; i + 8 < positions.length; i += 9) {
		// keep vertex 0, swap vertices 1 and 2 → winding (and facet normal) flips
		out[i] = positions[i];
		out[i + 1] = positions[i + 1];
		out[i + 2] = positions[i + 2];
		out[i + 3] = positions[i + 6];
		out[i + 4] = positions[i + 7];
		out[i + 5] = positions[i + 8];
		out[i + 6] = positions[i + 3];
		out[i + 7] = positions[i + 4];
		out[i + 8] = positions[i + 5];
	}
	return { positions: out, report: { op: 'invert', triangles: out.length / 9 } };
}

/**
 * Half-space cut: keep geometry with dot(p, n) <= d. Triangles crossing the
 * plane are midpoint-subdivided twice and kept per sub-centroid — the cut
 * edge is accurate to ~1/4 triangle size and the rim is left open (close it
 * with fillHoles if a watertight result is needed).
 */
function opPlaneCut(positions: Float32Array, axis: Vec3, d: number): MeshEditResult {
	const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
	const n = { x: axis.x / len, y: axis.y / len, z: axis.z / len };
	const side = (x: number, y: number, z: number) => x * n.x + y * n.y + z * n.z - d;
	const out: number[] = [];
	const emit = (t: number[], depthLeft: number) => {
		const s = [
			side(t[0], t[1], t[2]),
			side(t[3], t[4], t[5]),
			side(t[6], t[7], t[8])
		];
		if (s.every((v) => v <= 0)) {
			out.push(...t);
			return;
		}
		if (s.every((v) => v > 0)) return;
		if (depthLeft === 0) {
			const cs = side(
				(t[0] + t[3] + t[6]) / 3,
				(t[1] + t[4] + t[7]) / 3,
				(t[2] + t[5] + t[8]) / 3
			);
			if (cs <= 0) out.push(...t);
			return;
		}
		// midpoint 4-way split
		const m01 = [(t[0] + t[3]) / 2, (t[1] + t[4]) / 2, (t[2] + t[5]) / 2];
		const m12 = [(t[3] + t[6]) / 2, (t[4] + t[7]) / 2, (t[5] + t[8]) / 2];
		const m20 = [(t[6] + t[0]) / 2, (t[7] + t[1]) / 2, (t[8] + t[2]) / 2];
		emit([t[0], t[1], t[2], ...m01, ...m20], depthLeft - 1);
		emit([...m01, t[3], t[4], t[5], ...m12], depthLeft - 1);
		emit([...m20, ...m12, t[6], t[7], t[8]], depthLeft - 1);
		emit([...m01, ...m12, ...m20], depthLeft - 1);
	};
	for (let i = 0; i + 8 < positions.length; i += 9) {
		emit([...positions.subarray(i, i + 9)], 2);
	}
	if (out.length === 0) throw new Error('Plane cut removed the entire mesh');
	return {
		positions: Float32Array.from(out),
		report: { op: 'planeCut', triangles: out.length / 9 }
	};
}

function opErase(
	positions: Float32Array,
	center: Vec3,
	radius: number,
	deep: boolean,
	axis: Vec3 | null,
	depth: number
): MeshEditResult {
	const r2 = radius * radius;
	let ax = 0;
	let ay = 0;
	let az = 1;
	if (deep) {
		const a = axis ?? { x: 0, y: 0, z: 1 };
		const len = Math.hypot(a.x, a.y, a.z);
		if (len > 1e-9) {
			ax = a.x / len;
			ay = a.y / len;
			az = a.z / len;
		}
	}
	const kept: number[] = [];
	let removed = 0;
	for (let i = 0; i + 8 < positions.length; i += 9) {
		const cx = (positions[i] + positions[i + 3] + positions[i + 6]) / 3 - center.x;
		const cy = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3 - center.y;
		const cz = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3 - center.z;
		let inside: boolean;
		if (deep) {
			// cylinder of ±depth along the pick normal (through-thickness erase)
			const t = cx * ax + cy * ay + cz * az;
			const rx = cx - t * ax;
			const ry = cy - t * ay;
			const rz = cz - t * az;
			inside = Math.abs(t) <= depth && rx * rx + ry * ry + rz * rz <= r2;
		} else {
			inside = cx * cx + cy * cy + cz * cz <= r2;
		}
		if (inside) {
			removed++;
			continue;
		}
		for (let v = 0; v < 9; v++) kept.push(positions[i + v]);
	}
	return {
		positions: Float32Array.from(kept),
		report: { op: 'erase', deep, removed, radiusMm: radius, ...(deep ? { depthMm: depth } : {}) }
	};
}

function opMarginCut(positions: Float32Array, pts: Vec3[], keep: 'inside' | 'outside'): MeshEditResult {
	if (pts.length < 3) throw new Error('Margin cut needs at least 3 points');
	// Newell normal + centroid of the (closed) margin polyline
	let nx = 0;
	let ny = 0;
	let nz = 0;
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (let i = 0; i < pts.length; i++) {
		const p = pts[i];
		const q = pts[(i + 1) % pts.length];
		nx += (p.y - q.y) * (p.z + q.z);
		ny += (p.z - q.z) * (p.x + q.x);
		nz += (p.x - q.x) * (p.y + q.y);
		cx += p.x;
		cy += p.y;
		cz += p.z;
	}
	cx /= pts.length;
	cy /= pts.length;
	cz /= pts.length;
	const nl = Math.hypot(nx, ny, nz);
	if (nl < 1e-9) throw new Error('Margin line is degenerate (collinear points)');
	nx /= nl;
	ny /= nl;
	nz /= nl;
	// in-plane basis
	let ux = -ny;
	let uy = nx;
	let uz = 0;
	let ul = Math.hypot(ux, uy, uz);
	if (ul < 1e-6) {
		ux = 1;
		uy = 0;
		uz = 0;
		ul = 1;
	}
	ux /= ul;
	uy /= ul;
	uz /= ul;
	const vx = ny * uz - nz * uy;
	const vy = nz * ux - nx * uz;
	const vz = nx * uy - ny * ux;
	const proj = (x: number, y: number, z: number): [number, number] => [
		(x - cx) * ux + (y - cy) * uy + (z - cz) * uz,
		(x - cx) * vx + (y - cy) * vy + (z - cz) * vz
	];
	const poly = pts.map((p) => proj(p.x, p.y, p.z));
	const insidePoly = (px: number, py: number): boolean => {
		// winding number over the projected loop
		let wn = 0;
		for (let i = 0; i < poly.length; i++) {
			const [x1, y1] = poly[i];
			const [x2, y2] = poly[(i + 1) % poly.length];
			if (y1 <= py) {
				if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) wn++;
			} else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) wn--;
		}
		return wn !== 0;
	};
	const kept: number[] = [];
	let removed = 0;
	for (let i = 0; i + 8 < positions.length; i += 9) {
		const tx = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
		const ty = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
		const tz = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
		const [px, py] = proj(tx, ty, tz);
		const inside = insidePoly(px, py);
		if (inside === (keep === 'inside')) {
			for (let v = 0; v < 9; v++) kept.push(positions[i + v]);
		} else removed++;
	}
	return {
		positions: Float32Array.from(kept),
		report: { op: 'marginCut', keep, removed, kept: kept.length / 9, points: pts.length }
	};
}

/** General 4×4 inverse (column-major), Gauss-Jordan. Throws if singular. */
function invertMat4(m: number[]): number[] {
	const a = [
		[m[0], m[4], m[8], m[12], 1, 0, 0, 0],
		[m[1], m[5], m[9], m[13], 0, 1, 0, 0],
		[m[2], m[6], m[10], m[14], 0, 0, 1, 0],
		[m[3], m[7], m[11], m[15], 0, 0, 0, 1]
	];
	for (let col = 0; col < 4; col++) {
		let pivot = col;
		for (let r = col + 1; r < 4; r++) {
			if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
		}
		if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('Model transform is singular');
		[a[col], a[pivot]] = [a[pivot], a[col]];
		const d = a[col][col];
		for (let k = 0; k < 8; k++) a[col][k] /= d;
		for (let r = 0; r < 4; r++) {
			if (r === col) continue;
			const f = a[r][col];
			if (f === 0) continue;
			for (let k = 0; k < 8; k++) a[r][k] -= f * a[col][k];
		}
	}
	const inv = new Array<number>(16);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) inv[c * 4 + r] = a[r][c + 4];
	}
	return inv;
}

function mulMat4(a: number[], b: number[]): number[] {
	const o = new Array<number>(16).fill(0);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
			o[c * 4 + r] = s;
		}
	}
	return o;
}

const IDENT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// ---------------------------------------------------------------------------
// Point-in-mesh parity test (uniform grid + ray casting along +X)
// ---------------------------------------------------------------------------

/**
 * Acceleration structure for "is this point inside the (closed) mesh" parity
 * queries: triangles are binned by their y/z bounding box into a uniform 2D
 * grid over the mesh's y/z extent — exactly the column of cells a +X parity
 * ray traverses — so a query only tests the triangles sharing its y/z cell.
 * Equivalent to walking a 3D grid's cells along +X, without per-query
 * mailboxing (each triangle appears at most once per y/z cell).
 */
interface ParityGrid {
	pos: Float32Array;
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	minZ: number;
	maxZ: number;
	ny: number;
	nz: number;
	invCy: number;
	invCz: number;
	/** CSR layout: triangles of cell c are cellTris[cellStart[c] .. cellStart[c+1]) */
	cellStart: Int32Array;
	cellTris: Int32Array;
	/** ray-origin offsets (different per axis so diagonal grazes break too) */
	jitterY: number;
	jitterZ: number;
}

function buildParityGrid(pos: Float32Array): ParityGrid | null {
	const triCount = (pos.length / 9) | 0;
	if (triCount === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (let i = 0; i + 2 < pos.length; i += 3) {
		const x = pos[i];
		const y = pos[i + 1];
		const z = pos[i + 2];
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}
	const spanY = Math.max(maxY - minY, 1e-6);
	const spanZ = Math.max(maxZ - minZ, 1e-6);
	// ~4 triangles per occupied cell on a uniform mesh, capped for memory
	const res = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(triCount / 4))));
	const ny = res;
	const nz = res;
	const invCy = ny / spanY;
	const invCz = nz / spanZ;
	const cells = ny * nz;
	const clampY = (v: number): number => (v < 0 ? 0 : v >= ny ? ny - 1 : v);
	const clampZ = (v: number): number => (v < 0 ? 0 : v >= nz ? nz - 1 : v);

	// pass 1: entries per cell (a triangle lands in every y/z cell its bbox touches)
	const counts = new Int32Array(cells);
	for (let t = 0; t < triCount; t++) {
		const i = t * 9;
		const y0 = Math.min(pos[i + 1], pos[i + 4], pos[i + 7]);
		const y1 = Math.max(pos[i + 1], pos[i + 4], pos[i + 7]);
		const z0 = Math.min(pos[i + 2], pos[i + 5], pos[i + 8]);
		const z1 = Math.max(pos[i + 2], pos[i + 5], pos[i + 8]);
		const cy0 = clampY(Math.floor((y0 - minY) * invCy));
		const cy1 = clampY(Math.floor((y1 - minY) * invCy));
		const cz0 = clampZ(Math.floor((z0 - minZ) * invCz));
		const cz1 = clampZ(Math.floor((z1 - minZ) * invCz));
		for (let cz = cz0; cz <= cz1; cz++) {
			for (let cy = cy0; cy <= cy1; cy++) counts[cz * ny + cy]++;
		}
	}
	// pass 2: prefix sum → cell ranges
	const cellStart = new Int32Array(cells + 1);
	for (let c = 0; c < cells; c++) cellStart[c + 1] = cellStart[c] + counts[c];
	// pass 3: fill (counts becomes the per-cell write cursor)
	const cellTris = new Int32Array(cellStart[cells]);
	counts.set(cellStart.subarray(0, cells));
	for (let t = 0; t < triCount; t++) {
		const i = t * 9;
		const y0 = Math.min(pos[i + 1], pos[i + 4], pos[i + 7]);
		const y1 = Math.max(pos[i + 1], pos[i + 4], pos[i + 7]);
		const z0 = Math.min(pos[i + 2], pos[i + 5], pos[i + 8]);
		const z1 = Math.max(pos[i + 2], pos[i + 5], pos[i + 8]);
		const cy0 = clampY(Math.floor((y0 - minY) * invCy));
		const cy1 = clampY(Math.floor((y1 - minY) * invCy));
		const cz0 = clampZ(Math.floor((z0 - minZ) * invCz));
		const cz1 = clampZ(Math.floor((z1 - minZ) * invCz));
		for (let cz = cz0; cz <= cz1; cz++) {
			for (let cy = cy0; cy <= cy1; cy++) cellTris[counts[cz * ny + cy]++] = t;
		}
	}
	return {
		pos,
		minX,
		maxX,
		minY,
		maxY,
		minZ,
		maxZ,
		ny,
		nz,
		invCy,
		invCz,
		cellStart,
		cellTris,
		jitterY: spanY * 1.3e-5 + 1e-6,
		jitterZ: spanZ * 2.9e-5 + 2e-6
	};
}

const PARITY_BARY_EPS = 1e-7; // barycentric edge/vertex tolerance
const PARITY_T_EPS = 1e-6; // mm — "ray origin sits on the surface" tolerance

/**
 * Count crossings of the ray (px,py,pz) + t·(1,0,0), t > 0, with the gridded
 * mesh (Möller–Trumbore specialized to the +X direction, no allocations).
 * `strict` returns -1 on a degenerate hit (edge/vertex hit, origin on the
 * surface, or an in-plane graze) so the caller can retry with a jittered
 * origin; the non-strict retry counts with plain comparisons.
 */
function countCrossingsX(g: ParityGrid, px: number, py: number, pz: number, strict: boolean): number {
	let cy = Math.floor((py - g.minY) * g.invCy);
	let cz = Math.floor((pz - g.minZ) * g.invCz);
	if (cy < 0) cy = 0;
	else if (cy >= g.ny) cy = g.ny - 1;
	if (cz < 0) cz = 0;
	else if (cz >= g.nz) cz = g.nz - 1;
	const cell = cz * g.ny + cy;
	const start = g.cellStart[cell];
	const end = g.cellStart[cell + 1];
	const pos = g.pos;
	let crossings = 0;
	for (let k = start; k < end; k++) {
		const i = g.cellTris[k] * 9;
		const ax = pos[i];
		const ay = pos[i + 1];
		const az = pos[i + 2];
		const e1x = pos[i + 3] - ax;
		const e1y = pos[i + 4] - ay;
		const e1z = pos[i + 5] - az;
		const e2x = pos[i + 6] - ax;
		const e2y = pos[i + 7] - ay;
		const e2z = pos[i + 8] - az;
		const sx = px - ax;
		const sy = py - ay;
		const sz = pz - az;
		// det = dir · (e1 × e2) with dir = (1,0,0) — depends on the triangle only
		const det = e1z * e2y - e1y * e2z;
		if (det > -1e-12 && det < 1e-12) {
			// ray parallel to the triangle plane: degenerate only if it grazes it
			if (strict) {
				const nx = e1y * e2z - e1z * e2y;
				const nyv = e1z * e2x - e1x * e2z;
				const nzv = e1x * e2y - e1y * e2x;
				const nl = Math.sqrt(nx * nx + nyv * nyv + nzv * nzv);
				if (nl > 1e-12 && Math.abs(sx * nx + sy * nyv + sz * nzv) / nl < PARITY_T_EPS) return -1;
			}
			continue;
		}
		const f = 1 / det;
		const u = f * (sz * e2y - sy * e2z);
		if (u < -PARITY_BARY_EPS || u > 1 + PARITY_BARY_EPS) continue;
		const v = f * (sy * e1z - sz * e1y);
		if (v < -PARITY_BARY_EPS || u + v > 1 + PARITY_BARY_EPS) continue;
		const qx = sy * e1z - sz * e1y;
		const qy = sz * e1x - sx * e1z;
		const qz = sx * e1y - sy * e1x;
		const t = f * (e2x * qx + e2y * qy + e2z * qz);
		if (strict) {
			if (t <= -PARITY_T_EPS) continue; // graze strictly behind cannot affect parity ahead
			if (t < PARITY_T_EPS) return -1; // origin (centroid) lies on the surface
			if (u < PARITY_BARY_EPS || v < PARITY_BARY_EPS || u + v > 1 - PARITY_BARY_EPS) return -1;
			crossings++;
		} else if (t > PARITY_T_EPS && u >= 0 && v >= 0 && u + v <= 1) {
			crossings++;
		}
	}
	return crossings;
}

/** Odd +X ray parity = inside. Degenerate hits retry once with a jittered origin. */
function insideParityGrid(g: ParityGrid | null, px: number, py: number, pz: number): boolean {
	if (
		!g ||
		px < g.minX - PARITY_T_EPS ||
		px > g.maxX + PARITY_T_EPS ||
		py < g.minY - PARITY_T_EPS ||
		py > g.maxY + PARITY_T_EPS ||
		pz < g.minZ - PARITY_T_EPS ||
		pz > g.maxZ + PARITY_T_EPS
	) {
		return false; // outside the bbox ⇒ outside the mesh
	}
	const first = countCrossingsX(g, px, py, pz, true);
	if (first >= 0) return (first & 1) === 1;
	const second = countCrossingsX(g, px, py + g.jitterY, pz + g.jitterZ, false);
	return (second & 1) === 1;
}

function opCombine(
	positions: Float32Array,
	modelId: number,
	mode: 'merge' | 'subtract',
	ctx?: MeshEditContext
): MeshEditResult {
	if (!ctx?.loadModel) throw new Error('combine is not available in this context');
	const src = ctx.loadModel(modelId);
	if (!src) throw new Error(`Model ${modelId} not found in this case`);
	// other-local → world → this-local: inv(selfT) · otherT
	const selfT = ctx.selfTransform && ctx.selfTransform.length === 16 ? ctx.selfTransform : IDENT4;
	const otherT = src.transform && src.transform.length === 16 ? src.transform : IDENT4;
	const M = mulMat4(invertMat4(selfT), otherT);
	const p = src.positions;
	const other = new Float32Array(p.length);
	for (let i = 0; i + 2 < p.length; i += 3) {
		const x = p[i];
		const y = p[i + 1];
		const z = p[i + 2];
		other[i] = M[0] * x + M[4] * y + M[8] * z + M[12];
		other[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13];
		other[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
	}

	if (mode !== 'subtract') {
		const out = new Float32Array(positions.length + other.length);
		out.set(positions, 0);
		out.set(other, positions.length);
		return {
			positions: out,
			report: { op: 'combine', mode: 'merge', sourceModel: modelId, addedTriangles: p.length / 9 }
		};
	}

	// subtract A − B: drop A's triangles inside B …
	const gridB = buildParityGrid(other);
	const triA = (positions.length / 9) | 0;
	const keepA = new Uint8Array(triA);
	let removed = 0;
	for (let t = 0; t < triA; t++) {
		const i = t * 9;
		const cx = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
		const cy = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
		const cz = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
		if (insideParityGrid(gridB, cx, cy, cz)) removed++;
		else keepA[t] = 1;
	}
	// … and add B's triangles inside A, inverted (they become the socket walls)
	const gridA = buildParityGrid(positions);
	const triB = (other.length / 9) | 0;
	const addB = new Uint8Array(triB);
	let added = 0;
	for (let t = 0; t < triB; t++) {
		const i = t * 9;
		const cx = (other[i] + other[i + 3] + other[i + 6]) / 3;
		const cy = (other[i + 1] + other[i + 4] + other[i + 7]) / 3;
		const cz = (other[i + 2] + other[i + 5] + other[i + 8]) / 3;
		if (insideParityGrid(gridA, cx, cy, cz)) {
			addB[t] = 1;
			added++;
		}
	}
	const out = new Float32Array((triA - removed + added) * 9);
	let o = 0;
	for (let t = 0; t < triA; t++) {
		if (!keepA[t]) continue;
		out.set(positions.subarray(t * 9, t * 9 + 9), o);
		o += 9;
	}
	for (let t = 0; t < triB; t++) {
		if (!addB[t]) continue;
		const i = t * 9;
		// keep vertex 0, swap vertices 1 and 2 → winding (and facet normal) flips
		out[o] = other[i];
		out[o + 1] = other[i + 1];
		out[o + 2] = other[i + 2];
		out[o + 3] = other[i + 6];
		out[o + 4] = other[i + 7];
		out[o + 5] = other[i + 8];
		out[o + 6] = other[i + 3];
		out[o + 7] = other[i + 4];
		out[o + 8] = other[i + 5];
		o += 9;
	}
	if (out.length === 0) throw new Error('Subtract removed the entire mesh');
	return {
		positions: out,
		report: {
			op: 'combine',
			mode: 'subtract',
			sourceModel: modelId,
			removedTriangles: removed,
			addedTriangles: added
		}
	};
}

// ---------------------------------------------------------------------------
// Dispatch + replay
// ---------------------------------------------------------------------------

/** Dispatch a single mesh-edit op over a triangle soup. Throws on bad input. */
export function applyMeshEdit(
	positions: Float32Array,
	op: MeshEditOp,
	ctx?: MeshEditContext
): MeshEditResult {
	if (positions.length < 9) throw new Error('Mesh is empty');
	switch (op.op) {
		case 'smooth':
			return opSmooth(
				positions,
				op.points?.length ? op.points : op.center ? [op.center] : null,
				op.radius ?? 5,
				op.mode === 'flatten' || op.mode === 'add' ? op.mode : undefined,
				op.strength
			);
		case 'remesh':
			return opRemesh(positions, op.center ?? null, op.radius ?? 5, op.maxEdge, op.iterations ?? 1);
		case 'fillHoles':
			return opFillHoles(positions, {
				maxEdges: op.maxEdges,
				exceptLargest: op.exceptLargest,
				hole: op.hole
			});
		case 'boundarySmooth': {
			const it = Number.isFinite(op.iterations) ? Math.round(op.iterations!) : 3;
			return opBoundarySmooth(positions, Math.min(10, Math.max(1, it)), op.loop);
		}
		case 'bridge':
			if (!op.a || !op.b) throw new Error('bridge requires points a and b');
			return opBridge(positions, op.a, op.b);
		case 'partialFill':
			if (!op.a || !op.b) throw new Error('partialFill requires points a and b');
			return opPartialFill(positions, op.a, op.b);
		case 'parts':
			if (!op.action) throw new Error('parts requires an action');
			return opParts(positions, op.action, op.part);
		case 'reduce':
			if (!Number.isFinite(op.targetPercent)) throw new Error('reduce requires targetPercent');
			return opReduce(positions, op.targetPercent!);
		case 'invert':
			return opInvert(positions);
		case 'erase':
			if (!op.center) throw new Error('erase requires center {x,y,z}');
			return opErase(
				positions,
				op.center,
				op.radius ?? 3,
				op.deep ?? false,
				op.axis ?? null,
				op.depth ?? DEEP_ERASE_DEPTH_MM
			);
		case 'marginCut':
			if (!op.points || !op.keep) throw new Error('marginCut requires points and keep side');
			return opMarginCut(positions, op.points, op.keep);
		case 'planeCut':
			if (!Number.isFinite(op.d)) throw new Error('planeCut requires plane offset d');
			return opPlaneCut(positions, op.axis ?? { x: 0, y: 0, z: 1 }, op.d!);
		case 'combine':
			if (op.modelId == null) throw new Error('combine requires modelId');
			return opCombine(positions, op.modelId, op.mode === 'subtract' ? 'subtract' : 'merge', ctx);
		default:
			throw new Error(`Unknown op '${(op as { op: string }).op}'`);
	}
}

export interface MeshEditReplay {
	positions: Float32Array;
	reports: MeshEditResult['report'][];
	triangles: number;
	vertices: number;
}

/**
 * Replay a client-held op list against the pristine baseline. Deterministic:
 * the same (baseline, ops) pair always yields the same soup, which makes
 * undo (pop + replay) and redo (re-push + replay) exact.
 */
export function applyMeshEditOps(
	baseline: Float32Array,
	ops: MeshEditOp[],
	ctx?: MeshEditContext
): MeshEditReplay {
	let cur = baseline;
	const reports: MeshEditResult['report'][] = [];
	for (let i = 0; i < ops.length; i++) {
		let res: MeshEditResult;
		try {
			res = applyMeshEdit(cur, ops[i], ctx);
		} catch (e) {
			throw new Error(`op ${i + 1} (${ops[i].op}): ${e instanceof Error ? e.message : e}`);
		}
		if (res.positions.length < 9) {
			throw new Error(`op ${i + 1} (${ops[i].op}) would leave an empty mesh`);
		}
		cur = res.positions;
		reports.push(res.report);
	}
	return {
		positions: cur,
		reports,
		triangles: cur.length / 9,
		vertices: vertexCount(weld(cur))
	};
}

// ---------------------------------------------------------------------------
// Virtual tooth extraction (SPEC §5.6, automated mesh extraction)
// ---------------------------------------------------------------------------

export type ExtractMode = 'cut' | 'cutClose' | 'cutAlveolus';

/**
 * Remove every triangle whose centroid lies inside the tooth capsule:
 * segment head → head + axis·depth, with
 *   cut / cutClose : depth 14 mm, radius = diameter/2 × 1.3
 *   cutAlveolus    : depth 18 mm, radius = diameter/2 × 1.8 (clears the socket)
 * cutClose additionally fills the freshly cut openings (loops ≤ 60 edges) to
 * mimic a healed site.
 */
export function extractToothFromSoup(
	positions: Float32Array,
	head: Vec3,
	axis: Vec3,
	diameter: number,
	mode: ExtractMode
): { positions: Float32Array; removed: number; holesFilled: number } {
	const len = Math.hypot(axis.x, axis.y, axis.z);
	if (!(len > 1e-9)) throw new Error('Axis must be non-zero');
	const ax = axis.x / len;
	const ay = axis.y / len;
	const az = axis.z / len;
	const depth = mode === 'cutAlveolus' ? 18 : 14;
	const radius = (diameter / 2) * (mode === 'cutAlveolus' ? 1.8 : 1.3);
	const r2 = radius * radius;

	const kept: number[] = [];
	let removed = 0;
	for (let i = 0; i + 8 < positions.length; i += 9) {
		const cx = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
		const cy = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
		const cz = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
		let t = (cx - head.x) * ax + (cy - head.y) * ay + (cz - head.z) * az;
		t = Math.max(0, Math.min(depth, t));
		const px = head.x + ax * t;
		const py = head.y + ay * t;
		const pz = head.z + az * t;
		const dx = cx - px;
		const dy = cy - py;
		const dz = cz - pz;
		if (dx * dx + dy * dy + dz * dz <= r2) {
			removed++;
			continue;
		}
		for (let v = 0; v < 9; v++) kept.push(positions[i + v]);
	}

	let out: Float32Array = Float32Array.from(kept);
	let holesFilled = 0;
	if (mode === 'cutClose' && out.length >= 9) {
		const res = opFillHoles(out);
		out = res.positions;
		holesFilled = Number(res.report.holesFilled) || 0;
	}
	return { positions: out, removed, holesFilled };
}
