/**
 * Virtual tooth ("Edit teeth" wax-up) mesh generation.
 *
 * Replicates the desktop coDiagnostiX feature of placing a library tooth as a
 * real 3D planning reference: a closed, crown-like solid built from the 2D
 * tooth outline in $lib/implantLibrary (`virtualToothOutline`), extruded as a
 * stack of scaled rings along the tooth's vertical axis.
 *
 * Coordinate convention (documented for callers):
 *   - The mesh is ALWAYS generated z-up, regardless of jaw:
 *       origin (0,0,0) = center of the cervical base (the end that sits on
 *       the crest / emergence point), +z = toward the occlusal surface.
 *   - x = mesiodistal, y = buccolingual, z = occluso-cervical. Height along z
 *     equals the template's heightMM (× scale), width along x equals widthMM
 *     (× scale).
 *   - For UPPER teeth (FDI 1x/2x) the caller flips the crown to point down by
 *     baking a 180° rotation about X into the model transform — see
 *     `virtualToothTransform(position, flip)`.
 *
 * The solid is watertight: every edge is shared by exactly two triangles and
 * the winding is outward (positive signed volume).
 */

import { virtualToothOutline, virtualToothTemplate } from '../implantLibrary';

/**
 * Vertical profile of the crown: [heightFraction, radialScale] stations from
 * the cervical base (t=0) to the occlusal end (t=1). Full size near the
 * occlusal table (t≈0.8), tapering to ~62% at the cervical end, with three
 * shrinking cap rings that dome the occlusal surface.
 */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
	[0.0, 0.62], // cervical base (~60–70% taper)
	[0.1, 0.68],
	[0.25, 0.78],
	[0.45, 0.88],
	[0.65, 0.96],
	[0.8, 1.0], // occlusal table — full outline size
	[0.88, 0.97], // dome cap rings
	[0.94, 0.86],
	[0.98, 0.62],
	[1.0, 0.3] // small occlusal plateau, fan-capped to the apex
];

/**
 * Buccolingual width as a fraction of the mesiodistal width, per tooth
 * position (population-plausible approximations: incisors are thin
 * labiolingually, premolars are wider BL than MD, molars roughly square).
 */
function buccolingualRatio(pos: number): number {
	if (pos >= 6) return 0.95; // molar
	if (pos >= 4) return 1.15; // premolar
	if (pos === 3) return 0.95; // canine
	return 0.85; // incisor
}

/**
 * Generate a closed crown-like solid for an FDI tooth as a triangle soup
 * (flat Float32Array of xyz positions, length divisible by 9).
 *
 * Throws if `tooth` is not a known FDI number with a template.
 * `opts.scale` scales all dimensions uniformly (default 1).
 */
export function generateVirtualTooth(tooth: number, opts: { scale?: number } = {}): Float32Array {
	const tpl = virtualToothTemplate(tooth);
	if (!tpl) throw new Error(`Unknown FDI tooth ${tooth} — no virtual tooth template`);
	const scale = opts.scale ?? 1;
	if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid scale ${scale}`);

	// --- occlusal cross-section: outline, centered + normalized to template mm
	const raw = virtualToothOutline(tooth);
	// drop the explicit closing point (first repeated as last)
	const pts = raw.slice(0, -1).map((p) => ({ x: p.x, y: p.y }));
	if (pts.length < 8) throw new Error(`Degenerate outline for tooth ${tooth}`);

	// enforce counter-clockwise winding (mirrored quadrants 2/3 come in CW)
	let area2 = 0;
	for (let i = 0; i < pts.length; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		area2 += a.x * b.y - b.x * a.y;
	}
	if (area2 < 0) pts.reverse();

	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	// normalize so the full-size ring spans exactly widthMM mesiodistally and a
	// plausible buccolingual width (the outline's own y span is a glyph height,
	// not an anatomic BL width)
	const sx = (tpl.widthMM * scale) / (maxX - minX);
	const sy = (tpl.widthMM * buccolingualRatio(tooth % 10) * scale) / (maxY - minY);
	const H = tpl.heightMM * scale;

	// --- build rings (shared vertex coordinates so caps/walls match exactly)
	const N = pts.length;
	const R = PROFILE.length;
	// rings[k] = flat [x0,y0,z0, x1,y1,z1, ...] for profile station k
	const rings: number[][] = [];
	for (let k = 0; k < R; k++) {
		const [t, s] = PROFILE[k];
		const ring: number[] = [];
		for (const p of pts) {
			ring.push((p.x - cx) * sx * s, (p.y - cy) * sy * s, t * H);
		}
		rings.push(ring);
	}

	const triCount = (R - 1) * N * 2 + N * 2; // walls + top fan + bottom fan
	const out = new Float32Array(triCount * 9);
	let o = 0;
	const emit = (
		ax: number,
		ay: number,
		az: number,
		bx: number,
		by: number,
		bz: number,
		cxx: number,
		cyy: number,
		czz: number
	) => {
		out[o++] = ax;
		out[o++] = ay;
		out[o++] = az;
		out[o++] = bx;
		out[o++] = by;
		out[o++] = bz;
		out[o++] = cxx;
		out[o++] = cyy;
		out[o++] = czz;
	};

	// side walls: quad (lo_i, lo_j, hi_j, hi_i) → two outward-facing triangles
	// (CCW cross-sections viewed from +z give outward normals with this order)
	for (let k = 0; k < R - 1; k++) {
		const lo = rings[k];
		const hi = rings[k + 1];
		for (let i = 0; i < N; i++) {
			const j = (i + 1) % N;
			const i3 = i * 3;
			const j3 = j * 3;
			emit(lo[i3], lo[i3 + 1], lo[i3 + 2], lo[j3], lo[j3 + 1], lo[j3 + 2], hi[j3], hi[j3 + 1], hi[j3 + 2]);
			emit(lo[i3], lo[i3 + 1], lo[i3 + 2], hi[j3], hi[j3 + 1], hi[j3 + 2], hi[i3], hi[i3 + 1], hi[i3 + 2]);
		}
	}

	// occlusal cap: fan from the top ring to the apex at (0,0,H) — normal +z
	const top = rings[R - 1];
	for (let i = 0; i < N; i++) {
		const j = (i + 1) % N;
		const i3 = i * 3;
		const j3 = j * 3;
		emit(top[i3], top[i3 + 1], top[i3 + 2], top[j3], top[j3 + 1], top[j3 + 2], 0, 0, H);
	}

	// cervical base cap: fan to (0,0,0), reversed order so the normal faces −z
	const base = rings[0];
	for (let i = 0; i < N; i++) {
		const j = (i + 1) % N;
		const i3 = i * 3;
		const j3 = j * 3;
		emit(base[j3], base[j3 + 1], base[j3 + 2], base[i3], base[i3 + 1], base[i3 + 2], 0, 0, 0);
	}

	return out;
}

/**
 * Column-major 4×4 model transform (the models.transform JSON convention,
 * consumed via THREE.Matrix4.fromArray) placing a virtual tooth at
 * `position` (volume-local mm). With `flip` the crown is rotated 180° about
 * X (diag(1,−1,−1) rotation block) so the z-up mesh points occlusally
 * downward — use this for upper-jaw teeth (FDI 1x/2x).
 */
export function virtualToothTransform(
	position: { x: number; y: number; z: number },
	flip = false
): number[] {
	const r = flip ? -1 : 1;
	// column-major: columns are basis vectors, translation in elements 12–14
	return [1, 0, 0, 0, 0, r, 0, 0, 0, 0, r, 0, position.x, position.y, position.z, 1];
}
