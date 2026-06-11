/** Catmull-Rom spline utilities shared by client (overlay drawing) and server (reconstruction). */

export interface Vec2 {
	x: number;
	y: number;
}

export interface SampledCurve {
	/** dense points along the curve, in the same units as the control points */
	points: Vec2[];
	/** unit tangents at each sampled point */
	tangents: Vec2[];
	/** unit normals (tangent rotated +90°: pointing left of travel direction) */
	normals: Vec2[];
	/** cumulative arc length at each sampled point */
	cumLen: number[];
	/** total arc length */
	length: number;
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
	const t2 = t * t;
	const t3 = t2 * t;
	return {
		x:
			0.5 *
			(2 * p1.x +
				(-p0.x + p2.x) * t +
				(2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
				(-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
		y:
			0.5 *
			(2 * p1.y +
				(-p0.y + p2.y) * t +
				(2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
				(-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
	};
}

/**
 * Sample a Catmull-Rom spline through the control points at ~step spacing
 * (arc-length re-parameterized).
 */
export function sampleCurve(control: Vec2[], step: number): SampledCurve | null {
	if (control.length < 2) return null;

	// oversample, then resample uniformly by arc length
	const raw: Vec2[] = [];
	const n = control.length;
	const segSamples = 24;
	for (let i = 0; i < n - 1; i++) {
		const p0 = control[Math.max(0, i - 1)];
		const p1 = control[i];
		const p2 = control[i + 1];
		const p3 = control[Math.min(n - 1, i + 2)];
		for (let s = 0; s < segSamples; s++) {
			raw.push(catmullRom(p0, p1, p2, p3, s / segSamples));
		}
	}
	raw.push({ ...control[n - 1] });

	// cumulative length of raw
	const rawLen: number[] = [0];
	for (let i = 1; i < raw.length; i++) {
		rawLen.push(rawLen[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
	}
	const total = rawLen[rawLen.length - 1];
	if (total < step) return null;

	const count = Math.max(2, Math.floor(total / step) + 1);
	const points: Vec2[] = [];
	let ri = 0;
	for (let i = 0; i < count; i++) {
		const target = (i / (count - 1)) * total;
		while (ri < rawLen.length - 2 && rawLen[ri + 1] < target) ri++;
		const span = rawLen[ri + 1] - rawLen[ri] || 1;
		const f = (target - rawLen[ri]) / span;
		points.push({
			x: raw[ri].x + (raw[ri + 1].x - raw[ri].x) * f,
			y: raw[ri].y + (raw[ri + 1].y - raw[ri].y) * f
		});
	}

	const tangents: Vec2[] = [];
	const normals: Vec2[] = [];
	const cumLen: number[] = [];
	for (let i = 0; i < points.length; i++) {
		const a = points[Math.max(0, i - 1)];
		const b = points[Math.min(points.length - 1, i + 1)];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		tangents.push({ x: dx / len, y: dy / len });
		normals.push({ x: -dy / len, y: dx / len });
		cumLen.push((i / (points.length - 1)) * total);
	}

	return { points, tangents, normals, cumLen, length: total };
}

/** Find the sample index at a given arc-length position. */
export function indexAtLength(curve: SampledCurve, u: number): number {
	const f = Math.max(0, Math.min(1, u / curve.length));
	return Math.round(f * (curve.points.length - 1));
}

/** Mean mesiodistal tooth widths (mm), positions 1 (central incisor) … 8 (third molar). */
const TOOTH_WIDTHS = [8.5, 6.5, 7.6, 7.1, 6.8, 10.4, 9.8, 9.5];

/**
 * Approximate arc-length position (mm) of an FDI tooth's center along a
 * panoramic curve spanning the arch posterior→posterior, by proportional
 * cumulative tooth widths. Travel direction is detected from the endpoints
 * (patient right = −x in LPS volume coordinates). Returns null on bad input
 * or when the curve is too short to be a full arch for a posterior tooth.
 */
export function toothArchU(curve: SampledCurve, fdiTooth: string | number): number | null {
	const t = Number(fdiTooth);
	if (!Number.isInteger(t)) return null;
	const q = Math.floor(t / 10);
	const pos = t % 10;
	if (q < 1 || q > 4 || pos < 1 || pos > 8) return null;
	const isRight = q === 1 || q === 4; // FDI quadrants 1 (maxilla) and 4 (mandible)
	const half = TOOTH_WIDTHS.reduce((a, b) => a + b, 0);
	let dist = 0; // from the right-posterior arch end to the tooth center
	for (let p = 8; p > pos; p--) dist += TOOTH_WIDTHS[p - 1];
	dist += TOOTH_WIDTHS[pos - 1] / 2;
	if (!isRight) dist = 2 * half - dist;
	const frac = dist / (2 * half);
	const startsRight = curve.points[0].x <= curve.points[curve.points.length - 1].x;
	return (startsRight ? frac : 1 - frac) * curve.length;
}
