/**
 * Rigid 3D registration utilities (Kabsch absolute orientation + point-to-point ICP).
 *
 * Pure TypeScript with no platform-specific APIs, so it runs on both client and
 * server. All matrices are length-16 column-major arrays (three.js convention),
 * all coordinates are millimetres.
 */

export type Mat4 = number[];

export interface Point3 {
	x: number;
	y: number;
	z: number;
}

export interface IcpOptions {
	/** Maximum number of ICP iterations (default 30). */
	maxIterations?: number;
	/** Stop when the RMS changes by less than this between iterations, in mm (default 1e-4). */
	tolerance?: number;
	/** Reject correspondences farther apart than this, in mm (default 10). */
	maxPairDistance?: number;
}

export interface IcpResult {
	/** Total rigid transform mapping the ORIGINAL source coordinates onto the target. */
	transform: Mat4;
	/** RMS distance of the accepted correspondences after the final iteration (mm). */
	rms: number;
	/** Number of iterations actually performed. */
	iterations: number;
}

export function identityMat4(): Mat4 {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Apply a column-major 4x4 transform to a point (w = 1). */
export function applyMat4(m: Mat4, p: Point3): Point3 {
	return {
		x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
		y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
		z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
	};
}

/** Matrix product a·b (column-major): applying the result equals applying b, then a. */
export function composeMat4(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let s = 0;
			for (let k = 0; k < 4; k++) {
				s += a[k * 4 + row] * b[col * 4 + k];
			}
			out[col * 4 + row] = s;
		}
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* internal 3x3 helpers (flat row-major arrays, m[row * 3 + col])      */
/* ------------------------------------------------------------------ */

type Mat3 = number[];
type Vec3 = [number, number, number];

function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
	return [
		m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
		m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
		m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
	];
}

function vecDot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vecLength(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2]);
}

function vecNormalize(a: Vec3): Vec3 {
	const l = vecLength(a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
}

/** Any unit vector orthogonal to the given unit vector. */
function anyOrthogonal(u: Vec3): Vec3 {
	// Cross with the canonical axis most orthogonal to u.
	const ax = Math.abs(u[0]);
	const ay = Math.abs(u[1]);
	const az = Math.abs(u[2]);
	const axis: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
	return vecNormalize(vecCross(u, axis));
}

/** Determinant of a 3x3 given as three column vectors. */
function detColumns(c0: Vec3, c1: Vec3, c2: Vec3): number {
	return vecDot(c0, vecCross(c1, c2));
}

/**
 * Eigen-decomposition of a symmetric 3x3 matrix via cyclic Jacobi rotations.
 * Returns eigenvalues (descending) and matching orthonormal eigenvectors
 * (as column vectors).
 */
function jacobiEigenSymmetric3(a: Mat3): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
	const m = a.slice();
	// Accumulated rotation V (row-major); columns are eigenvectors.
	const v: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	const pairs: ReadonlyArray<readonly [number, number]> = [
		[0, 1],
		[0, 2],
		[1, 2]
	];

	for (let sweep = 0; sweep < 60; sweep++) {
		const off = Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[5]);
		const diag = Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8]);
		if (off <= 1e-15 * Math.max(diag, Number.MIN_VALUE)) break;

		for (const [p, q] of pairs) {
			const apq = m[p * 3 + q];
			if (Math.abs(apq) === 0) continue;
			const theta = (m[q * 3 + q] - m[p * 3 + p]) / (2 * apq);
			// Smaller-magnitude root of t^2 + 2*theta*t - 1 = 0 (Numerical Recipes).
			const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
			const c = 1 / Math.sqrt(t * t + 1);
			const s = t * c;

			// m <- Jᵀ · m · J  with J = I except J[p][p]=J[q][q]=c, J[p][q]=s, J[q][p]=-s.
			for (let k = 0; k < 3; k++) {
				const mkp = m[k * 3 + p];
				const mkq = m[k * 3 + q];
				m[k * 3 + p] = c * mkp - s * mkq;
				m[k * 3 + q] = s * mkp + c * mkq;
			}
			for (let k = 0; k < 3; k++) {
				const mpk = m[p * 3 + k];
				const mqk = m[q * 3 + k];
				m[p * 3 + k] = c * mpk - s * mqk;
				m[q * 3 + k] = s * mpk + c * mqk;
			}
			// v <- v · J
			for (let k = 0; k < 3; k++) {
				const vkp = v[k * 3 + p];
				const vkq = v[k * 3 + q];
				v[k * 3 + p] = c * vkp - s * vkq;
				v[k * 3 + q] = s * vkp + c * vkq;
			}
		}
	}

	const entries: Array<{ value: number; vector: Vec3 }> = [0, 1, 2].map((i) => ({
		value: m[i * 3 + i],
		vector: [v[i], v[3 + i], v[6 + i]] as Vec3
	}));
	entries.sort((a2, b2) => b2.value - a2.value);
	return {
		values: [entries[0].value, entries[1].value, entries[2].value],
		vectors: [entries[0].vector, entries[1].vector, entries[2].vector]
	};
}

function rigidToMat4(r: [Vec3, Vec3, Vec3] | null, t: Vec3): Mat4 {
	// r given as rows of the rotation; null means identity rotation.
	const rows: [Vec3, Vec3, Vec3] = r ?? [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1]
	];
	return [
		rows[0][0],
		rows[1][0],
		rows[2][0],
		0,
		rows[0][1],
		rows[1][1],
		rows[2][1],
		0,
		rows[0][2],
		rows[1][2],
		rows[2][2],
		0,
		t[0],
		t[1],
		t[2],
		1
	];
}

/* ------------------------------------------------------------------ */
/* Kabsch                                                              */
/* ------------------------------------------------------------------ */

/**
 * Best-fit rigid transform (rotation + translation, no scaling) mapping the
 * source points onto the target points in the least-squares sense.
 *
 * Kabsch algorithm: centre both clouds, build the 3x3 cross-covariance
 * H = Σ (sᵢ−c̄s)(tᵢ−c̄t)ᵀ, take its SVD H = U·Σ·Vᵀ (computed here from a Jacobi
 * eigen-decomposition of HᵀH), then R = V·diag(1,1,det(V·Uᵀ))·Uᵀ and
 * t = c̄t − R·c̄s. Degenerate clouds (colinear, coplanar, coincident) are
 * handled by completing the rank-deficient singular basis orthonormally.
 */
export function kabsch(source: Point3[], target: Point3[]): Mat4 {
	const n = source.length;
	if (n === 0 || n !== target.length) {
		throw new Error('kabsch: source and target must be non-empty and of equal length');
	}

	let csx = 0;
	let csy = 0;
	let csz = 0;
	let ctx = 0;
	let cty = 0;
	let ctz = 0;
	for (let i = 0; i < n; i++) {
		csx += source[i].x;
		csy += source[i].y;
		csz += source[i].z;
		ctx += target[i].x;
		cty += target[i].y;
		ctz += target[i].z;
	}
	csx /= n;
	csy /= n;
	csz /= n;
	ctx /= n;
	cty /= n;
	ctz /= n;

	// Cross-covariance H[j][k] = Σ (sᵢ−c̄s)ⱼ · (tᵢ−c̄t)ₖ
	const h: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (let i = 0; i < n; i++) {
		const sx = source[i].x - csx;
		const sy = source[i].y - csy;
		const sz = source[i].z - csz;
		const tx = target[i].x - ctx;
		const ty = target[i].y - cty;
		const tz = target[i].z - ctz;
		h[0] += sx * tx;
		h[1] += sx * ty;
		h[2] += sx * tz;
		h[3] += sy * tx;
		h[4] += sy * ty;
		h[5] += sy * tz;
		h[6] += sz * tx;
		h[7] += sz * ty;
		h[8] += sz * tz;
	}

	// HᵀH (symmetric positive semi-definite).
	const hth: Mat3 = new Array<number>(9).fill(0);
	for (let j = 0; j < 3; j++) {
		for (let k = 0; k < 3; k++) {
			let s = 0;
			for (let r = 0; r < 3; r++) {
				s += h[r * 3 + j] * h[r * 3 + k];
			}
			hth[j * 3 + k] = s;
		}
	}

	const eig = jacobiEigenSymmetric3(hth);
	const vCols = eig.vectors;
	const sigma: Vec3 = [
		Math.sqrt(Math.max(eig.values[0], 0)),
		Math.sqrt(Math.max(eig.values[1], 0)),
		Math.sqrt(Math.max(eig.values[2], 0))
	];

	// Coincident / single-point clouds carry no rotational information:
	// fall back to a pure translation between the centroids.
	if (sigma[0] <= 1e-12) {
		return rigidToMat4(null, [ctx - csx, cty - csy, ctz - csz]);
	}

	// U columns: uᵢ = H·vᵢ / σᵢ for well-conditioned singular values,
	// orthonormal completion otherwise (rank-deficient H).
	const tol = sigma[0] * 1e-6;
	const uCols: Vec3[] = [];
	for (let i = 0; i < 3; i++) {
		let u: Vec3 | null = null;
		if (sigma[i] > tol) {
			let cand = mat3MulVec(h, vCols[i]);
			// Re-orthogonalise against the columns already built (numerical safety).
			for (const prev of uCols) {
				const d = vecDot(cand, prev);
				cand = [cand[0] - d * prev[0], cand[1] - d * prev[1], cand[2] - d * prev[2]];
			}
			if (vecLength(cand) > tol) {
				u = vecNormalize(cand);
			}
		}
		if (u === null) {
			// Complete the basis: cross product of the two existing columns,
			// or any orthogonal direction if only one exists.
			if (uCols.length === 2) {
				u = vecNormalize(vecCross(uCols[0], uCols[1]));
			} else if (uCols.length === 1) {
				u = anyOrthogonal(uCols[0]);
			} else {
				u = [1, 0, 0];
			}
		}
		uCols.push(u);
	}

	// Reflection correction: d = det(V·Uᵀ) = det(V)·det(U) ∈ {+1, −1}.
	const d = detColumns(vCols[0], vCols[1], vCols[2]) * detColumns(uCols[0], uCols[1], uCols[2]) < 0 ? -1 : 1;
	const dk: Vec3 = [1, 1, d];

	// R = V·diag(1,1,d)·Uᵀ  =>  R[i][j] = Σₖ V[i][k]·dₖ·U[j][k]
	const rRows: [Vec3, Vec3, Vec3] = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0]
	];
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			let s = 0;
			for (let k = 0; k < 3; k++) {
				s += vCols[k][i] * dk[k] * uCols[k][j];
			}
			rRows[i][j] = s;
		}
	}

	const t: Vec3 = [
		ctx - (rRows[0][0] * csx + rRows[0][1] * csy + rRows[0][2] * csz),
		cty - (rRows[1][0] * csx + rRows[1][1] * csy + rRows[1][2] * csz),
		ctz - (rRows[2][0] * csx + rRows[2][1] * csy + rRows[2][2] * csz)
	];
	return rigidToMat4(rRows, t);
}

/* ------------------------------------------------------------------ */
/* ICP                                                                 */
/* ------------------------------------------------------------------ */

const ICP_MAX_SAMPLES = 2000;

function cellKey(ix: number, iy: number, iz: number): string {
	return ix + ',' + iy + ',' + iz;
}

/** Uniform spatial hash grid over a point cloud for radius-bounded NN queries. */
function buildGrid(points: Point3[], cellSize: number): Map<string, number[]> {
	const grid = new Map<string, number[]>();
	for (let i = 0; i < points.length; i++) {
		const key = cellKey(
			Math.floor(points[i].x / cellSize),
			Math.floor(points[i].y / cellSize),
			Math.floor(points[i].z / cellSize)
		);
		const bucket = grid.get(key);
		if (bucket) {
			bucket.push(i);
		} else {
			grid.set(key, [i]);
		}
	}
	return grid;
}

/**
 * Index of the nearest point within maxDist of p, or -1.
 * cellSize = maxDist / 2, so a 5x5x5 cell neighbourhood covers the search radius.
 */
function nearestInGrid(
	grid: Map<string, number[]>,
	points: Point3[],
	p: Point3,
	maxDist: number,
	cellSize: number
): number {
	const cx = Math.floor(p.x / cellSize);
	const cy = Math.floor(p.y / cellSize);
	const cz = Math.floor(p.z / cellSize);
	let bestIdx = -1;
	let bestD2 = maxDist * maxDist;
	for (let dx = -2; dx <= 2; dx++) {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dz = -2; dz <= 2; dz++) {
				const bucket = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
				if (!bucket) continue;
				for (const idx of bucket) {
					const ddx = points[idx].x - p.x;
					const ddy = points[idx].y - p.y;
					const ddz = points[idx].z - p.z;
					const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
					if (d2 <= bestD2) {
						bestD2 = d2;
						bestIdx = idx;
					}
				}
			}
		}
	}
	return bestIdx;
}

function subsample<T>(arr: T[], max: number): T[] {
	if (arr.length <= max) return arr;
	const out: T[] = [];
	const stride = arr.length / max;
	for (let i = 0; i < max; i++) {
		out.push(arr[Math.floor(i * stride)]);
	}
	return out;
}

/**
 * Point-to-point ICP refining the source cloud onto the target cloud.
 *
 * Each iteration transforms the (subsampled, ≤ 2000 points) source by the
 * current estimate, pairs every point with its nearest target neighbour via a
 * spatial hash grid, rejects pairs farther than maxPairDistance, and re-runs
 * kabsch on the ORIGINAL source coordinates of the surviving pairs — so the
 * returned transform is always the total transform to apply to the source
 * cloud as it was passed in. Stops when the pair RMS changes by less than
 * `tolerance` or after `maxIterations`.
 *
 * If no usable correspondences are ever found, returns the identity transform
 * with rms = Infinity and iterations = 0 or 1.
 */
export function icp(source: Point3[], target: Point3[], opts?: IcpOptions): IcpResult {
	const maxIterations = opts?.maxIterations ?? 30;
	const tolerance = opts?.tolerance ?? 1e-4;
	const maxPairDistance = opts?.maxPairDistance ?? 10;

	const cellSize = maxPairDistance / 2;
	const grid = buildGrid(target, cellSize);
	const sampled = subsample(source, ICP_MAX_SAMPLES);

	let transform = identityMat4();
	let rms = Infinity;
	let iterations = 0;

	const pairSource: Point3[] = [];
	const pairTarget: Point3[] = [];

	for (let iter = 0; iter < maxIterations; iter++) {
		iterations = iter + 1;
		pairSource.length = 0;
		pairTarget.length = 0;

		for (const p of sampled) {
			const tp = applyMat4(transform, p);
			const idx = nearestInGrid(grid, target, tp, maxPairDistance, cellSize);
			if (idx >= 0) {
				pairSource.push(p);
				pairTarget.push(target[idx]);
			}
		}
		if (pairSource.length < 3) break;

		// Total transform from original source coordinates onto current matches.
		transform = kabsch(pairSource, pairTarget);

		let sum = 0;
		for (let i = 0; i < pairSource.length; i++) {
			const q = applyMat4(transform, pairSource[i]);
			const dx = q.x - pairTarget[i].x;
			const dy = q.y - pairTarget[i].y;
			const dz = q.z - pairTarget[i].z;
			sum += dx * dx + dy * dy + dz * dz;
		}
		const newRms = Math.sqrt(sum / pairSource.length);
		const change = Math.abs(rms - newRms);
		rms = newRms;
		if (change < tolerance) break;
	}

	return { transform, rms, iterations };
}
