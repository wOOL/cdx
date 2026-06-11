/**
 * Abutment alignment math for group abutment assignment (All-on-4/6 style
 * axis parallelization) and rotational alignment.
 *
 * Conventions:
 * - `axis` is the implant unit axis head → apex (same as ImplantData ax/ay/az).
 * - The abutment extends against the axis (head → abutment top = -axis).
 * - `azimuthDeg` is measured in the plane perpendicular to the implant axis,
 *   from a deterministic reference direction (world +x projected into that
 *   plane; +y when the axis is near ±x), counter-clockwise around the axis,
 *   normalized to [0, 360).
 */
import { dot, norm, scale, sub, type Vec3 } from './geometry';

function cross(a: Vec3, b: Vec3): Vec3 {
	return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

const RAD2DEG = 180 / Math.PI;

/**
 * Orthonormal in-plane frame {u, v} perpendicular to unit axis n.
 * u = world +x projected into the plane (or +y when axis ≈ ±x), v = n × u.
 */
export function axisFrame(axis: Vec3): { n: Vec3; u: Vec3; v: Vec3 } {
	const n = norm(axis);
	const ref: Vec3 = Math.abs(n.x) > 0.92 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
	const u = norm(sub(ref, scale(n, dot(ref, n))));
	const v = cross(n, u);
	return { n, u, v };
}

/**
 * How an angulated abutment must be configured so its (tilted) prosthetic axis
 * points toward `target` while mounted on an implant with the given `axis`.
 *
 * - tiltDeg: angle between the implant axis and the target direction — the
 *   angulation the abutment must provide to fully compensate (0 = parallel).
 * - azimuthDeg: rotation around the implant axis (degrees, [0, 360)) that
 *   tips the abutment toward the target (the azimuth of the target projected
 *   into the plane perpendicular to the implant axis). 0 when the target is
 *   parallel to the axis (no preferred direction).
 *
 * Inputs need not be normalized; zero-length vectors yield tiltDeg 0.
 */
export function computeAbutmentAlignment(
	axis: Vec3,
	target: Vec3
): { tiltDeg: number; azimuthDeg: number } {
	const { n, u, v } = axisFrame(axis);
	const t = norm(target);
	const c = Math.max(-1, Math.min(1, dot(n, t)));
	const tiltDeg = Math.acos(c) * RAD2DEG;

	// project target into the plane ⊥ axis
	const tp = sub(t, scale(n, dot(t, n)));
	const px = dot(tp, u);
	const py = dot(tp, v);
	if (Math.hypot(px, py) < 1e-9) return { tiltDeg, azimuthDeg: 0 };
	let azimuthDeg = Math.atan2(py, px) * RAD2DEG;
	if (azimuthDeg < 0) azimuthDeg += 360;
	return { tiltDeg, azimuthDeg };
}

/**
 * Smallest available abutment angulation that fully compensates the needed
 * tilt (smallest entry ≥ tiltDeg, with a small numeric tolerance).
 * Returns null when even the largest available angulation is insufficient.
 */
export function chooseAngulation(tiltDeg: number, available: number[]): number | null {
	const EPS = 1e-6;
	let best: number | null = null;
	for (const a of available) {
		if (!Number.isFinite(a)) continue;
		if (a + EPS >= tiltDeg && (best === null || a < best)) best = a;
	}
	return best;
}

/** Residual angle (deg) between target and abutment direction after assignment. */
export function residualDeviation(tiltDeg: number, chosenAngle: number | null): number {
	if (chosenAngle == null) return tiltDeg;
	return Math.abs(tiltDeg - chosenAngle);
}
