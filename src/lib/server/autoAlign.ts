/**
 * Automatic intraoral/model-scan → CBCT registration ("Align using AI assistant").
 *
 * Fully automatic, coarse-to-fine counterpart of the planner's manual
 * point-pair + "Refine fit (ICP)" flow:
 *
 *   1. target — points on the teeth/bone iso-surface of the CBCT volume
 *      (HU ≥ TEETH_ISO_HU), or, when the case already has AI-segmentation
 *      tooth models, the vertices of those models (volume mm, their row
 *      transform applied) — see buildCbctTarget;
 *   2. source — scan-mesh vertices, biased toward the occlusal-facing facets
 *      (triangles whose normal is within ~66° of the mesh's minor PCA axis),
 *      so tooth crowns rather than gingiva drive the correspondence;
 *   3. coarse — PCA minor-axis alignment with a yaw sweep (default 32 angles
 *      × 2 axis flips, plus a world-z axis fallback when the target's minor
 *      axis is far from z), each rotation with three translation seeds
 *      (centroid match and the two occlusal extent-percentile matches).
 *      A staged funnel ranks them: cheap 3 mm inlier counting on all seeds →
 *      short ICP on the 24 most promising pose-distinct seeds → medium ICP on
 *      the top 4, each stage re-scored by inlier-RMS / inlier-fraction;
 *   4. fine — the existing $lib/registration ICP (tight 1.5 mm gate to shed
 *      outlier pairs) from the winning pose.
 *
 * The returned transform maps the scan's FILE coordinates into volume mm —
 * the exact contract of models.transform (what PATCH /api/models/[id] and the
 * manual point-pair/ICP flow persist).
 *
 * Runtime bound: the whole call is synchronous on bun's event loop, so it is
 * hard-bounded: the funnel stages stop at opts.budgetMs (default 3000 ms,
 * keeping the best pose found so far); everything else is two O(volume)
 * passes for surface extraction plus capped-size ICP (≤ 3000 source /
 * ≤ 15000 target points). Measured on the synthetic 256×256×160 @ 0.4 mm
 * case (scripts/test-auto-align.ts): ≈ 0.06 s surface extraction + ≈ 1.8 s
 * per alignment (≈ 4.5 s worst-case on a heavily loaded host, budget-capped)
 * — under the 5 s synchronous limit, so no async job is used.
 */
import {
	applyMat4,
	composeMat4,
	icp,
	identityMat4,
	type Mat4,
	type Point3
} from '$lib/registration';
import { classifyAiModel } from '$lib/aiReviewMap';
import { resolveData } from '$lib/server/db';
import { loadVolume } from '$lib/server/volumeCache';
import { parsePly, parseStl } from '$lib/server/stl';
import type { Dataset, Model } from '$lib/types';

/** Iso-surface threshold for the CBCT target (teeth + cortical bone). */
export const TEETH_ISO_HU = 800;

/**
 * Quality gates on the fine-ICP result: rms in mm, fraction = share of scan
 * sample points with a CBCT surface neighbour within 2 mm after alignment.
 * good → trust (still show "verify"), check → warn, otherwise failed (422).
 */
export const AUTO_ALIGN_LIMITS = {
	rmsGood: 1.2,
	fracGood: 0.45,
	rmsCheck: 2.5,
	fracCheck: 0.2
} as const;

/** Inlier gate (mm) used for the coarse candidate scoring. */
const COARSE_GATE = 3;
/** Inlier gate (mm) used for the reported inlier count/fraction. */
const INLIER_GATE = 2;

export interface AutoAlignOptions {
	/** Coarse-funnel time budget in ms (default 3000); best pose so far is kept. */
	budgetMs?: number;
	/** Yaw angles per flip in the coarse sweep (default 24 → 15° steps). */
	yawSteps?: number;
	/** Max scan vertices used (default 3000). */
	maxSourcePoints?: number;
	/** Max CBCT surface points used (default 15000). */
	maxTargetPoints?: number;
}

export interface AutoAlignResult {
	/** Column-major 4×4 mapping scan file coordinates → volume mm. */
	transform: Mat4;
	/** RMS of the accepted ICP pairs after the final fine pass (mm). */
	rms: number;
	/** Scan sample points with a target neighbour ≤ 2 mm after alignment. */
	inliers: number;
	inlierFraction: number;
	quality: 'good' | 'check' | 'failed';
	candidatesTried: number;
	runtimeMs: number;
}

/* ------------------------------------------------------------------ */
/* small 3-vector / row-major 3×3 helpers                              */
/* ------------------------------------------------------------------ */

type Vec3 = [number, number, number];
type Mat3 = number[]; // row-major, m[row * 3 + col]

function vDot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vCross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vNormalize(a: Vec3): Vec3 {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
}

/** Any unit vector orthogonal to the given unit vector. */
function anyOrthogonalUnit(u: Vec3): Vec3 {
	const ax = Math.abs(u[0]);
	const ay = Math.abs(u[1]);
	const az = Math.abs(u[2]);
	const pick: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
	return vNormalize(vCross(u, pick));
}

function mat3Mul(a: Mat3, b: Mat3): Mat3 {
	const out = new Array<number>(9).fill(0);
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 3; c++) {
			let s = 0;
			for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
			out[r * 3 + c] = s;
		}
	}
	return out;
}

function mat3Apply(m: Mat3, v: Vec3): Vec3 {
	return [
		m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
		m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
		m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
	];
}

/** Rodrigues rotation about a unit axis (row-major 3×3). */
function rotAxisAngle(u: Vec3, angle: number): Mat3 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const t = 1 - c;
	const [x, y, z] = u;
	return [
		t * x * x + c, t * x * y - s * z, t * x * z + s * y,
		t * x * y + s * z, t * y * y + c, t * y * z - s * x,
		t * x * z - s * y, t * y * z + s * x, t * z * z + c
	];
}

/** Shortest rotation taking unit vector a onto unit vector b (row-major 3×3). */
function rotationFromTo(a: Vec3, b: Vec3): Mat3 {
	const c = vDot(a, b);
	if (c < -0.999999) return rotAxisAngle(anyOrthogonalUnit(a), Math.PI);
	const v = vCross(a, b);
	const k = 1 / (1 + c);
	const [vx, vy, vz] = v;
	// I + [v]× + k·[v]×²
	return [
		1 + k * (-vy * vy - vz * vz), -vz + k * vx * vy, vy + k * vx * vz,
		vz + k * vx * vy, 1 + k * (-vx * vx - vz * vz), -vx + k * vy * vz,
		-vy + k * vx * vz, vx + k * vy * vz, 1 + k * (-vx * vx - vy * vy)
	];
}

/** Column-major 4×4 from a row-major rotation + translation. */
function rigidMat4(r: Mat3, t: Vec3): Mat4 {
	return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1];
}

/* ------------------------------------------------------------------ */
/* PCA (centroid + major/minor axes via power iteration)               */
/* ------------------------------------------------------------------ */

function powerIteration(m: Mat3): Vec3 {
	let v: Vec3 = [0.6, 0.55, 0.58];
	for (let i = 0; i < 60; i++) {
		const n = mat3Apply(m, v);
		const len = Math.hypot(n[0], n[1], n[2]);
		if (len < 1e-12) return [0, 0, 1];
		v = [n[0] / len, n[1] / len, n[2] / len];
	}
	return v;
}

function pcaAxes(pts: Point3[]): { centroid: Vec3; major: Vec3; minor: Vec3 } {
	const n = pts.length;
	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (const p of pts) {
		cx += p.x;
		cy += p.y;
		cz += p.z;
	}
	cx /= n;
	cy /= n;
	cz /= n;

	let xx = 0;
	let xy = 0;
	let xz = 0;
	let yy = 0;
	let yz = 0;
	let zz = 0;
	for (const p of pts) {
		const dx = p.x - cx;
		const dy = p.y - cy;
		const dz = p.z - cz;
		xx += dx * dx;
		xy += dx * dy;
		xz += dx * dz;
		yy += dy * dy;
		yz += dy * dz;
		zz += dz * dz;
	}
	const cov: Mat3 = [xx / n, xy / n, xz / n, xy / n, yy / n, yz / n, xz / n, yz / n, zz / n];

	const major = powerIteration(cov);
	// deflate the dominant eigenpair, then the second axis from the remainder
	const lam = vDot(major, mat3Apply(cov, major));
	const defl: Mat3 = cov.map((v, i) => {
		const r = (i / 3) | 0;
		const c = i % 3;
		return v - lam * major[r] * major[c];
	});
	let second = powerIteration(defl);
	const d = vDot(second, major);
	second = [second[0] - d * major[0], second[1] - d * major[1], second[2] - d * major[2]];
	const len = Math.hypot(second[0], second[1], second[2]);
	second = len > 1e-9 ? [second[0] / len, second[1] / len, second[2] / len] : anyOrthogonalUnit(major);
	const cross = vCross(major, second);
	const cl = Math.hypot(cross[0], cross[1], cross[2]);
	const minor: Vec3 = cl > 1e-9 ? [cross[0] / cl, cross[1] / cl, cross[2] / cl] : anyOrthogonalUnit(major);
	return { centroid: [cx, cy, cz], major, minor };
}

/* ------------------------------------------------------------------ */
/* subsampling + inlier counting                                       */
/* ------------------------------------------------------------------ */

function subsamplePoints(pts: Point3[], max: number): Point3[] {
	if (pts.length <= max) return pts;
	const out: Point3[] = [];
	const stride = pts.length / max;
	for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * stride)]);
	return out;
}

/**
 * Spatial hash with cell = maxDist, so ±1 cell covers the search radius.
 * Numeric keys (collision-free for |cell index + 4096| < 8192, i.e. any
 * clinical mm range) — measurably faster than string keys on the hot path.
 */
function hashKey(ix: number, iy: number, iz: number): number {
	return ((ix + 4096) * 8192 + (iy + 4096)) * 8192 + (iz + 4096);
}

function buildHash(points: Point3[], cell: number): Map<number, Point3[]> {
	const map = new Map<number, Point3[]>();
	for (const p of points) {
		const key = hashKey(Math.floor(p.x / cell), Math.floor(p.y / cell), Math.floor(p.z / cell));
		const bucket = map.get(key);
		if (bucket) bucket.push(p);
		else map.set(key, [p]);
	}
	return map;
}

function countInliers(
	source: Point3[],
	transform: Mat4,
	hash: Map<number, Point3[]>,
	maxDist: number
): { count: number; fraction: number } {
	const d2max = maxDist * maxDist;
	let count = 0;
	for (const p of source) {
		const q = applyMat4(transform, p);
		const cx = Math.floor(q.x / maxDist);
		const cy = Math.floor(q.y / maxDist);
		const cz = Math.floor(q.z / maxDist);
		let hit = false;
		for (let dx = -1; dx <= 1 && !hit; dx++) {
			for (let dy = -1; dy <= 1 && !hit; dy++) {
				for (let dz = -1; dz <= 1 && !hit; dz++) {
					const bucket = hash.get(hashKey(cx + dx, cy + dy, cz + dz));
					if (!bucket) continue;
					for (const t of bucket) {
						const ddx = t.x - q.x;
						const ddy = t.y - q.y;
						const ddz = t.z - q.z;
						if (ddx * ddx + ddy * ddy + ddz * ddz <= d2max) {
							hit = true;
							break;
						}
					}
				}
			}
		}
		if (hit) count++;
	}
	return { count, fraction: source.length > 0 ? count / source.length : 0 };
}

/* ------------------------------------------------------------------ */
/* point-set builders                                                  */
/* ------------------------------------------------------------------ */

/**
 * Surface points of the HU iso-surface (voxel ≥ threshold with at least one
 * 6-neighbour below it), in volume mm (voxel center = index · spacing — the
 * same convention as the mask/LOD meshers). Two passes: count, then collect
 * every stride-th surface voxel so the result is ≤ maxPoints and unbiased.
 */
export function extractIsoSurfacePoints(
	vol: Int16Array,
	dims: [number, number, number],
	spacing: [number, number, number],
	thresholdHU = TEETH_ISO_HU,
	maxPoints = 15000
): Point3[] {
	const [nx, ny, nz] = dims;
	const nxny = nx * ny;
	const th = thresholdHU;

	let count = 0;
	for (let pass = 0; pass < 2; pass++) {
		const stride = pass === 0 ? 0 : Math.max(1, Math.ceil(count / maxPoints));
		const out: Point3[] = [];
		let seen = 0;
		for (let z = 1; z < nz - 1; z++) {
			for (let y = 1; y < ny - 1; y++) {
				const base = z * nxny + y * nx;
				for (let x = 1; x < nx - 1; x++) {
					const i = base + x;
					if (vol[i] < th) continue;
					if (
						vol[i - 1] < th ||
						vol[i + 1] < th ||
						vol[i - nx] < th ||
						vol[i + nx] < th ||
						vol[i - nxny] < th ||
						vol[i + nxny] < th
					) {
						if (pass === 0) count++;
						else {
							if (seen % stride === 0) {
								out.push({ x: x * spacing[0], y: y * spacing[1], z: z * spacing[2] });
							}
							seen++;
						}
					}
				}
			}
		}
		if (pass === 1) return out;
		if (count === 0) return [];
	}
	return [];
}

/**
 * Sample points from a scan-mesh triangle soup, preferring the occlusal
 * region: vertices of triangles whose normal is within ~66° (|cos| ≥ 0.4) of
 * the mesh's minor PCA axis (the occlusal axis of an arch scan, sign-agnostic
 * — the coarse flip search resolves up vs down). Falls back to uniform vertex
 * sampling when the facet filter keeps too little of the mesh.
 */
export function sampleScanSurface(positions: Float32Array, maxPoints = 3000): Point3[] {
	const nVerts = Math.floor(positions.length / 3);
	if (nVerts < 3) return [];

	// minor PCA axis from a strided vertex sample
	const pcaSample: Point3[] = [];
	const vStride = Math.max(1, Math.floor(nVerts / 5000)) * 3;
	for (let i = 0; i + 2 < positions.length; i += vStride) {
		pcaSample.push({ x: positions[i], y: positions[i + 1], z: positions[i + 2] });
	}
	if (pcaSample.length < 3) return subsamplePoints(pcaSample, maxPoints);
	const { minor } = pcaAxes(pcaSample);

	const triCount = Math.floor(positions.length / 9);
	const tStride = Math.max(1, Math.floor(triCount / 20000));
	const occlusal: Point3[] = [];
	for (let t = 0; t < triCount; t += tStride) {
		const i = t * 9;
		const e1x = positions[i + 3] - positions[i];
		const e1y = positions[i + 4] - positions[i + 1];
		const e1z = positions[i + 5] - positions[i + 2];
		const e2x = positions[i + 6] - positions[i];
		const e2y = positions[i + 7] - positions[i + 1];
		const e2z = positions[i + 8] - positions[i + 2];
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		const len = Math.hypot(nx, ny, nz);
		if (len < 1e-12) continue;
		const cos = (nx * minor[0] + ny * minor[1] + nz * minor[2]) / len;
		if (Math.abs(cos) < 0.4) continue;
		for (let v = 0; v < 9; v += 3) {
			occlusal.push({ x: positions[i + v], y: positions[i + v + 1], z: positions[i + v + 2] });
		}
	}

	if (occlusal.length >= Math.max(500, nVerts * 0.1)) {
		return subsamplePoints(occlusal, maxPoints);
	}

	// fallback: uniform vertex sample
	const all: Point3[] = [];
	const aStride = Math.max(1, Math.floor(nVerts / maxPoints)) * 3;
	for (let i = 0; i + 2 < positions.length && all.length < maxPoints; i += aStride) {
		all.push({ x: positions[i], y: positions[i + 1], z: positions[i + 2] });
	}
	return all;
}

/* ------------------------------------------------------------------ */
/* coarse-to-fine alignment                                            */
/* ------------------------------------------------------------------ */

/** p-quantile (0..1) of dot(point, dir) over a point set. */
function projectionQuantile(pts: Point3[], dir: Vec3, q: number): number {
	const proj = pts.map((p) => p.x * dir[0] + p.y * dir[1] + p.z * dir[2]);
	proj.sort((a, b) => a - b);
	return proj[Math.min(proj.length - 1, Math.max(0, Math.floor(q * proj.length)))];
}

/** Near-duplicate poses: rotation within ~10° AND translation within 4 mm. */
function similarPose(a: Mat4, b: Mat4): boolean {
	const dt = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
	if (dt > 4) return false;
	// trace of RaᵀRb (column-major upper 3×3) → relative rotation angle
	let tr = 0;
	for (let c = 0; c < 3; c++) {
		for (let r = 0; r < 3; r++) tr += a[c * 4 + r] * b[c * 4 + r];
	}
	const cos = Math.max(-1, Math.min(1, (tr - 1) / 2));
	return Math.acos(cos) < (10 * Math.PI) / 180;
}

/** Best-first selection of up to `max` mutually distinct poses. */
function pickDiverse<T extends { m: Mat4 }>(sorted: T[], max: number): T[] {
	const out: T[] = [];
	for (const cand of sorted) {
		if (out.some((o) => similarPose(o.m, cand.m))) continue;
		out.push(cand);
		if (out.length >= max) break;
	}
	return out;
}

/**
 * Register the scan point set onto the CBCT target point set (both mm).
 * Pure and synchronous; see the module doc for the algorithm and the
 * budgetMs runtime bound.
 *
 * Coarse search: for every rotation candidate (axis-flip × yaw sweep) three
 * translation seeds are scored — centroid-to-centroid, and two "occlusal"
 * seeds that match the clouds' 95th/5th-percentile extent along the
 * candidate occlusal axis (an intraoral scan covers only the crown band, so
 * its centroid sits well off the full bone cloud's centroid; the crown tips,
 * however, are the extreme of BOTH clouds along the occlusal direction —
 * both percentiles are tried because the scan's minor-axis sign is
 * arbitrary). All seeds are ranked by a cheap 3 mm inlier count, the best
 * pose-distinct few get short ICP runs, the best of those get a
 * medium-resolution ICP, and the winner a final tight-gate ICP on the full
 * (capped) sets.
 */
export function autoAlign(
	source: Point3[],
	target: Point3[],
	opts: AutoAlignOptions = {}
): AutoAlignResult {
	const t0 = Date.now();
	const budgetMs = opts.budgetMs ?? 3000;
	const yawSteps = opts.yawSteps ?? 32;
	const overBudget = () => Date.now() - t0 > budgetMs;

	const failed = (candidates: number): AutoAlignResult => ({
		transform: identityMat4(),
		rms: Infinity,
		inliers: 0,
		inlierFraction: 0,
		quality: 'failed',
		candidatesTried: candidates,
		runtimeMs: Date.now() - t0
	});
	if (source.length < 50 || target.length < 50) return failed(0);

	const srcFine = subsamplePoints(source, opts.maxSourcePoints ?? 3000);
	const tgtFine = subsamplePoints(target, opts.maxTargetPoints ?? 15000);
	const srcCoarse = subsamplePoints(srcFine, 400);
	const tgtCoarse = subsamplePoints(tgtFine, 6000); // scoring density (~1.5 mm)
	const tgtCoarseIcp = subsamplePoints(tgtCoarse, 3000); // cheaper short-ICP target

	const sp = pcaAxes(srcCoarse);
	const tp = pcaAxes(tgtCoarse);
	const coarseHash = buildHash(tgtCoarse, COARSE_GATE);
	const coarseTightHash = buildHash(tgtCoarse, INLIER_GATE);

	// candidate "occlusal" axes of the target: its minor PCA axis, plus the
	// world z axis when they disagree (CBCT volumes are usually z-up but the
	// bone cloud's minor axis can drift on short scans)
	const axes: Vec3[] = [tp.minor];
	if (Math.abs(vDot(tp.minor, [0, 0, 1])) < Math.cos((20 * Math.PI) / 180)) {
		axes.push([0, 0, 1]);
	}

	// ---- stage A: cheap inlier scoring of every rotation × translation seed
	interface Seed {
		m: Mat4;
		frac: number;
	}
	const seeds: Seed[] = [];
	let candidates = 0;
	sweep: for (const axis of axes) {
		for (const flip of [1, -1] as const) {
			const dir: Vec3 = [axis[0] * flip, axis[1] * flip, axis[2] * flip];
			const base = rotationFromTo(sp.minor, dir);
			const q95t = projectionQuantile(tgtCoarse, dir, 0.95);
			const q05t = projectionQuantile(tgtCoarse, dir, 0.05);
			for (let k = 0; k < yawSteps; k++) {
				if (candidates > 0 && overBudget()) break sweep;
				const r = mat3Mul(rotAxisAngle(dir, (2 * Math.PI * k) / yawSteps), base);
				const rc = mat3Apply(r, sp.centroid);
				const tCentroid: Vec3 = [
					tp.centroid[0] - rc[0],
					tp.centroid[1] - rc[1],
					tp.centroid[2] - rc[2]
				];
				// occlusal seeds: in-plane centroids matched, extent percentile
				// matched along dir. Crown tips are the extreme of BOTH clouds
				// along the true "up" direction, but the sign of the scan's
				// minor PCA axis is arbitrary, so the correct rotation family
				// may have dir = up or dir = down — match the 95th percentile
				// (crowns when dir = up) AND the 5th (crowns when dir = down).
				const mRot = rigidMat4(r, [0, 0, 0]);
				const rotated = srcCoarse.map((p) => applyMat4(mRot, p));
				const along = vDot(tCentroid, dir);
				const dHigh = q95t - projectionQuantile(rotated, dir, 0.95) - along;
				const dLow = q05t - projectionQuantile(rotated, dir, 0.05) - along;
				const tHigh: Vec3 = [
					tCentroid[0] + dir[0] * dHigh,
					tCentroid[1] + dir[1] * dHigh,
					tCentroid[2] + dir[2] * dHigh
				];
				const tLow: Vec3 = [
					tCentroid[0] + dir[0] * dLow,
					tCentroid[1] + dir[1] * dLow,
					tCentroid[2] + dir[2] * dLow
				];
				for (const t of [tCentroid, tHigh, tLow]) {
					candidates++;
					const m0 = rigidMat4(r, t);
					const { fraction } = countInliers(srcCoarse, m0, coarseHash, COARSE_GATE);
					if (fraction >= 0.05) seeds.push({ m: m0, frac: fraction });
				}
			}
		}
	}
	if (seeds.length === 0) return failed(candidates);
	seeds.sort((a, b) => b.frac - a.frac);
	// near-duplicate seeds (adjacent yaw steps, both translation variants of
	// one basin) would crowd the true pose out of the funnel — dedupe first
	const diverseSeeds = pickDiverse(seeds, 24);

	// ---- stage B: short ICP on every surviving seed, re-scored tightly
	interface Scored {
		m: Mat4;
		score: number;
	}
	const refined: Scored[] = [];
	for (const seed of diverseSeeds) {
		if (refined.length > 0 && overBudget()) break;
		const moved = srcCoarse.map((p) => applyMat4(seed.m, p));
		const fit = icp(moved, tgtCoarseIcp, { maxIterations: 6, maxPairDistance: 5 });
		if (!Number.isFinite(fit.rms)) continue;
		const mc = composeMat4(fit.transform, seed.m);
		const { fraction } = countInliers(srcCoarse, mc, coarseTightHash, INLIER_GATE);
		if (fraction < 0.1) continue;
		refined.push({ m: mc, score: Math.max(fit.rms, 0.05) / Math.max(fraction, 0.01) });
	}
	if (refined.length === 0) return failed(candidates);
	refined.sort((a, b) => a.score - b.score);

	// ---- stage C: medium-resolution ICP on the top poses, pick the winner
	const srcMid = subsamplePoints(srcFine, 1200);
	const tgtMid = subsamplePoints(tgtFine, 8000);
	const midHash = buildHash(tgtMid, INLIER_GATE);
	let best: { m: Mat4; rms: number; score: number } | null = null;
	for (const cand of pickDiverse(refined, 4)) {
		if (best && overBudget()) break;
		const moved = srcMid.map((p) => applyMat4(cand.m, p));
		const fit = icp(moved, tgtMid, { maxIterations: 12, maxPairDistance: 3 });
		if (!Number.isFinite(fit.rms)) continue;
		const mc = composeMat4(fit.transform, cand.m);
		const { fraction } = countInliers(srcMid, mc, midHash, INLIER_GATE);
		const score = Math.max(fit.rms, 0.05) / Math.max(fraction, 0.01);
		if (!best || score < best.score) best = { m: mc, rms: fit.rms, score };
	}
	if (!best) return failed(candidates);

	// ---- fine: tight-gate ICP on the full (capped) sets from the winner
	let m = best.m;
	let rms = best.rms;
	{
		const moved = srcFine.map((p) => applyMat4(m, p));
		const fit = icp(moved, tgtFine, { maxIterations: 30, maxPairDistance: 1.5 });
		if (Number.isFinite(fit.rms)) {
			m = composeMat4(fit.transform, m);
			rms = fit.rms;
		}
	}
	if (!Number.isFinite(rms)) return failed(candidates);

	const fineHash = buildHash(tgtFine, INLIER_GATE);
	const { count, fraction } = countInliers(srcFine, m, fineHash, INLIER_GATE);
	const L = AUTO_ALIGN_LIMITS;
	const quality: AutoAlignResult['quality'] =
		rms <= L.rmsGood && fraction >= L.fracGood
			? 'good'
			: rms <= L.rmsCheck && fraction >= L.fracCheck
				? 'check'
				: 'failed';

	return {
		transform: m,
		rms,
		inliers: count,
		inlierFraction: fraction,
		quality,
		candidatesTried: candidates,
		runtimeMs: Date.now() - t0
	};
}

/* ------------------------------------------------------------------ */
/* dataset/model orchestration                                         */
/* ------------------------------------------------------------------ */

function parseTransform(s: string | null | undefined): Mat4 | null {
	if (!s) return null;
	try {
		const t = JSON.parse(s) as unknown;
		return Array.isArray(t) && t.length === 16 && t.every((v) => Number.isFinite(v))
			? (t as Mat4)
			: null;
	} catch {
		return null;
	}
}

/** AI-segmentation tooth rows usable as registration target for this dataset. */
function isAiToothModel(m: Model, datasetId: number): boolean {
	if (m.kind !== 'segmentation' || !m.file_path) return false;
	let p: { ai?: boolean; class?: string; fdi?: number; dataset_id?: number } | null = null;
	try {
		p = m.params ? JSON.parse(m.params) : null;
	} catch {
		return false;
	}
	if (!p?.ai) return false;
	if (p.dataset_id != null && p.dataset_id !== datasetId) return false;
	return classifyAiModel(m.name, p).kind === 'tooth' || p.class === 'teeth';
}

/**
 * CBCT-side target points: vertices of the case's AI tooth models (preferred
 * — they are exactly the structures an intraoral scan shows), else the HU
 * iso-surface of the volume at TEETH_ISO_HU.
 */
export async function buildCbctTarget(
	ds: Dataset,
	caseModels: Model[],
	maxPoints = 15000
): Promise<{ points: Point3[]; source: 'ai-teeth' | 'iso-surface' }> {
	const teeth: Point3[] = [];
	for (const m of caseModels) {
		if (!isAiToothModel(m, ds.id)) continue;
		const file = Bun.file(resolveData(m.file_path));
		if (!(await file.exists())) continue;
		const bytes = new Uint8Array(await file.arrayBuffer());
		const parsed = parseStl(bytes) ?? parsePly(bytes);
		if (!parsed) continue;
		const t = parseTransform(m.transform);
		const pos = parsed.positions;
		const stride = Math.max(1, Math.floor(pos.length / 3 / 2000)) * 3;
		for (let i = 0; i + 2 < pos.length; i += stride) {
			const p = { x: pos[i], y: pos[i + 1], z: pos[i + 2] };
			teeth.push(t ? applyMat4(t, p) : p);
		}
	}
	if (teeth.length >= 1500) {
		return { points: subsamplePoints(teeth, maxPoints), source: 'ai-teeth' };
	}

	const vol = await loadVolume(ds);
	return {
		points: extractIsoSurfacePoints(
			vol,
			[ds.cols, ds.rows, ds.slices],
			[ds.spacing_x, ds.spacing_y, ds.spacing_z],
			TEETH_ISO_HU,
			maxPoints
		),
		source: 'iso-surface'
	};
}

/**
 * Full pipeline for a model row: load + parse its mesh file, build the CBCT
 * target (AI teeth if available, else iso-surface) and register. Throws a
 * plain Error with a user-facing message on unusable inputs. Does NOT persist
 * — the endpoint writes models.transform only when quality is acceptable.
 */
export async function autoAlignModelToDataset(
	model: Model,
	ds: Dataset,
	caseModels: Model[],
	opts: AutoAlignOptions = {}
): Promise<AutoAlignResult & { targetSource: 'ai-teeth' | 'iso-surface' }> {
	if (!model.file_path) throw new Error('Model has no mesh file');
	const file = Bun.file(resolveData(model.file_path));
	if (!(await file.exists())) throw new Error('Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = parseStl(bytes) ?? parsePly(bytes);
	if (!parsed) throw new Error('Model file is not a readable STL/PLY mesh');

	const source = sampleScanSurface(parsed.positions, opts.maxSourcePoints ?? 3000);
	if (source.length < 50) throw new Error('Scan mesh has too few usable vertices');

	const target = await buildCbctTarget(ds, caseModels, opts.maxTargetPoints ?? 15000);
	if (target.points.length < 50) {
		throw new Error('No teeth/bone surface found in the CBCT volume at the registration threshold');
	}

	return { ...autoAlign(source, target.points, opts), targetSource: target.source };
}
