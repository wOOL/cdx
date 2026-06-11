/**
 * Marker-based dual-scan template registration.
 *
 * A radiographic template carries radiopaque fiducial markers (glass/ceramic
 * spheres or gutta-percha blobs). The template is scanned once in the
 * patient's mouth and once alone; this module detects the markers in both HU
 * volumes, finds the marker correspondence with a RANSAC over triplet
 * fingerprints, and returns the rigid transform (Kabsch) mapping the template
 * volume into the patient volume.
 *
 * Volumes are Int16 HU, x fastest then y then z; voxel center = index *
 * spacing (mm). All marker coordinates are volume-local millimetres.
 */

import { kabsch, type Mat4, type Point3 } from '$lib/registration';
import { marchingCubes } from '$lib/server/marchingCubes';

export interface VolumeGrid {
	/** HU values, x fastest, then y, then z. */
	data: Int16Array;
	/** [nx, ny, nz] voxel counts. */
	dims: [number, number, number];
	/** [sx, sy, sz] voxel size in mm. */
	spacing: [number, number, number];
}

export interface Marker {
	/** Intensity-weighted sub-voxel centroid, volume-local mm. */
	x: number;
	y: number;
	z: number;
	/** Equivalent-sphere radius from the component volume (mm). */
	radiusMM: number;
	/** Voxels above threshold in the component. */
	voxels: number;
	/** 0..1, from compactness + intensity. */
	score: number;
	kind: 'sphere' | 'blob';
}

export interface DetectMarkerOptions {
	/** Fixed detection threshold; default max(1800 HU, 99.9th percentile). */
	thresholdHU?: number;
	/** Equivalent-diameter gate, mm (defaults 1.0 / 8.0). */
	minDiameterMM?: number;
	maxDiameterMM?: number;
	/** Keep at most this many markers (best score first, default 32). */
	maxMarkers?: number;
	/** Candidate pass runs at 2x downsample above this voxel count (default 50M). */
	downsampleOver?: number;
}

export interface MarkerPair {
	/** Index into the source marker array. */
	si: number;
	/** Index into the destination marker array. */
	di: number;
	/** Distance between transformed source marker and its match (mm). */
	residualMM: number;
}

export interface MatchMarkersResult {
	/** Rigid transform mapping source marker space onto destination space. */
	transform: Mat4 | null;
	pairs: MarkerPair[];
	/** RMS of pair residuals (mm); Infinity when no pairs were found. */
	rmsMM: number;
	confidence: 'good' | 'low' | 'failed';
	reason?: string;
}

/* ------------------------------------------------------------------ */
/* detection parameters                                                 */
/* ------------------------------------------------------------------ */

const BASE_THRESHOLD_HU = 1800;
const PERCENTILE = 0.999;
const DEFAULT_MIN_DIAMETER_MM = 1.0;
const DEFAULT_MAX_DIAMETER_MM = 8.0;
const DEFAULT_MAX_MARKERS = 32;
const DEFAULT_DOWNSAMPLE_OVER = 50_000_000;
/** maxExtent/minExtent above this → streak artifact, reject. */
const MAX_ASPECT = 3.0;
/** voxels / bbox voxels below this → too sparse to be a marker. */
const MIN_COMPACTNESS = 0.2;
/** sphere classification: tight bounds. */
const SPHERE_MAX_ASPECT = 1.5;
const SPHERE_MAX_RADIAL_RATIO = 0.32;
const SPHERE_MIN_COMPACTNESS = 0.4;
/** ideal sphere-in-bbox compactness π/6, for score normalization. */
const SPHERE_COMPACTNESS = Math.PI / 6;

/* ------------------------------------------------------------------ */
/* matching parameters                                                  */
/* ------------------------------------------------------------------ */

const FINGERPRINT_TOL_MM = 0.6;
const INLIER_TOL_MM = 1.0;
const MIN_TRIPLET_ANGLE_DEG = 12;
const SYMMETRY_TOL_MM = 0.4;
const GOOD_RMS_MM = 0.5;
const MAX_RANSAC_MARKERS = 12;

/* ================================================================== */
/* marker detection                                                    */
/* ================================================================== */

/** 99.9th-percentile threshold from an evenly strided sample, floored at 1800 HU. */
function autoThreshold(data: Int16Array): number {
	const n = data.length;
	const stride = Math.max(1, Math.floor(n / (1 << 20)));
	const samples: number[] = [];
	for (let i = 0; i < n; i += stride) samples.push(data[i]);
	samples.sort((a, b) => a - b);
	const p = samples[Math.min(samples.length - 1, Math.floor(samples.length * PERCENTILE))];
	return Math.max(BASE_THRESHOLD_HU, p);
}

interface RawComponent {
	voxels: number;
	/** true when the flood exceeded maxStore (definitely too large to be a marker). */
	oversized: boolean;
	/** intensity-weighted centroid, local mm. */
	cx: number;
	cy: number;
	cz: number;
	meanHU: number;
	minI: number;
	maxI: number;
	minJ: number;
	maxJ: number;
	minK: number;
	maxK: number;
	/** distance-from-centroid statistics over component voxels (mm). */
	radialMean: number;
	radialStd: number;
}

/** 6-connected components of voxels with value > thr, with shape statistics. */
function collectComponents(
	data: Int16Array,
	dims: [number, number, number],
	spacing: [number, number, number],
	thr: number,
	maxStore: number
): RawComponent[] {
	const [nx, ny, nz] = dims;
	const [sx, sy, sz] = spacing;
	const n = nx * ny * nz;
	const nxny = nx * ny;
	const visited = new Uint8Array(n);
	const out: RawComponent[] = [];
	const stack: number[] = [];
	const stored: number[] = [];

	for (let seed = 0; seed < n; seed++) {
		if (visited[seed] !== 0 || data[seed] <= thr) continue;

		stack.length = 0;
		stored.length = 0;
		visited[seed] = 1;
		stack.push(seed);
		let voxels = 0;
		let oversized = false;
		let minI = nx;
		let maxI = -1;
		let minJ = ny;
		let maxJ = -1;
		let minK = nz;
		let maxK = -1;

		while (stack.length > 0) {
			const idx = stack.pop() as number;
			voxels++;
			if (voxels <= maxStore) stored.push(idx);
			else oversized = true;

			const i = idx % nx;
			const j = ((idx / nx) | 0) % ny;
			const k = (idx / nxny) | 0;
			if (i < minI) minI = i;
			if (i > maxI) maxI = i;
			if (j < minJ) minJ = j;
			if (j > maxJ) maxJ = j;
			if (k < minK) minK = k;
			if (k > maxK) maxK = k;

			if (i > 0 && visited[idx - 1] === 0 && data[idx - 1] > thr) {
				visited[idx - 1] = 1;
				stack.push(idx - 1);
			}
			if (i < nx - 1 && visited[idx + 1] === 0 && data[idx + 1] > thr) {
				visited[idx + 1] = 1;
				stack.push(idx + 1);
			}
			if (j > 0 && visited[idx - nx] === 0 && data[idx - nx] > thr) {
				visited[idx - nx] = 1;
				stack.push(idx - nx);
			}
			if (j < ny - 1 && visited[idx + nx] === 0 && data[idx + nx] > thr) {
				visited[idx + nx] = 1;
				stack.push(idx + nx);
			}
			if (k > 0 && visited[idx - nxny] === 0 && data[idx - nxny] > thr) {
				visited[idx - nxny] = 1;
				stack.push(idx - nxny);
			}
			if (k < nz - 1 && visited[idx + nxny] === 0 && data[idx + nxny] > thr) {
				visited[idx + nxny] = 1;
				stack.push(idx + nxny);
			}
		}

		if (oversized) {
			out.push({
				voxels,
				oversized: true,
				cx: 0,
				cy: 0,
				cz: 0,
				meanHU: 0,
				minI,
				maxI,
				minJ,
				maxJ,
				minK,
				maxK,
				radialMean: 0,
				radialStd: 0
			});
			continue;
		}

		// Intensity-weighted centroid: weight = HU above threshold, so
		// partial-volume boundary voxels pull less → sub-voxel accuracy.
		let wsum = 0;
		let wx = 0;
		let wy = 0;
		let wz = 0;
		let huSum = 0;
		for (const idx of stored) {
			const i = idx % nx;
			const j = ((idx / nx) | 0) % ny;
			const k = (idx / nxny) | 0;
			const w = data[idx] - thr;
			wsum += w;
			wx += w * i;
			wy += w * j;
			wz += w * k;
			huSum += data[idx];
		}
		const cx = (wx / wsum) * sx;
		const cy = (wy / wsum) * sy;
		const cz = (wz / wsum) * sz;

		let rSum = 0;
		let r2Sum = 0;
		for (const idx of stored) {
			const i = idx % nx;
			const j = ((idx / nx) | 0) % ny;
			const k = (idx / nxny) | 0;
			const dx = i * sx - cx;
			const dy = j * sy - cy;
			const dz = k * sz - cz;
			const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
			rSum += r;
			r2Sum += r * r;
		}
		const radialMean = rSum / voxels;
		const radialStd = Math.sqrt(Math.max(0, r2Sum / voxels - radialMean * radialMean));

		out.push({
			voxels,
			oversized: false,
			cx,
			cy,
			cz,
			meanHU: huSum / voxels,
			minI,
			maxI,
			minJ,
			maxJ,
			minK,
			maxK,
			radialMean,
			radialStd
		});
	}
	return out;
}

function equivalentDiameter(voxels: number, voxVol: number): number {
	return 2 * Math.cbrt((3 * voxels * voxVol) / (4 * Math.PI));
}

/** Full shape gate; returns a Marker or null when the component is rejected. */
function gradeComponent(
	c: RawComponent,
	spacing: [number, number, number],
	thr: number,
	minD: number,
	maxD: number
): Marker | null {
	if (c.oversized) return null;
	const [sx, sy, sz] = spacing;
	const dEq = equivalentDiameter(c.voxels, sx * sy * sz);
	if (dEq < minD || dEq > maxD) return null;

	const di = c.maxI - c.minI + 1;
	const dj = c.maxJ - c.minJ + 1;
	const dk = c.maxK - c.minK + 1;
	const ex = di * sx;
	const ey = dj * sy;
	const ez = dk * sz;
	const maxExt = Math.max(ex, ey, ez);
	const minExt = Math.min(ex, ey, ez);
	const aspect = maxExt / Math.max(minExt, 1e-6);
	if (aspect > MAX_ASPECT) return null; // streak artifacts are long and thin

	const compactness = c.voxels / (di * dj * dk);
	if (compactness < MIN_COMPACTNESS) return null;

	const radialRatio = c.radialMean > 1e-6 ? c.radialStd / c.radialMean : 0;
	const kind: Marker['kind'] =
		aspect <= SPHERE_MAX_ASPECT &&
		radialRatio <= SPHERE_MAX_RADIAL_RATIO &&
		compactness >= SPHERE_MIN_COMPACTNESS
			? 'sphere'
			: 'blob';

	const score =
		0.6 * Math.min(1, compactness / SPHERE_COMPACTNESS) +
		0.4 * Math.min(1, Math.max(0, (c.meanHU - thr) / 1200));

	return { x: c.cx, y: c.cy, z: c.cz, radiusMM: dEq / 2, voxels: c.voxels, score, kind };
}

/** Loose candidate gate used on the 2x-downsampled pre-scan only. */
function passesLooseGate(
	c: RawComponent,
	spacing: [number, number, number],
	minD: number,
	maxD: number
): boolean {
	if (c.oversized) return false;
	const [sx, sy, sz] = spacing;
	const dEq = equivalentDiameter(c.voxels, sx * sy * sz);
	if (dEq < minD * 0.5 || dEq > maxD * 1.6 + 2 * Math.max(sx, sy, sz)) return false;
	const ex = (c.maxI - c.minI + 1) * sx;
	const ey = (c.maxJ - c.minJ + 1) * sy;
	const ez = (c.maxK - c.minK + 1) * sz;
	const aspect = Math.max(ex, ey, ez) / Math.max(Math.min(ex, ey, ez), 1e-6);
	return aspect <= MAX_ASPECT * 1.5;
}

/** 2x max-pooled copy of the volume (max preserves small bright markers). */
function downsampleMax(vol: VolumeGrid): VolumeGrid {
	const [nx, ny, nz] = vol.dims;
	const hx = Math.ceil(nx / 2);
	const hy = Math.ceil(ny / 2);
	const hz = Math.ceil(nz / 2);
	const out = new Int16Array(hx * hy * hz);
	const src = vol.data;
	const nxny = nx * ny;
	for (let k2 = 0; k2 < hz; k2++) {
		const k0 = k2 * 2;
		const k1 = Math.min(nz - 1, k0 + 1);
		for (let j2 = 0; j2 < hy; j2++) {
			const j0 = j2 * 2;
			const j1 = Math.min(ny - 1, j0 + 1);
			for (let i2 = 0; i2 < hx; i2++) {
				const i0 = i2 * 2;
				const i1 = Math.min(nx - 1, i0 + 1);
				let m = src[k0 * nxny + j0 * nx + i0];
				let v = src[k0 * nxny + j0 * nx + i1];
				if (v > m) m = v;
				v = src[k0 * nxny + j1 * nx + i0];
				if (v > m) m = v;
				v = src[k0 * nxny + j1 * nx + i1];
				if (v > m) m = v;
				v = src[k1 * nxny + j0 * nx + i0];
				if (v > m) m = v;
				v = src[k1 * nxny + j0 * nx + i1];
				if (v > m) m = v;
				v = src[k1 * nxny + j1 * nx + i0];
				if (v > m) m = v;
				v = src[k1 * nxny + j1 * nx + i1];
				if (v > m) m = v;
				out[k2 * hx * hy + j2 * hx + i2] = m;
			}
		}
	}
	return {
		data: out,
		dims: [hx, hy, hz],
		spacing: [vol.spacing[0] * 2, vol.spacing[1] * 2, vol.spacing[2] * 2]
	};
}

/** Re-detect a downsampled candidate at full resolution in a local window. */
function refineCandidate(
	vol: VolumeGrid,
	thr: number,
	cand: RawComponent,
	candSpacing: [number, number, number],
	minD: number,
	maxD: number,
	maxStore: number
): Marker | null {
	const [nx, ny, nz] = vol.dims;
	const [sx, sy, sz] = vol.spacing;
	const dEq = equivalentDiameter(
		cand.voxels,
		candSpacing[0] * candSpacing[1] * candSpacing[2]
	);
	const halfMM = dEq / 2 + 2;
	const i0 = Math.max(0, Math.floor((cand.cx - halfMM) / sx));
	const i1 = Math.min(nx - 1, Math.ceil((cand.cx + halfMM) / sx));
	const j0 = Math.max(0, Math.floor((cand.cy - halfMM) / sy));
	const j1 = Math.min(ny - 1, Math.ceil((cand.cy + halfMM) / sy));
	const k0 = Math.max(0, Math.floor((cand.cz - halfMM) / sz));
	const k1 = Math.min(nz - 1, Math.ceil((cand.cz + halfMM) / sz));
	const wx = i1 - i0 + 1;
	const wy = j1 - j0 + 1;
	const wz = k1 - k0 + 1;
	if (wx < 2 || wy < 2 || wz < 2) return null;

	const sub = new Int16Array(wx * wy * wz);
	const nxny = nx * ny;
	for (let k = 0; k < wz; k++) {
		for (let j = 0; j < wy; j++) {
			const srcOff = (k + k0) * nxny + (j + j0) * nx + i0;
			sub.set(vol.data.subarray(srcOff, srcOff + wx), k * wx * wy + j * wx);
		}
	}

	const comps = collectComponents(sub, [wx, wy, wz], [sx, sy, sz], thr, maxStore);
	let best: Marker | null = null;
	let bestDist = dEq / 2 + 2 * Math.max(sx, sy, sz);
	for (const c of comps) {
		const m = gradeComponent(c, [sx, sy, sz], thr, minD, maxD);
		if (!m) continue;
		// shift from window-local back to volume-local mm
		m.x += i0 * sx;
		m.y += j0 * sy;
		m.z += k0 * sz;
		const d = Math.hypot(m.x - cand.cx, m.y - cand.cy, m.z - cand.cz);
		if (d < bestDist) {
			bestDist = d;
			best = m;
		}
	}
	return best;
}

/** Drop markers closer than distMM to a better-scored one (downsample dedupe). */
function dedupeMarkers(markers: Marker[], distMM: number): Marker[] {
	const sorted = [...markers].sort((a, b) => b.score - a.score);
	const kept: Marker[] = [];
	for (const m of sorted) {
		if (kept.every((k) => Math.hypot(k.x - m.x, k.y - m.y, k.z - m.z) >= distMM)) {
			kept.push(m);
		}
	}
	return kept;
}

/**
 * Detect radiopaque fiducial markers in an HU volume.
 *
 * Threshold at max(1800 HU, 99.9th percentile) — markers are far denser than
 * bone — then 6-connected components, gated by equivalent diameter
 * (1.0–8.0 mm), bbox aspect ratio (streak rejection), compactness and radial
 * std/mean (sphere vs blob classification). Volumes above ~50M voxels are
 * pre-scanned at 2x downsample and each candidate is refined at full
 * resolution in a local window.
 */
export function detectMarkers(vol: VolumeGrid, opts: DetectMarkerOptions = {}): Marker[] {
	const minD = opts.minDiameterMM ?? DEFAULT_MIN_DIAMETER_MM;
	const maxD = opts.maxDiameterMM ?? DEFAULT_MAX_DIAMETER_MM;
	const maxMarkers = opts.maxMarkers ?? DEFAULT_MAX_MARKERS;
	const downsampleOver = opts.downsampleOver ?? DEFAULT_DOWNSAMPLE_OVER;
	const thr = opts.thresholdHU ?? autoThreshold(vol.data);

	const [sx, sy, sz] = vol.spacing;
	const voxVol = sx * sy * sz;
	const maxStore = Math.ceil(((Math.PI / 6) * maxD * maxD * maxD * 3) / voxVol) + 1024;
	const nVox = vol.dims[0] * vol.dims[1] * vol.dims[2];

	let markers: Marker[] = [];
	if (nVox > downsampleOver) {
		const half = downsampleMax(vol);
		const halfStore = Math.ceil(maxStore / 8) + 1024;
		const cands = collectComponents(half.data, half.dims, half.spacing, thr, halfStore);
		for (const c of cands) {
			if (!passesLooseGate(c, half.spacing, minD, maxD)) continue;
			const m = refineCandidate(vol, thr, c, half.spacing, minD, maxD, maxStore);
			if (m) markers.push(m);
		}
		markers = dedupeMarkers(markers, Math.max(0.5, minD / 2));
	} else {
		const comps = collectComponents(vol.data, vol.dims, vol.spacing, thr, maxStore);
		for (const c of comps) {
			const m = gradeComponent(c, vol.spacing, thr, minD, maxD);
			if (m) markers.push(m);
		}
	}

	markers.sort((a, b) => b.score - a.score);
	return markers.slice(0, maxMarkers);
}

/* ================================================================== */
/* marker matching (RANSAC over triplet fingerprints)                  */
/* ================================================================== */

interface Triplet {
	a: number;
	b: number;
	c: number;
	dab: number;
	dac: number;
	dbc: number;
	/** near-collinear or near-symmetric: usable but demoted. */
	degenerate: boolean;
}

function pointDist(p: Point3, q: Point3): number {
	return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

/** Min internal angle of a triangle from its side lengths (degrees). */
function minTriangleAngleDeg(dab: number, dac: number, dbc: number): number {
	const angle = (opp: number, s1: number, s2: number): number => {
		const denom = 2 * s1 * s2;
		if (denom < 1e-9) return 0;
		const c = Math.max(-1, Math.min(1, (s1 * s1 + s2 * s2 - opp * opp) / denom));
		return (Math.acos(c) * 180) / Math.PI;
	};
	return Math.min(angle(dbc, dab, dac), angle(dac, dab, dbc), angle(dab, dac, dbc));
}

function buildTriplets(pts: Point3[]): Triplet[] {
	const n = pts.length;
	const out: Triplet[] = [];
	for (let a = 0; a < n; a++) {
		for (let b = a + 1; b < n; b++) {
			const dab = pointDist(pts[a], pts[b]);
			for (let c = b + 1; c < n; c++) {
				const dac = pointDist(pts[a], pts[c]);
				const dbc = pointDist(pts[b], pts[c]);
				const degenerate =
					minTriangleAngleDeg(dab, dac, dbc) < MIN_TRIPLET_ANGLE_DEG ||
					Math.abs(dab - dac) < SYMMETRY_TOL_MM ||
					Math.abs(dab - dbc) < SYMMETRY_TOL_MM ||
					Math.abs(dac - dbc) < SYMMETRY_TOL_MM;
				out.push({ a, b, c, dab, dac, dbc, degenerate });
			}
		}
	}
	return out;
}

function transformPoint(m: Mat4, p: Point3): Point3 {
	return {
		x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
		y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
		z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
	};
}

/** Greedy one-to-one pairing of transformed source markers to destination markers. */
function greedyInliers(src: Point3[], dst: Point3[], transform: Mat4): MarkerPair[] {
	const cands: MarkerPair[] = [];
	for (let si = 0; si < src.length; si++) {
		const t = transformPoint(transform, src[si]);
		for (let di = 0; di < dst.length; di++) {
			const d = pointDist(t, dst[di]);
			if (d <= INLIER_TOL_MM) cands.push({ si, di, residualMM: d });
		}
	}
	cands.sort((a, b) => a.residualMM - b.residualMM);
	const usedS = new Set<number>();
	const usedD = new Set<number>();
	const pairs: MarkerPair[] = [];
	for (const c of cands) {
		if (usedS.has(c.si) || usedD.has(c.di)) continue;
		usedS.add(c.si);
		usedD.add(c.di);
		pairs.push(c);
	}
	return pairs;
}

/**
 * Find the rigid transform mapping source markers onto destination markers.
 *
 * RANSAC over triplet correspondences: src/dst triplets compatible by
 * pairwise-distance fingerprint (0.6 mm tolerance) seed a Kabsch fit, inliers
 * (< 1.0 mm after transform) are counted, and the best model is refit with
 * Kabsch on all of its inliers. Triplets with min internal angle < 12° or two
 * pairwise distances within 0.4 mm are demoted (only trusted as 'low').
 * Ambiguous results (a second solution with the same inlier count but a
 * different correspondence) are also reported as 'low'.
 */
export function matchMarkers(src: Marker[], dst: Marker[]): MatchMarkersResult {
	if (src.length < 3 || dst.length < 3) {
		return {
			transform: null,
			pairs: [],
			rmsMM: Infinity,
			confidence: 'failed',
			reason: `fewer than 3 markers on one side (source ${src.length}, destination ${dst.length})`
		};
	}

	// Cap RANSAC input at the best-scored markers; pair indices stay original.
	const srcIdx = src
		.map((m, i) => ({ i, score: m.score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_RANSAC_MARKERS)
		.map((e) => e.i);
	const dstIdx = dst
		.map((m, i) => ({ i, score: m.score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_RANSAC_MARKERS)
		.map((e) => e.i);
	const srcPts: Point3[] = srcIdx.map((i) => ({ x: src[i].x, y: src[i].y, z: src[i].z }));
	const dstPts: Point3[] = dstIdx.map((i) => ({ x: dst[i].x, y: dst[i].y, z: dst[i].z }));

	const srcTriplets = buildTriplets(srcPts);
	const dstTriplets = buildTriplets(dstPts);

	interface Candidate {
		pairs: MarkerPair[]; // local indices
		count: number;
		degenerate: boolean;
	}
	const candidates = new Map<string, Candidate>();

	for (const st of srcTriplets) {
		const sa = srcPts[st.a];
		const sb = srcPts[st.b];
		const sc = srcPts[st.c];
		for (const dt of dstTriplets) {
			// All 6 correspondences of the destination triplet.
			const perms: [number, number, number][] = [
				[dt.a, dt.b, dt.c],
				[dt.a, dt.c, dt.b],
				[dt.b, dt.a, dt.c],
				[dt.b, dt.c, dt.a],
				[dt.c, dt.a, dt.b],
				[dt.c, dt.b, dt.a]
			];
			for (const [pa, pb, pc] of perms) {
				const da = dstPts[pa];
				const dbp = dstPts[pb];
				const dc = dstPts[pc];
				if (Math.abs(pointDist(da, dbp) - st.dab) > FINGERPRINT_TOL_MM) continue;
				if (Math.abs(pointDist(da, dc) - st.dac) > FINGERPRINT_TOL_MM) continue;
				if (Math.abs(pointDist(dbp, dc) - st.dbc) > FINGERPRINT_TOL_MM) continue;

				const seed = kabsch([sa, sb, sc], [da, dbp, dc]);
				const inliers = greedyInliers(srcPts, dstPts, seed);
				if (inliers.length < 3) continue;

				const key = inliers
					.map((p) => `${p.si}:${p.di}`)
					.sort()
					.join(',');
				const degenerate = st.degenerate || dt.degenerate;
				const existing = candidates.get(key);
				if (existing) {
					// trusted as soon as any non-degenerate triplet produced it
					existing.degenerate = existing.degenerate && degenerate;
				} else {
					candidates.set(key, { pairs: inliers, count: inliers.length, degenerate });
				}
			}
		}
	}

	if (candidates.size === 0) {
		return {
			transform: null,
			pairs: [],
			rmsMM: Infinity,
			confidence: 'failed',
			reason: 'no geometrically consistent marker correspondence found'
		};
	}

	// Refit every distinct correspondence on all of its inliers.
	interface Refit extends Candidate {
		transform: Mat4;
		rms: number;
	}
	const refits: Refit[] = [];
	for (const cand of candidates.values()) {
		const s = cand.pairs.map((p) => srcPts[p.si]);
		const d = cand.pairs.map((p) => dstPts[p.di]);
		const transform = kabsch(s, d);
		let sum = 0;
		const pairs = cand.pairs.map((p) => {
			const r = pointDist(transformPoint(transform, srcPts[p.si]), dstPts[p.di]);
			sum += r * r;
			return { si: p.si, di: p.di, residualMM: r };
		});
		refits.push({
			pairs,
			count: cand.count,
			degenerate: cand.degenerate,
			transform,
			rms: Math.sqrt(sum / pairs.length)
		});
	}
	refits.sort((a, b) => {
		if (a.count !== b.count) return b.count - a.count;
		if (a.degenerate !== b.degenerate) return a.degenerate ? 1 : -1;
		return a.rms - b.rms;
	});

	const best = refits[0];
	const ambiguous = refits.some((r) => r !== best && r.count === best.count);

	// map local indices back to the original marker arrays
	const pairs = best.pairs
		.map((p) => ({ si: srcIdx[p.si], di: dstIdx[p.di], residualMM: p.residualMM }))
		.sort((a, b) => a.si - b.si);

	let confidence: MatchMarkersResult['confidence'] = 'good';
	let reason: string | undefined;
	if (ambiguous) {
		confidence = 'low';
		reason = 'ambiguous correspondence: a second solution has the same inlier count';
	} else if (best.degenerate) {
		confidence = 'low';
		reason = 'marker constellation is degenerate (near-collinear or near-symmetric)';
	} else if (best.rms > GOOD_RMS_MM) {
		confidence = 'low';
		reason = `residual RMS ${best.rms.toFixed(2)} mm exceeds ${GOOD_RMS_MM} mm`;
	}

	return { transform: best.transform, pairs, rmsMM: best.rms, confidence, reason };
}

/* ================================================================== */
/* template surface extraction                                         */
/* ================================================================== */

/**
 * Triangle soup of the template body: marching cubes at thresholdHU
 * (default -300, acrylic vs air), keeping only the largest connected
 * triangle component (vertices shared within 1 µm connect triangles).
 */
export function extractTemplateSurface(vol: VolumeGrid, thresholdHU = -300): Float32Array {
	const { positions } = marchingCubes(vol.data, vol.dims, vol.spacing, thresholdHU, 1);
	const triCount = (positions.length / 9) | 0;
	if (triCount <= 1) return positions;

	// Union-find over triangles, joined through shared (quantized) vertices.
	const parent = new Int32Array(triCount);
	for (let i = 0; i < triCount; i++) parent[i] = i;
	const find = (t: number): number => {
		let r = t;
		while (parent[r] !== r) {
			parent[r] = parent[parent[r]];
			r = parent[r];
		}
		return r;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[rb] = ra;
	};

	const vmap = new Map<string, number>();
	for (let t = 0; t < triCount; t++) {
		for (let v = 0; v < 3; v++) {
			const o = t * 9 + v * 3;
			const key = `${Math.round(positions[o] * 1000)},${Math.round(positions[o + 1] * 1000)},${Math.round(positions[o + 2] * 1000)}`;
			const owner = vmap.get(key);
			if (owner === undefined) vmap.set(key, t);
			else union(owner, t);
		}
	}

	const counts = new Map<number, number>();
	let bestRoot = -1;
	let bestCount = 0;
	for (let t = 0; t < triCount; t++) {
		const r = find(t);
		const c = (counts.get(r) ?? 0) + 1;
		counts.set(r, c);
		if (c > bestCount) {
			bestCount = c;
			bestRoot = r;
		}
	}
	if (bestCount === triCount) return positions;

	const out = new Float32Array(bestCount * 9);
	let off = 0;
	for (let t = 0; t < triCount; t++) {
		if (find(t) !== bestRoot) continue;
		out.set(positions.subarray(t * 9, t * 9 + 9), off);
		off += 9;
	}
	return out;
}
