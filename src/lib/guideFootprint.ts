/**
 * Guide footprint preview ("Show cut profile") — CLIENT-safe, dependency-free.
 *
 * Pure 2D helper mirroring the xy region mask of the server-side guide
 * generator (src/lib/server/guideGen.ts): the union of
 *  - a disc of `regionRadius` around each implant head,
 *  - connector capsules between consecutive implants (arch-ordered by angle
 *    around the xy centroid; radius regionRadius/2, or regionRadius with
 *    "use large connectors"),
 *  - bone support circles,
 *  - free-hand contact polygons.
 *
 * `guideFootprintOutline` returns the outline of that union as closed loops
 * of axial-plane points (volume-local mm, same coordinates the planner uses
 * for windows/support regions), extracted by marching squares at `step`
 * resolution. Loops are implicitly closed: consecutive points are outline
 * segments and the last point connects back to the first (draw with
 * moveTo/lineTo/closePath).
 *
 * This is the NOMINAL footprint: the generator additionally clips to the
 * surface scan's xy bounding box (+2mm); pass `clipRect` to reproduce that.
 */

export interface FootprintPoint {
	x: number;
	y: number;
}

export interface GuideFootprintParams {
	/** Implant head positions on the axial plane, volume-local mm. */
	implants: FootprintPoint[];
	/** Guide footprint radius around each implant, mm (default 9). */
	regionRadius?: number;
	/** Wide connector strips (radius = regionRadius instead of regionRadius/2). */
	largeConnectors?: boolean;
	/** Bone support circles, mm. */
	supportRegions?: { x: number; y: number; radius: number }[];
	/** Free-hand contact polygons, mm. */
	contactPolygons?: FootprintPoint[][];
	/** Optional scan-bbox clip rectangle (the generator clips to scan bbox + 2mm). */
	clipRect?: { minX: number; minY: number; maxX: number; maxY: number };
	/** Sampling resolution, mm (default 0.5; outline accuracy ≈ step/2). */
	step?: number;
}

/** Squared distance from (px,py) to the segment (ax,ay)-(bx,by). */
function pointSegDist2Sq(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const l2 = dx * dx + dy * dy;
	let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	const cx = ax + dx * t - px;
	const cy = ay + dy * t - py;
	return cx * cx + cy * cy;
}

/** Even-odd ray-cast point-in-polygon test. */
function pointInPolygon(px: number, py: number, poly: FootprintPoint[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const yi = poly[i].y;
		const yj = poly[j].y;
		if (yi > py === yj > py) continue;
		const xCross = poly[j].x + ((py - yj) / (yi - yj)) * (poly[i].x - poly[j].x);
		if (px < xCross) inside = !inside;
	}
	return inside;
}

/** Consecutive implant pairs ordered by angle around the xy centroid (dental arch order). */
function archPairs(heads: FootprintPoint[]): Array<[FootprintPoint, FootprintPoint]> {
	if (heads.length < 2) return [];
	let cx = 0;
	let cy = 0;
	for (const h of heads) {
		cx += h.x;
		cy += h.y;
	}
	cx /= heads.length;
	cy /= heads.length;
	const order = heads
		.map((h, i) => ({ i, ang: Math.atan2(h.y - cy, h.x - cx) }))
		.sort((a, b) => a.ang - b.ang)
		.map((e) => e.i);
	const pairs: Array<[FootprintPoint, FootprintPoint]> = [];
	for (let k = 0; k + 1 < order.length; k++) {
		pairs.push([heads[order[k]], heads[order[k + 1]]]);
	}
	return pairs;
}

/** Is (px,py) inside the planned guide footprint? Mirrors guideGen's region mask. */
export function guideFootprintContains(p: GuideFootprintParams, px: number, py: number): boolean {
	const regionRadius = p.regionRadius ?? 9;
	if (p.clipRect) {
		if (px < p.clipRect.minX || px > p.clipRect.maxX || py < p.clipRect.minY || py > p.clipRect.maxY) {
			return false;
		}
	}
	const r2 = regionRadius * regionRadius;
	for (const h of p.implants) {
		const dx = px - h.x;
		const dy = py - h.y;
		if (dx * dx + dy * dy <= r2) return true;
	}
	const connR = regionRadius * (p.largeConnectors ? 1.0 : 0.5);
	const connR2 = connR * connR;
	for (const [a, b] of archPairs(p.implants)) {
		if (pointSegDist2Sq(px, py, a.x, a.y, b.x, b.y) <= connR2) return true;
	}
	for (const s of p.supportRegions ?? []) {
		const dx = px - s.x;
		const dy = py - s.y;
		if (dx * dx + dy * dy <= s.radius * s.radius) return true;
	}
	for (const poly of p.contactPolygons ?? []) {
		if (poly.length >= 3 && pointInPolygon(px, py, poly)) return true;
	}
	return false;
}

/* Marching-squares segment table: case index = A | B<<1 | C<<2 | D<<3 for cell
 * corners A=(i,j) B=(i+1,j) C=(i+1,j+1) D=(i,j+1); edge midpoints S/E/N/W.
 * Each entry lists segments as edge pairs. Saddles (5, 10) emit two segments. */
const MS_EDGES: Record<'S' | 'E' | 'N' | 'W', [number, number]> = {
	S: [1, 0],
	E: [2, 1],
	N: [1, 2],
	W: [0, 1]
};
const MS_CASES: Array<Array<['S' | 'E' | 'N' | 'W', 'S' | 'E' | 'N' | 'W']>> = [
	[], // 0
	[['W', 'S']], // 1: A
	[['S', 'E']], // 2: B
	[['W', 'E']], // 3: A B
	[['E', 'N']], // 4: C
	[
		['W', 'S'],
		['E', 'N']
	], // 5: A C (saddle)
	[['S', 'N']], // 6: B C
	[['W', 'N']], // 7: A B C
	[['N', 'W']], // 8: D
	[['S', 'N']], // 9: A D
	[
		['S', 'E'],
		['N', 'W']
	], // 10: B D (saddle)
	[['E', 'N']], // 11: A B D
	[['E', 'W']], // 12: C D
	[['S', 'E']], // 13: A C D
	[['W', 'S']], // 14: B C D
	[] // 15
];

/**
 * Compute the planned guide footprint outline on the axial plane.
 * Returns zero or more closed loops of points in mm (implicitly closed).
 */
export function guideFootprintOutline(p: GuideFootprintParams): FootprintPoint[][] {
	const step = Math.max(0.1, p.step ?? 0.5);
	if (p.implants.length === 0) return [];

	// Bounding box of everything that can contribute, padded so loops close.
	const regionRadius = p.regionRadius ?? 9;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	const grow = (x: number, y: number, r: number): void => {
		minX = Math.min(minX, x - r);
		maxX = Math.max(maxX, x + r);
		minY = Math.min(minY, y - r);
		maxY = Math.max(maxY, y + r);
	};
	for (const h of p.implants) grow(h.x, h.y, regionRadius);
	for (const s of p.supportRegions ?? []) grow(s.x, s.y, s.radius);
	for (const poly of p.contactPolygons ?? []) for (const pt of poly) grow(pt.x, pt.y, 0);
	if (minX > maxX) return [];
	const pad = 2 * step;
	const ox = minX - pad;
	const oy = minY - pad;
	const nx = Math.ceil((maxX + pad - ox) / step) + 1;
	const ny = Math.ceil((maxY + pad - oy) / step) + 1;

	// Binary inside-field on grid nodes.
	const field = new Uint8Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		const py = oy + j * step;
		for (let i = 0; i < nx; i++) {
			if (guideFootprintContains(p, ox + i * step, py)) field[j * nx + i] = 1;
		}
	}

	// Marching squares: collect segments with endpoints on a doubled integer
	// lattice (edge midpoints have one odd coordinate) so they hash exactly.
	const segs: number[] = []; // gx1, gy1, gx2, gy2 per segment
	const key = (gx: number, gy: number): number => gx * 1048576 + gy; // grids stay < 2^20
	const atEdge = (i: number, j: number, e: 'S' | 'E' | 'N' | 'W'): [number, number] => {
		const [dx, dy] = MS_EDGES[e];
		return [2 * i + dx, 2 * j + dy];
	};
	for (let j = 0; j + 1 < ny; j++) {
		for (let i = 0; i + 1 < nx; i++) {
			const a = field[j * nx + i];
			const b = field[j * nx + i + 1];
			const c = field[(j + 1) * nx + i + 1];
			const d = field[(j + 1) * nx + i];
			const idx = a | (b << 1) | (c << 2) | (d << 3);
			for (const [e1, e2] of MS_CASES[idx]) {
				const [x1, y1] = atEdge(i, j, e1);
				const [x2, y2] = atEdge(i, j, e2);
				segs.push(x1, y1, x2, y2);
			}
		}
	}

	// Stitch segments into loops: every midpoint has degree exactly 2 (each
	// cell uses each of its edges at most once), so chains always close.
	const adj = new Map<number, number[]>(); // point key → segment indices
	const nSegs = segs.length / 4;
	for (let s = 0; s < nSegs; s++) {
		for (const k of [key(segs[s * 4], segs[s * 4 + 1]), key(segs[s * 4 + 2], segs[s * 4 + 3])]) {
			const list = adj.get(k);
			if (list) list.push(s);
			else adj.set(k, [s]);
		}
	}
	const used = new Uint8Array(nSegs);
	const toMm = (gx: number, gy: number): FootprintPoint => ({
		x: ox + (gx / 2) * step,
		y: oy + (gy / 2) * step
	});
	const loops: FootprintPoint[][] = [];
	for (let s0 = 0; s0 < nSegs; s0++) {
		if (used[s0]) continue;
		used[s0] = 1;
		const startKey = key(segs[s0 * 4], segs[s0 * 4 + 1]);
		let curKey = key(segs[s0 * 4 + 2], segs[s0 * 4 + 3]);
		const loop: FootprintPoint[] = [toMm(segs[s0 * 4], segs[s0 * 4 + 1])];
		while (curKey !== startKey) {
			loop.push(toMm(Math.floor(curKey / 1048576), curKey % 1048576));
			const candidates = adj.get(curKey) ?? [];
			let next = -1;
			for (const s of candidates) {
				if (!used[s]) {
					next = s;
					break;
				}
			}
			if (next < 0) break; // defensive: degenerate field — emit open chain
			used[next] = 1;
			const k1 = key(segs[next * 4], segs[next * 4 + 1]);
			curKey = k1 === curKey ? key(segs[next * 4 + 2], segs[next * 4 + 3]) : k1;
		}
		if (loop.length >= 3) loops.push(loop);
	}
	return loops;
}
