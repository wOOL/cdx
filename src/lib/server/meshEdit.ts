/**
 * Mesh editor operations (SPEC §5.7) on triangle soups, plus the virtual
 * tooth extraction cut (SPEC §5.6).
 *
 * All ops weld the soup first (1e-4 mm tolerance) so topology queries
 * (neighbors, boundary loops) work, then emit a fresh soup. Degenerate
 * triangles (repeated welded vertices) are dropped on output.
 *
 *   smooth    — Laplacian (λ = 0.5, 3 iterations) on vertices within
 *               `radius` of `center` (no center ⇒ whole mesh). mode
 *               'flatten' is the wax knife: after smoothing, selected
 *               vertices are pushed 0.2 mm inward along their area-weighted
 *               vertex normal (i.e. "smooth with a negative offset" —
 *               removes a thin layer of material).
 *   remesh    — one pass: triangles whose centroid lies within the radius
 *               and whose longest edge exceeds 2× the local mean edge
 *               length are midpoint-split (longest edge only), then one
 *               smoothing iteration runs over the region. Shared split
 *               edges weld back together; if only one side of an edge
 *               splits a hairline T-junction remains (acceptable for a
 *               display mesh, documented limitation).
 *   fillHoles — boundary loops are found via the directed-edge-use map
 *               (an edge with no reverse partner borders a hole); loops of
 *               ≤ 60 edges are closed with a centroid fan oriented
 *               consistently with the surrounding triangles. Longer or
 *               non-walkable (non-manifold) loops are skipped and counted.
 *   bridge    — connects the two boundary loops nearest to points `a` and
 *               `b` with a triangle strip: loops are aligned at their
 *               closest vertex pair, the walk direction of the second loop
 *               is chosen by proximity, then the rings are stitched by
 *               index ratio (n+m triangles). Limits: no twist
 *               minimization beyond the start/direction heuristic, loops
 *               that interleave in space can self-intersect, and the strip
 *               winding is not guaranteed to match both shells (STL facet
 *               normals are recomputed from the winding on save).
 */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export type MeshEditOpName = 'smooth' | 'remesh' | 'fillHoles' | 'bridge';

export interface MeshEditOp {
	op: MeshEditOpName;
	/** 'flatten' = wax knife (smooth, then subtract 0.2 mm along the normal) */
	mode?: 'flatten';
	center?: Vec3;
	radius?: number;
	a?: Vec3;
	b?: Vec3;
}

export interface MeshEditResult {
	positions: Float32Array;
	report: Record<string, number | string | boolean>;
}

const WELD_TOL = 1e-4; // mm
const FLATTEN_OFFSET_MM = 0.2;
const MAX_HOLE_EDGES = 60;
const SMOOTH_LAMBDA = 0.5;

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

/** Selection flags for vertices within `radius` of `center` (null ⇒ all). */
function selectVerts(w: Welded, center: Vec3 | null, radius: number): Uint8Array {
	const n = vertexCount(w);
	const sel = new Uint8Array(n);
	if (!center) {
		sel.fill(1);
		return sel;
	}
	const r2 = radius * radius;
	for (let v = 0; v < n; v++) {
		const dx = w.verts[v * 3] - center.x;
		const dy = w.verts[v * 3 + 1] - center.y;
		const dz = w.verts[v * 3 + 2] - center.z;
		if (dx * dx + dy * dy + dz * dz <= r2) sel[v] = 1;
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
 * Close loops of ≤ maxEdges edges with a centroid fan. The boundary edges run
 * a→b in the direction of the surviving triangles, so fan triangles (b, a, c)
 * provide the missing reverse edges and stay consistently oriented.
 */
function fillLoops(
	w: Welded,
	maxEdges: number
): { holesFilled: number; holesSkipped: number; openEdges: number } {
	const { loops, openEdges } = boundaryLoops(w);
	let holesFilled = 0;
	let holesSkipped = 0;
	for (const loop of loops) {
		if (loop.length > maxEdges) {
			holesSkipped++;
			continue;
		}
		const c = loopCentroid(w, loop);
		const cid = addVertex(w, c.x, c.y, c.z);
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i];
			const b = loop[(i + 1) % loop.length];
			w.tris.push(b, a, cid);
		}
		holesFilled++;
	}
	return { holesFilled, holesSkipped, openEdges };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function opSmooth(
	positions: Float32Array,
	center: Vec3 | null,
	radius: number,
	mode?: 'flatten'
): MeshEditResult {
	const w = weld(positions);
	const sel = selectVerts(w, center, radius);
	const moved = smoothVerts(w, sel, 3, SMOOTH_LAMBDA);
	if (mode === 'flatten') {
		// wax knife: remove a thin layer by offsetting inward along the normal
		const normals = vertexNormals(w);
		for (let v = 0; v < sel.length; v++) {
			if (!sel[v]) continue;
			const o = v * 3;
			w.verts[o] -= normals[o] * FLATTEN_OFFSET_MM;
			w.verts[o + 1] -= normals[o + 1] * FLATTEN_OFFSET_MM;
			w.verts[o + 2] -= normals[o + 2] * FLATTEN_OFFSET_MM;
		}
	}
	return {
		positions: toSoup(w),
		report: {
			op: 'smooth',
			mode: mode ?? 'laplacian',
			vertices: moved,
			iterations: 3
		}
	};
}

function opRemesh(positions: Float32Array, center: Vec3 | null, radius: number): MeshEditResult {
	const w = weld(positions);
	const triCount = w.tris.length / 3;
	const r2 = radius * radius;

	// selected triangles: centroid within radius (no center ⇒ all)
	const selectedTri = new Uint8Array(triCount);
	let edgeSum = 0;
	let edgeCount = 0;
	for (let t = 0; t < triCount; t++) {
		const a = w.tris[t * 3] * 3;
		const b = w.tris[t * 3 + 1] * 3;
		const c = w.tris[t * 3 + 2] * 3;
		if (center) {
			const cx = (w.verts[a] + w.verts[b] + w.verts[c]) / 3;
			const cy = (w.verts[a + 1] + w.verts[b + 1] + w.verts[c + 1]) / 3;
			const cz = (w.verts[a + 2] + w.verts[b + 2] + w.verts[c + 2]) / 3;
			if (dist2(cx, cy, cz, center) > r2) continue;
		}
		selectedTri[t] = 1;
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
	const meanEdge = edgeCount > 0 ? edgeSum / edgeCount : 0;
	const limit = 2 * meanEdge;

	let split = 0;
	const newTris: number[] = [];
	for (let t = 0; t < triCount; t++) {
		const ids = [w.tris[t * 3], w.tris[t * 3 + 1], w.tris[t * 3 + 2]];
		if (selectedTri[t] && limit > 0) {
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

	// one smoothing iteration over the (re-selected, midpoints included) region
	const sel = selectVerts(w, center, radius);
	const smoothed = smoothVerts(w, sel, 1, SMOOTH_LAMBDA);

	return {
		positions: toSoup(w),
		report: { op: 'remesh', split, meanEdgeMm: Math.round(meanEdge * 1000) / 1000, smoothedVertices: smoothed }
	};
}

function opFillHoles(positions: Float32Array): MeshEditResult {
	const w = weld(positions);
	const { holesFilled, holesSkipped, openEdges } = fillLoops(w, MAX_HOLE_EDGES);
	return {
		positions: toSoup(w),
		report: { op: 'fillHoles', holesFilled, holesSkipped, openEdgesBefore: openEdges }
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

/** Dispatch a single mesh-edit op over a triangle soup. Throws on bad input. */
export function applyMeshEdit(positions: Float32Array, op: MeshEditOp): MeshEditResult {
	if (positions.length < 9) throw new Error('Mesh is empty');
	switch (op.op) {
		case 'smooth':
			return opSmooth(positions, op.center ?? null, op.radius ?? 5, op.mode);
		case 'remesh':
			return opRemesh(positions, op.center ?? null, op.radius ?? 5);
		case 'fillHoles':
			return opFillHoles(positions);
		case 'bridge':
			if (!op.a || !op.b) throw new Error('bridge requires points a and b');
			return opBridge(positions, op.a, op.b);
		default:
			throw new Error(`Unknown op '${(op as { op: string }).op}'`);
	}
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
