/**
 * Shared pure helpers for the AI-assistant review wizard (client + server +
 * tests — no DOM, no Bun, no $lib/server imports):
 *
 *  - classifyAiModel: AI model row (name + params) → review-object info for
 *    the FDI tooth chart and the non-tooth toggle row,
 *  - FDI_UPPER / FDI_LOWER: chart order of the desktop dialog
 *    (upper 18 → 28, lower 48 → 38),
 *  - canalCenterline: ordered centerline polyline of an inferior-alveolar-
 *    canal surface mesh (the wizard's editable nerve-canal proposal),
 *  - validateReviewApply: validation/normalisation of the wizard's
 *    POST /api/datasets/[id]/ai-review apply payload,
 *  - rotationMatrix / rotateAboutCenter: the exact rotation convention of
 *    /api/datasets/[id]/align (row-major 3×3, Rz·Ry·Rx), so the wizard can
 *    co-rotate its unsaved overlay geometry when the user applies the PCS.
 */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export type AiObjectKind = 'tooth' | 'jaw' | 'canal' | 'sinus' | 'soft' | 'other';

export interface AiObjectInfo {
	kind: AiObjectKind;
	/** FDI tooth number (11–48) for kind 'tooth', else null. */
	fdi: number | null;
	/** Patient side for canals/sinuses, else null. */
	side: 'left' | 'right' | null;
	/** Jaw arch for jaws and teeth, else null. */
	arch: 'upper' | 'lower' | null;
	/** Short human label for chart/toggle rows. */
	label: string;
}

/** FDI chart rows in desktop-dialog order: upper 18 → 28, lower 48 → 38. */
export const FDI_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const FDI_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const QUADRANTS: [RegExp, number][] = [
	[/upper right/i, 1],
	[/upper left/i, 2],
	[/lower left/i, 3],
	[/lower right/i, 4]
];
const POSITIONS: [RegExp, number][] = [
	[/central incisor/i, 1],
	[/lateral incisor/i, 2],
	[/canine/i, 3],
	[/first premolar/i, 4],
	[/second premolar/i, 5],
	[/first molar/i, 6],
	[/second molar/i, 7],
	[/third molar/i, 8]
];

/** FDI number from a vendor class name ("Upper Left Canine" → 23), else null. */
export function fdiFromClassName(name: string): number | null {
	let quadrant = 0;
	for (const [re, q] of QUADRANTS) {
		if (re.test(name)) {
			quadrant = q;
			break;
		}
	}
	if (!quadrant) return null;
	for (const [re, pos] of POSITIONS) {
		if (re.test(name)) return quadrant * 10 + pos;
	}
	return null;
}

function isValidFdi(n: number): boolean {
	const q = Math.floor(n / 10);
	const p = n % 10;
	return q >= 1 && q <= 4 && p >= 1 && p <= 8;
}

function archOfFdi(fdi: number): 'upper' | 'lower' {
	return fdi < 30 ? 'upper' : 'lower';
}

/**
 * Classify an AI model row for the review wizard. Accepts both backends'
 * naming ($lib/server/aiSeg.ts): vendor rows ("AI — Tooth 23",
 * "AI — L inferior alveolar canal", params {class, fdi}) and heuristic rows
 * ("AI — Bone", "AI — Mandible", params {class}).
 */
export function classifyAiModel(
	name: string,
	params?: { class?: string; fdi?: number } | null
): AiObjectInfo {
	const cls = params?.class ?? '';
	const hay = `${cls} ${name}`;

	// --- tooth ---
	let fdi: number | null = null;
	if (params?.fdi != null && isValidFdi(Number(params.fdi))) fdi = Number(params.fdi);
	if (fdi == null) {
		const m = /tooth\s*\(?\s*(\d{2})\s*\)?/i.exec(name);
		if (m && isValidFdi(Number(m[1]))) fdi = Number(m[1]);
	}
	if (fdi == null) fdi = fdiFromClassName(hay);
	if (fdi != null) {
		return { kind: 'tooth', fdi, side: null, arch: archOfFdi(fdi), label: String(fdi) };
	}

	const side: 'left' | 'right' | null = /\bleft\b|—\s*L\s|\bL\s+inferior/i.test(hay)
		? 'left'
		: /\bright\b|—\s*R\s|\bR\s+inferior/i.test(hay)
			? 'right'
			: null;

	// --- canal (check before jaw: "inferior alveolar canal" rows) ---
	if (/inferior alveolar canal|nerve canal/i.test(hay)) {
		return {
			kind: 'canal',
			fdi: null,
			side,
			arch: 'lower',
			label: side === 'left' ? 'Left nerve canal' : side === 'right' ? 'Right nerve canal' : 'Nerve canal'
		};
	}

	// --- sinus (check before jaw: "Left Maxillary Sinus" contains "maxilla") ---
	if (/sinus/i.test(hay)) {
		return {
			kind: 'sinus',
			fdi: null,
			side,
			arch: 'upper',
			label: side === 'left' ? 'Left sinus' : side === 'right' ? 'Right sinus' : 'Sinus'
		};
	}

	// --- jaw ---
	if (/mandible|lower jawbone/i.test(hay)) {
		return { kind: 'jaw', fdi: null, side: null, arch: 'lower', label: 'Mandible' };
	}
	if (/maxilla|upper jawbone/i.test(hay)) {
		return { kind: 'jaw', fdi: null, side: null, arch: 'upper', label: 'Maxilla' };
	}

	// --- soft tissue ---
	if (/soft/i.test(hay)) {
		return { kind: 'soft', fdi: null, side: null, arch: null, label: 'Soft tissue' };
	}

	// --- everything else (Bone, Teeth, Pharynx, Crown, Bridge, Implant, …) ---
	const label = name.replace(/^AI\s*[—–-]\s*/, '').trim() || name;
	return { kind: 'other', fdi: null, side: null, arch: null, label };
}

// ---------------------------------------------------------------------------
// Canal centerline from a surface mesh
// ---------------------------------------------------------------------------

/**
 * Ordered centerline polyline of a tubular canal mesh (triangle soup,
 * volume-local mm after `transform`, column-major 4×4 or null).
 *
 * PCA principal axis → bin vertices along the axis → per-bin centroids.
 * Returns null for degenerate meshes (< 4 usable bins or < 4 mm extent).
 */
export function canalCenterline(
	positions: Float32Array | number[],
	transform: number[] | null = null,
	maxPoints = 12
): Vec3[] | null {
	const n = Math.floor(positions.length / 3);
	if (n < 12) return null;
	const stride = Math.max(1, Math.floor(n / 20000));
	const t = transform && transform.length === 16 ? transform : null;

	// transformed sample points
	const px: number[] = [];
	const py: number[] = [];
	const pz: number[] = [];
	for (let i = 0; i < n; i += stride) {
		const x = positions[i * 3];
		const y = positions[i * 3 + 1];
		const z = positions[i * 3 + 2];
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
		if (t) {
			px.push(t[0] * x + t[4] * y + t[8] * z + t[12]);
			py.push(t[1] * x + t[5] * y + t[9] * z + t[13]);
			pz.push(t[2] * x + t[6] * y + t[10] * z + t[14]);
		} else {
			px.push(x);
			py.push(y);
			pz.push(z);
		}
	}
	const m = px.length;
	if (m < 12) return null;

	let mx = 0;
	let my = 0;
	let mz = 0;
	for (let i = 0; i < m; i++) {
		mx += px[i];
		my += py[i];
		mz += pz[i];
	}
	mx /= m;
	my /= m;
	mz /= m;

	// covariance (symmetric 3×3)
	let cxx = 0;
	let cxy = 0;
	let cxz = 0;
	let cyy = 0;
	let cyz = 0;
	let czz = 0;
	for (let i = 0; i < m; i++) {
		const dx = px[i] - mx;
		const dy = py[i] - my;
		const dz = pz[i] - mz;
		cxx += dx * dx;
		cxy += dx * dy;
		cxz += dx * dz;
		cyy += dy * dy;
		cyz += dy * dz;
		czz += dz * dz;
	}

	// principal axis via power iteration
	let ax = 1;
	let ay = 0.123;
	let az = 0.456;
	for (let it = 0; it < 64; it++) {
		const nx2 = cxx * ax + cxy * ay + cxz * az;
		const ny2 = cxy * ax + cyy * ay + cyz * az;
		const nz2 = cxz * ax + cyz * ay + czz * az;
		const len = Math.hypot(nx2, ny2, nz2);
		if (len < 1e-12) return null;
		ax = nx2 / len;
		ay = ny2 / len;
		az = nz2 / len;
	}

	// projections along the axis
	const ts = new Float64Array(m);
	let tMin = Infinity;
	let tMax = -Infinity;
	for (let i = 0; i < m; i++) {
		const v = (px[i] - mx) * ax + (py[i] - my) * ay + (pz[i] - mz) * az;
		ts[i] = v;
		if (v < tMin) tMin = v;
		if (v > tMax) tMax = v;
	}
	if (tMax - tMin < 4) return null; // not a canal-sized tube

	const bins = Math.max(4, Math.min(25, maxPoints));
	const acc = new Float64Array(bins * 4); // x, y, z, count
	const span = tMax - tMin;
	for (let i = 0; i < m; i++) {
		let b = Math.floor(((ts[i] - tMin) / span) * bins);
		if (b >= bins) b = bins - 1;
		acc[b * 4] += px[i];
		acc[b * 4 + 1] += py[i];
		acc[b * 4 + 2] += pz[i];
		acc[b * 4 + 3]++;
	}

	const out: Vec3[] = [];
	for (let b = 0; b < bins; b++) {
		const c = acc[b * 4 + 3];
		if (c < 3) continue;
		out.push({
			x: Math.round((acc[b * 4] / c) * 100) / 100,
			y: Math.round((acc[b * 4 + 1] / c) * 100) / 100,
			z: Math.round((acc[b * 4 + 2] / c) * 100) / 100
		});
	}
	return out.length >= 4 ? out : null;
}

// ---------------------------------------------------------------------------
// Apply-payload validation (POST /api/datasets/[id]/ai-review)
// ---------------------------------------------------------------------------

export interface AiReviewApplyPayload {
	planId?: number;
	/** Panoramic curve: control points in volume-local mm + axial slice index. */
	pano?: { control: { x: number; y: number }[]; z: number };
	/** Reviewed nerve canals, volume-local mm points. */
	nerves?: Partial<Record<'right' | 'left', { points: Vec3[]; diameter?: number }>>;
}

function finite(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

export function validateReviewApply(
	body: unknown
): { ok: true; value: AiReviewApplyPayload } | { ok: false; error: string } {
	if (!body || typeof body !== 'object') return { ok: false, error: 'JSON body required' };
	const b = body as Record<string, unknown>;
	const value: AiReviewApplyPayload = {};

	if (b.planId !== undefined) {
		if (!finite(b.planId) || b.planId <= 0 || !Number.isInteger(b.planId)) {
			return { ok: false, error: 'planId must be a positive integer' };
		}
		value.planId = b.planId;
	}

	if (b.pano !== undefined && b.pano !== null) {
		const p = b.pano as Record<string, unknown>;
		const control = p.control as unknown;
		if (!Array.isArray(control) || control.length < 2) {
			return { ok: false, error: 'pano.control needs at least 2 points' };
		}
		const pts: { x: number; y: number }[] = [];
		for (const c of control) {
			const q = c as Record<string, unknown>;
			if (!q || !finite(q.x) || !finite(q.y)) {
				return { ok: false, error: 'pano.control points must have finite x/y' };
			}
			pts.push({ x: q.x, y: q.y });
		}
		if (!finite(p.z) || p.z < 0) return { ok: false, error: 'pano.z must be a slice index ≥ 0' };
		value.pano = { control: pts, z: Math.round(p.z) };
	}

	if (b.nerves !== undefined && b.nerves !== null) {
		const nv = b.nerves as Record<string, unknown>;
		const out: AiReviewApplyPayload['nerves'] = {};
		for (const key of Object.keys(nv)) {
			if (key !== 'right' && key !== 'left') {
				return { ok: false, error: `nerves keys must be 'right'/'left' (got '${key}')` };
			}
			const side = nv[key] as Record<string, unknown>;
			const points = side?.points as unknown;
			if (!Array.isArray(points) || points.length < 2) {
				return { ok: false, error: `nerves.${key}.points needs at least 2 points` };
			}
			const pts: Vec3[] = [];
			for (const c of points) {
				const q = c as Record<string, unknown>;
				if (!q || !finite(q.x) || !finite(q.y) || !finite(q.z)) {
					return { ok: false, error: `nerves.${key} points must have finite x/y/z` };
				}
				pts.push({ x: q.x, y: q.y, z: q.z });
			}
			let diameter = 2.0;
			if (side.diameter !== undefined) {
				if (!finite(side.diameter) || side.diameter < 0.5 || side.diameter > 10) {
					return { ok: false, error: `nerves.${key}.diameter must be 0.5–10 mm` };
				}
				diameter = side.diameter;
			}
			out[key] = { points: pts, diameter };
		}
		if (Object.keys(out).length > 0) value.nerves = out;
	}

	if (!value.pano && !value.nerves) {
		return { ok: false, error: 'nothing to apply: provide pano and/or nerves' };
	}
	return { ok: true, value };
}

// ---------------------------------------------------------------------------
// /align rotation convention (mirror of $lib/server/resample.ts)
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

/** Row-major 3×3 rotation, Rz(yaw)·Ry(pitch)·Rx(roll) — identical to resample.ts. */
export function rotationMatrix(yaw: number, pitch: number, roll: number): number[] {
	const cosY = Math.cos(yaw * DEG);
	const sinY = Math.sin(yaw * DEG);
	const cosP = Math.cos(pitch * DEG);
	const sinP = Math.sin(pitch * DEG);
	const cosR = Math.cos(roll * DEG);
	const sinR = Math.sin(roll * DEG);
	return [
		cosY * cosP, cosY * sinP * sinR - sinY * cosR, cosY * sinP * cosR + sinY * sinR,
		sinY * cosP, sinY * sinP * sinR + cosY * cosR, sinY * sinP * cosR - cosY * sinR,
		-sinP, cosP * sinR, cosP * cosR
	];
}

/** p' = c + R·(p − c), the per-point transform /align applies to planned objects. */
export function rotateAboutCenter(R: number[], c: Vec3, p: Vec3): Vec3 {
	const dx = p.x - c.x;
	const dy = p.y - c.y;
	const dz = p.z - c.z;
	return {
		x: c.x + R[0] * dx + R[1] * dy + R[2] * dz,
		y: c.y + R[3] * dx + R[4] * dy + R[5] * dz,
		z: c.z + R[6] * dx + R[7] * dy + R[8] * dz
	};
}

/** Transpose of a row-major 3×3 (= inverse for rotations). */
export function transpose3(R: number[]): number[] {
	return [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
}
