/**
 * Automatic nerve canal detection (SPEC §6.3).
 *
 * Given two seed points (mental foramen entry / mandibular foramen exit) in
 * volume-local mm, traces the radiolucent mandibular canal between them with
 * an A* search over the voxel grid. The cost function favours the low-HU
 * corridor typical of the canal (soft tissue ≈ -400..200 HU) and penalises
 * cortical bone, so the cheapest path follows the canal lumen.
 *
 * Conventions match the rest of the server: Int16 HU volume, x fastest then
 * y then z, voxel center at i*spacing mm.
 */

export interface Pt3 {
	x: number;
	y: number;
	z: number;
}

export interface VolumeGrid {
	/** HU values, length dims.x * dims.y * dims.z, x fastest then y then z. */
	data: Int16Array;
	/** Voxel counts per axis (cols, rows, slices). */
	dims: { x: number; y: number; z: number };
	/** Voxel spacing in mm per axis. */
	spacing: { x: number; y: number; z: number };
}

export interface NerveDetectOptions {
	/** Dilation of the seed bounding box, mm (default 8). */
	marginMm?: number;
	/** Downsample the search grid 2× while the box exceeds this (default 2M). */
	maxVoxels?: number;
	/** Douglas-Peucker tolerance, mm (default 0.6). */
	simplifyTolMm?: number;
	/** Maximum number of returned points (default 25). */
	maxPoints?: number;
	/** Abort when accumulated cost exceeds capFactor * straight-line mm + 100. */
	costCapFactor?: number;
}

export interface NerveDetectResult {
	/** Polyline in volume-local mm, ordered start → end, ≤ maxPoints. */
	points: Pt3[];
	/** Always set; appended with a low-confidence note when mean path HU > 300. */
	warning: string | null;
}

/** Thrown when no path is found (cost cap exceeded / open set exhausted). */
export class NervePathNotFoundError extends Error {
	constructor(message = 'No path found between the seed points') {
		super(message);
		this.name = 'NervePathNotFoundError';
	}
}

const BASE_WARNING = 'Automatic detection — verify the nerve course manually on every slice';
const LOW_CONFIDENCE = '; low confidence: path crosses high-density voxels';

/** Traversal cost multiplier for a voxel: 1 in the canal corridor, up to 5 in dense bone. */
function costOf(hu: number): number {
	const t = (hu - -200) / 400;
	return 1 + Math.min(4, Math.max(0, t));
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

/** Perpendicular distance from p to segment ab (3D, mm). */
function pointSegDist(p: Pt3, a: Pt3, b: Pt3): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const apx = p.x - a.x;
	const apy = p.y - a.y;
	const apz = p.z - a.z;
	const len2 = abx * abx + aby * aby + abz * abz;
	const t = len2 > 0 ? clamp((apx * abx + apy * aby + apz * abz) / len2, 0, 1) : 0;
	const dx = apx - abx * t;
	const dy = apy - aby * t;
	const dz = apz - abz * t;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Douglas-Peucker polyline simplification (3D). */
function simplifyDP(pts: Pt3[], tol: number): Pt3[] {
	if (pts.length <= 2) return pts.slice();
	const keep = new Uint8Array(pts.length);
	keep[0] = 1;
	keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [a, b] = stack.pop()!;
		let maxD = -1;
		let maxI = -1;
		for (let i = a + 1; i < b; i++) {
			const d = pointSegDist(pts[i], pts[a], pts[b]);
			if (d > maxD) {
				maxD = d;
				maxI = i;
			}
		}
		if (maxD > tol && maxI > 0) {
			keep[maxI] = 1;
			stack.push([a, maxI], [maxI, b]);
		}
	}
	return pts.filter((_, i) => keep[i] === 1);
}

/** One light smoothing pass (0.25 / 0.5 / 0.25), endpoints fixed. */
function smooth(pts: Pt3[]): Pt3[] {
	if (pts.length < 3) return pts;
	const out: Pt3[] = [pts[0]];
	for (let i = 1; i < pts.length - 1; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const c = pts[i + 1];
		out.push({
			x: 0.25 * a.x + 0.5 * b.x + 0.25 * c.x,
			y: 0.25 * a.y + 0.5 * b.y + 0.25 * c.y,
			z: 0.25 * a.z + 0.5 * b.z + 0.25 * c.z
		});
	}
	out.push(pts[pts.length - 1]);
	return out;
}

/** Binary min-heap of node ids keyed by an external f-score array. */
class MinHeap {
	private ids: number[] = [];
	constructor(private f: Float64Array) {}
	get size(): number {
		return this.ids.length;
	}
	push(id: number): void {
		const ids = this.ids;
		const f = this.f;
		ids.push(id);
		let i = ids.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (f[ids[p]] <= f[ids[i]]) break;
			const t = ids[p];
			ids[p] = ids[i];
			ids[i] = t;
			i = p;
		}
	}
	pop(): number {
		const ids = this.ids;
		const f = this.f;
		const top = ids[0];
		const last = ids.pop()!;
		if (ids.length) {
			ids[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < ids.length && f[ids[l]] < f[ids[m]]) m = l;
				if (r < ids.length && f[ids[r]] < f[ids[m]]) m = r;
				if (m === i) break;
				const t = ids[m];
				ids[m] = ids[i];
				ids[i] = t;
				i = m;
			}
		}
		return top;
	}
}

/**
 * Detect the nerve canal path between two seed points.
 *
 * @param vol   HU volume with dims/spacing.
 * @param start seed in volume-local mm (e.g. mental foramen).
 * @param end   seed in volume-local mm (e.g. mandibular foramen).
 * @throws NervePathNotFoundError when the search exhausts or exceeds the cost cap.
 */
export function detectNervePath(
	vol: VolumeGrid,
	start: Pt3,
	end: Pt3,
	opts: NerveDetectOptions = {}
): NerveDetectResult {
	const { data, dims, spacing } = vol;
	const marginMm = opts.marginMm ?? 8;
	const maxVoxels = opts.maxVoxels ?? 2_000_000;
	const maxPoints = opts.maxPoints ?? 25;
	const capFactor = opts.costCapFactor ?? 25;

	if (
		![start.x, start.y, start.z, end.x, end.y, end.z].every(Number.isFinite) ||
		data.length !== dims.x * dims.y * dims.z
	) {
		throw new NervePathNotFoundError('Invalid seeds or volume');
	}

	// Seed voxel coordinates (clamped into the volume).
	const sv = {
		x: clamp(Math.round(start.x / spacing.x), 0, dims.x - 1),
		y: clamp(Math.round(start.y / spacing.y), 0, dims.y - 1),
		z: clamp(Math.round(start.z / spacing.z), 0, dims.z - 1)
	};
	const ev = {
		x: clamp(Math.round(end.x / spacing.x), 0, dims.x - 1),
		y: clamp(Math.round(end.y / spacing.y), 0, dims.y - 1),
		z: clamp(Math.round(end.z / spacing.z), 0, dims.z - 1)
	};

	// Dilated bounding box around the seeds (voxel coords).
	const mx = Math.ceil(marginMm / spacing.x);
	const my = Math.ceil(marginMm / spacing.y);
	const mz = Math.ceil(marginMm / spacing.z);
	const x0 = Math.max(0, Math.min(sv.x, ev.x) - mx);
	const y0 = Math.max(0, Math.min(sv.y, ev.y) - my);
	const z0 = Math.max(0, Math.min(sv.z, ev.z) - mz);
	const x1 = Math.min(dims.x - 1, Math.max(sv.x, ev.x) + mx);
	const y1 = Math.min(dims.y - 1, Math.max(sv.y, ev.y) + my);
	const z1 = Math.min(dims.z - 1, Math.max(sv.z, ev.z) + mz);

	// Downsample 2× (repeatedly if needed) while the box exceeds the budget.
	let step = 1;
	const boxCount = (s: number): number =>
		(Math.floor((x1 - x0) / s) + 1) *
		(Math.floor((y1 - y0) / s) + 1) *
		(Math.floor((z1 - z0) / s) + 1);
	while (boxCount(step) > maxVoxels && step < 8) step *= 2;

	const nx = Math.floor((x1 - x0) / step) + 1;
	const ny = Math.floor((y1 - y0) / step) + 1;
	const nz = Math.floor((z1 - z0) / step) + 1;
	const n = nx * ny * nz;
	const nxy = nx * ny;
	const CR = dims.x * dims.y;

	// Per-node traversal cost (sampled at the node voxel).
	const nodeCost = new Float32Array(n);
	for (let lz = 0; lz < nz; lz++) {
		const gz = z0 + lz * step;
		for (let ly = 0; ly < ny; ly++) {
			const rowBase = gz * CR + (y0 + ly * step) * dims.x + x0;
			const nodeBase = lz * nxy + ly * nx;
			for (let lx = 0; lx < nx; lx++) {
				nodeCost[nodeBase + lx] = costOf(data[rowBase + lx * step]);
			}
		}
	}

	// 26-connected neighbour offsets with Euclidean step lengths in mm.
	const offs: { d: number; dist: number; dx: number; dy: number; dz: number }[] = [];
	for (let dz = -1; dz <= 1; dz++) {
		for (let dy = -1; dy <= 1; dy++) {
			for (let dx = -1; dx <= 1; dx++) {
				if (!dx && !dy && !dz) continue;
				offs.push({
					d: dz * nxy + dy * nx + dx,
					dist: Math.hypot(dx * step * spacing.x, dy * step * spacing.y, dz * step * spacing.z),
					dx,
					dy,
					dz
				});
			}
		}
	}

	const toNode = (v: { x: number; y: number; z: number }): number => {
		const lx = clamp(Math.round((v.x - x0) / step), 0, nx - 1);
		const ly = clamp(Math.round((v.y - y0) / step), 0, ny - 1);
		const lz = clamp(Math.round((v.z - z0) / step), 0, nz - 1);
		return lz * nxy + ly * nx + lx;
	};
	const startNode = toNode(sv);
	const goalNode = toNode(ev);

	const gx = goalNode % nx;
	const gy = ((goalNode / nx) | 0) % ny;
	const gz = (goalNode / nxy) | 0;
	const heuristic = (lx: number, ly: number, lz: number): number =>
		Math.hypot(
			(lx - gx) * step * spacing.x,
			(ly - gy) * step * spacing.y,
			(lz - gz) * step * spacing.z
		);

	const straightMm = Math.hypot(
		(sv.x - ev.x) * spacing.x,
		(sv.y - ev.y) * spacing.y,
		(sv.z - ev.z) * spacing.z
	);
	const costCap = capFactor * Math.max(straightMm, 1) + 100;

	// A* with lazy-deletion binary heap.
	const g = new Float64Array(n).fill(Infinity);
	const f = new Float64Array(n).fill(Infinity);
	const came = new Int32Array(n).fill(-1);
	const closed = new Uint8Array(n);
	const heap = new MinHeap(f);
	g[startNode] = 0;
	f[startNode] = heuristic(startNode % nx, ((startNode / nx) | 0) % ny, (startNode / nxy) | 0);
	heap.push(startNode);

	let reached = false;
	while (heap.size) {
		const cur = heap.pop();
		if (closed[cur]) continue;
		closed[cur] = 1;
		if (cur === goalNode) {
			reached = true;
			break;
		}
		const cx = cur % nx;
		const cy = ((cur / nx) | 0) % ny;
		const cz = (cur / nxy) | 0;
		const cCost = nodeCost[cur];
		const cg = g[cur];
		for (const o of offs) {
			const tx = cx + o.dx;
			const ty = cy + o.dy;
			const tz = cz + o.dz;
			if (tx < 0 || tx >= nx || ty < 0 || ty >= ny || tz < 0 || tz >= nz) continue;
			const nb = cur + o.d;
			if (closed[nb]) continue;
			const tentative = cg + o.dist * 0.5 * (cCost + nodeCost[nb]);
			if (tentative > costCap || tentative >= g[nb]) continue;
			g[nb] = tentative;
			f[nb] = tentative + heuristic(tx, ty, tz);
			came[nb] = cur;
			heap.push(nb);
		}
	}
	if (!reached) throw new NervePathNotFoundError();

	// Reconstruct the dense voxel path (goal → start, then reverse).
	const denseNodes: number[] = [];
	for (let cur = goalNode; cur !== -1; cur = came[cur]) denseNodes.push(cur);
	denseNodes.reverse();

	// Mean HU along the dense path → confidence note.
	let huSum = 0;
	const dense: Pt3[] = [];
	for (const node of denseNodes) {
		const lx = node % nx;
		const ly = ((node / nx) | 0) % ny;
		const lz = (node / nxy) | 0;
		const vx = x0 + lx * step;
		const vy = y0 + ly * step;
		const vz = z0 + lz * step;
		huSum += data[vz * CR + vy * dims.x + vx];
		dense.push({ x: vx * spacing.x, y: vy * spacing.y, z: vz * spacing.z });
	}
	const meanHu = huSum / denseNodes.length;

	// Pin the exact seed positions (clamped to the volume) at the endpoints.
	const maxMm = {
		x: (dims.x - 1) * spacing.x,
		y: (dims.y - 1) * spacing.y,
		z: (dims.z - 1) * spacing.z
	};
	dense[0] = { x: clamp(start.x, 0, maxMm.x), y: clamp(start.y, 0, maxMm.y), z: clamp(start.z, 0, maxMm.z) };
	dense[dense.length - 1] = {
		x: clamp(end.x, 0, maxMm.x),
		y: clamp(end.y, 0, maxMm.y),
		z: clamp(end.z, 0, maxMm.z)
	};

	// Simplify to ≤ maxPoints (raise tolerance until it fits), then smooth lightly.
	let tol = opts.simplifyTolMm ?? 0.6;
	let pts = simplifyDP(dense, tol);
	while (pts.length > maxPoints) {
		tol *= 1.5;
		pts = simplifyDP(dense, tol);
	}
	pts = smooth(pts);

	let warning = BASE_WARNING;
	if (meanHu > 300) warning += LOW_CONFIDENCE;
	return { points: pts, warning };
}
