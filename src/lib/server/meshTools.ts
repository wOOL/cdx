/**
 * Triangle-soup mesh utilities: repair, issue detection and z-range cut.
 *
 * Meshes are triangle soups — flat Float32Array of xyz positions whose
 * length is divisible by 9 (same convention as stl.ts). Units are mm.
 */

export interface RepairReport {
	removedDegenerate: number;
	removedDuplicate: number;
	flippedNormals: number;
}

export interface MeshIssues {
	degenerate: number;
	duplicates: number;
	openEdges: number;
}

/** Triangles with less area than this (mm²) are treated as degenerate. */
const DEGENERATE_AREA = 1e-10;

function triArea(p: Float32Array, i: number): number {
	const ux = p[i + 3] - p[i];
	const uy = p[i + 4] - p[i + 1];
	const uz = p[i + 5] - p[i + 2];
	const vx = p[i + 6] - p[i];
	const vy = p[i + 7] - p[i + 1];
	const vz = p[i + 8] - p[i + 2];
	const cx = uy * vz - uz * vy;
	const cy = uz * vx - ux * vz;
	const cz = ux * vy - uy * vx;
	return 0.5 * Math.hypot(cx, cy, cz);
}

function vertexKey(p: Float32Array, i: number): string {
	return `${p[i]},${p[i + 1]},${p[i + 2]}`;
}

/** Winding- and rotation-independent identity of a triangle's vertex set. */
function triKey(p: Float32Array, i: number): string {
	return [vertexKey(p, i), vertexKey(p, i + 3), vertexKey(p, i + 6)].sort().join('|');
}

/**
 * Repair a triangle soup:
 *  1. drop degenerate triangles (area < 1e-10 mm² — zero-area slivers,
 *     collapsed or collinear vertices);
 *  2. drop exact-duplicate triangles (same vertex SET as an earlier
 *     triangle, regardless of winding/rotation; first occurrence wins);
 *  3. unify the winding of the survivors.
 *
 * Winding heuristic & limits: every triangle is classified by the sign of
 * dot(faceNormal, faceCenter − meshCentroid) where meshCentroid is the mean
 * of all kept vertices; the minority sign is flipped to match the majority.
 * This is correct for closed surfaces that are star-shaped around their
 * centroid (spheres, domes, full-arch scans seen from outside) but can
 * misclassify strongly concave regions (e.g. the intaglio of a denture) and
 * leaves triangles whose dot product is exactly 0 (coplanar with the
 * centroid) untouched. It is a quick-repair tool, not a full topological
 * orientation solver.
 */
export function repairMesh(positions: Float32Array): {
	positions: Float32Array;
	report: RepairReport;
} {
	const triCount = Math.floor(positions.length / 9);
	const seen = new Set<string>();
	const keep: number[] = [];
	let removedDegenerate = 0;
	let removedDuplicate = 0;

	for (let t = 0; t < triCount; t++) {
		const i = t * 9;
		if (triArea(positions, i) < DEGENERATE_AREA) {
			removedDegenerate++;
			continue;
		}
		const key = triKey(positions, i);
		if (seen.has(key)) {
			removedDuplicate++;
			continue;
		}
		seen.add(key);
		keep.push(i);
	}

	const out = new Float32Array(keep.length * 9);
	for (let k = 0; k < keep.length; k++) {
		out.set(positions.subarray(keep[k], keep[k] + 9), k * 9);
	}

	// ---- unify winding (see doc comment for the heuristic's limits) ----
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (let i = 0; i < out.length; i += 3) {
		cx += out[i];
		cy += out[i + 1];
		cz += out[i + 2];
	}
	const vertCount = out.length / 3 || 1;
	cx /= vertCount;
	cy /= vertCount;
	cz /= vertCount;

	const signs = new Int8Array(keep.length);
	let plus = 0;
	let minus = 0;
	for (let t = 0; t < keep.length; t++) {
		const i = t * 9;
		const ux = out[i + 3] - out[i];
		const uy = out[i + 4] - out[i + 1];
		const uz = out[i + 5] - out[i + 2];
		const vx = out[i + 6] - out[i];
		const vy = out[i + 7] - out[i + 1];
		const vz = out[i + 8] - out[i + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		const fx = (out[i] + out[i + 3] + out[i + 6]) / 3 - cx;
		const fy = (out[i + 1] + out[i + 4] + out[i + 7]) / 3 - cy;
		const fz = (out[i + 2] + out[i + 5] + out[i + 8]) / 3 - cz;
		const d = nx * fx + ny * fy + nz * fz;
		signs[t] = d > 0 ? 1 : d < 0 ? -1 : 0;
		if (d > 0) plus++;
		else if (d < 0) minus++;
	}
	const majority = plus >= minus ? 1 : -1;

	let flippedNormals = 0;
	for (let t = 0; t < keep.length; t++) {
		if (signs[t] === 0 || signs[t] === majority) continue;
		// flip winding: swap the 2nd and 3rd vertex
		const i = t * 9;
		for (let v = 0; v < 3; v++) {
			const a = out[i + 3 + v];
			out[i + 3 + v] = out[i + 6 + v];
			out[i + 6 + v] = a;
		}
		flippedNormals++;
	}

	return { positions: out, report: { removedDegenerate, removedDuplicate, flippedNormals } };
}

/**
 * Non-destructive issue scan.
 *
 * - degenerate: triangles with area < 1e-10 mm².
 * - duplicates: triangles repeating an earlier triangle's vertex set.
 * - openEdges:  undirected edges (keyed by exact vertex positions) used by
 *   exactly one triangle — the open-boundary edge count. Every triangle in
 *   the soup contributes to the edge-use map (so duplicate triangles can
 *   mask open edges); zero-length edges of collapsed triangles are skipped.
 */
export function detectMeshIssues(positions: Float32Array): MeshIssues {
	const triCount = Math.floor(positions.length / 9);
	const seen = new Set<string>();
	const edgeUse = new Map<string, number>();
	let degenerate = 0;
	let duplicates = 0;

	for (let t = 0; t < triCount; t++) {
		const i = t * 9;
		if (triArea(positions, i) < DEGENERATE_AREA) degenerate++;
		const key = triKey(positions, i);
		if (seen.has(key)) duplicates++;
		else seen.add(key);

		for (let e = 0; e < 3; e++) {
			const a = vertexKey(positions, i + e * 3);
			const b = vertexKey(positions, i + ((e + 1) % 3) * 3);
			if (a === b) continue; // collapsed edge — not a boundary
			const ekey = a < b ? `${a}>${b}` : `${b}>${a}`;
			edgeUse.set(ekey, (edgeUse.get(ekey) ?? 0) + 1);
		}
	}

	let openEdges = 0;
	for (const n of edgeUse.values()) {
		if (n === 1) openEdges++;
	}
	return { degenerate, duplicates, openEdges };
}

/**
 * Keep only the triangles that lie FULLY inside [zMin, zMax] (inclusive).
 *
 * There is no retriangulation/plane clipping: triangles straddling either
 * bound are dropped whole, so the cut boundary is jagged at triangle
 * granularity and the result is always a subset of the input soup.
 */
export function cutMeshZ(positions: Float32Array, zMin: number, zMax: number): Float32Array {
	const triCount = Math.floor(positions.length / 9);
	const keep: number[] = [];
	for (let t = 0; t < triCount; t++) {
		const i = t * 9;
		const z0 = positions[i + 2];
		const z1 = positions[i + 5];
		const z2 = positions[i + 8];
		if (z0 >= zMin && z0 <= zMax && z1 >= zMin && z1 <= zMax && z2 >= zMin && z2 <= zMax) {
			keep.push(i);
		}
	}
	const out = new Float32Array(keep.length * 9);
	for (let k = 0; k < keep.length; k++) {
		out.set(positions.subarray(keep[k], keep[k] + 9), k * 9);
	}
	return out;
}
