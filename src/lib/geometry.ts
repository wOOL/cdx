/** 3D geometry helpers (volume-local mm coordinates). */

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function add(a: Vec3, b: Vec3): Vec3 {
	return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function scale(a: Vec3, s: number): Vec3 {
	return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: Vec3, b: Vec3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function len(a: Vec3): number {
	return Math.hypot(a.x, a.y, a.z);
}
export function norm(a: Vec3): Vec3 {
	const l = len(a) || 1;
	return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Minimum distance between two 3D segments [p1,p2] and [q1,q2]. */
export function segSegDistance(p1: Vec3, p2: Vec3, q1: Vec3, q2: Vec3): number {
	const d1 = sub(p2, p1);
	const d2 = sub(q2, q1);
	const r = sub(p1, q1);
	const a = dot(d1, d1);
	const e = dot(d2, d2);
	const f = dot(d2, r);

	let s: number;
	let t: number;
	const EPS = 1e-9;

	if (a <= EPS && e <= EPS) {
		return len(r);
	}
	if (a <= EPS) {
		s = 0;
		t = Math.max(0, Math.min(1, f / e));
	} else {
		const c = dot(d1, r);
		if (e <= EPS) {
			t = 0;
			s = Math.max(0, Math.min(1, -c / a));
		} else {
			const b = dot(d1, d2);
			const denom = a * e - b * b;
			s = denom > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = Math.max(0, Math.min(1, -c / a));
			} else if (t > 1) {
				t = 1;
				s = Math.max(0, Math.min(1, (b - c) / a));
			}
		}
	}
	const cp = add(p1, scale(d1, s));
	const cq = add(q1, scale(d2, t));
	return len(sub(cp, cq));
}

/**
 * 3×3 rotation (row-major) aligning unit vector a onto unit vector b (Rodrigues).
 */
export function rotationAligning(a: Vec3, b: Vec3): number[] {
	const v = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
	const c = dot(a, b);
	const s2 = v.x * v.x + v.y * v.y + v.z * v.z;
	if (s2 < 1e-12) {
		if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
		// opposite: rotate 180° around any axis ⊥ a
		const axis = Math.abs(a.x) < 0.9 ? norm({ x: 0, y: -a.z, z: a.y }) : norm({ x: -a.z, y: 0, z: a.x });
		const { x, y, z } = axis;
		return [
			2 * x * x - 1, 2 * x * y, 2 * x * z,
			2 * x * y, 2 * y * y - 1, 2 * y * z,
			2 * x * z, 2 * y * z, 2 * z * z - 1
		];
	}
	const k = (1 - c) / s2;
	return [
		v.x * v.x * k + c, v.x * v.y * k - v.z, v.x * v.z * k + v.y,
		v.x * v.y * k + v.z, v.y * v.y * k + c, v.y * v.z * k - v.x,
		v.x * v.z * k - v.y, v.y * v.z * k + v.x, v.z * v.z * k + c
	];
}

export function applyRot3(m: number[], p: Vec3): Vec3 {
	return {
		x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
		y: m[3] * p.x + m[4] * p.y + m[5] * p.z,
		z: m[6] * p.x + m[7] * p.y + m[8] * p.z
	};
}

/** transpose = inverse for pure rotations */
export function transpose3(m: number[]): number[] {
	return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Minimum distance between a segment and a polyline. */
export function segPolylineDistance(p1: Vec3, p2: Vec3, poly: Vec3[]): number {
	let best = Infinity;
	for (let i = 0; i < poly.length - 1; i++) {
		const d = segSegDistance(p1, p2, poly[i], poly[i + 1]);
		if (d < best) best = d;
	}
	if (poly.length === 1) {
		best = segSegDistance(p1, p2, poly[0], poly[0]);
	}
	return best;
}
