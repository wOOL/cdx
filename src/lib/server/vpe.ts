/**
 * Virtual Planning Export geometry + assembly.
 *
 * Meshes are triangle soups (flat Float32Array of xyz, length % 9 === 0,
 * units mm) like stl.ts/meshTools.ts. Shell generators emit watertight
 * soups: side strips and cap fans reuse the exact same ring coordinates, so
 * every edge is shared bit-identically (detectMeshIssues → 0 open edges).
 *
 * Placement conventions (see abutmentMath.ts):
 * - implant axis (ax,ay,az) is the unit vector head → apex;
 * - the prosthetic direction points AGAINST the axis;
 * - an angled abutment with angle θ / rotation φ has prosthetic direction
 *   d = -(n·cosθ + w·sinθ) with w = u·cosφ + v·sinφ in the axisFrame(n)
 *   plane — the abutment top sits at head + d·height.
 */

import { zipSync } from 'fflate';
import { axisFrame } from '../abutmentMath';
import type { Vec3 } from '../geometry';
import type { StoredAbutment } from '../implantLibrary';
import { getScanbody, implantPlatform, type ScanbodyEntry, type VpeItem, type VpeLevel, type VpeMode, type VpePreviewPayload } from '../vpeCatalog';
import { applyMeshEdit } from './meshEdit';
import { repairMesh } from './meshTools';
import { meshToStlBinary } from './stl';

/** implant fields the export needs (subset of the implants row, abutment parsed) */
export interface VpeImplant {
	id: number;
	tooth: string;
	manufacturer: string;
	line: string;
	diameter: number;
	x: number;
	y: number;
	z: number;
	ax: number;
	ay: number;
	az: number;
	abutment: StoredAbutment | null;
}

export interface VpePart {
	name: string;
	positions: Float32Array;
}

// ---------------- parametric shells ----------------

const SEG = 24;

/** ring of SEG points r·(cosθ, sinθ) at height z; the anti-rotation flat clamps x to r − flatDepth */
function ring(r: number, z: number, flatDepth = 0, seg = SEG): number[] {
	const pts: number[] = [];
	const xMax = r - flatDepth;
	for (let i = 0; i < seg; i++) {
		const a = (i / seg) * 2 * Math.PI;
		let x = r * Math.cos(a);
		if (flatDepth > 0 && x > xMax) x = xMax;
		pts.push(x, r * Math.sin(a), z);
	}
	return pts;
}

/** quad strip between two rings of equal point count (outward winding for lower→upper CCW rings) */
function lateral(out: number[], lo: number[], up: number[]): void {
	const n = lo.length / 3;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const a = [lo[i * 3], lo[i * 3 + 1], lo[i * 3 + 2]];
		const b = [lo[j * 3], lo[j * 3 + 1], lo[j * 3 + 2]];
		const c = [up[j * 3], up[j * 3 + 1], up[j * 3 + 2]];
		const d = [up[i * 3], up[i * 3 + 1], up[i * 3 + 2]];
		out.push(...a, ...b, ...c, ...a, ...c, ...d);
	}
}

/** cap fan from the ring centroid; facingUp=true → normal +z (ring CCW seen from +z) */
function cap(out: number[], rg: number[], facingUp: boolean): void {
	const n = rg.length / 3;
	let cx = 0;
	let cy = 0;
	const z = rg[2];
	for (let i = 0; i < n; i++) {
		cx += rg[i * 3];
		cy += rg[i * 3 + 1];
	}
	cx /= n;
	cy /= n;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const p = [rg[i * 3], rg[i * 3 + 1], rg[i * 3 + 2]];
		const q = [rg[j * 3], rg[j * 3 + 1], rg[j * 3 + 2]];
		if (facingUp) out.push(cx, cy, z, ...p, ...q);
		else out.push(cx, cy, z, ...q, ...p);
	}
}

/**
 * Scanbody shell in local coords: origin at the seat, +z = prosthetic axis
 * (away from the implant). Collar cylinder, then the flat-cut scan cylinder.
 */
export function scanbodyMesh(sb: ScanbodyEntry): Float32Array {
	const out: number[] = [];
	const collarR = sb.collarDiameter / 2;
	const bodyR = sb.bodyDiameter / 2;
	const c0 = ring(collarR, 0);
	const c1 = ring(collarR, sb.collarHeight);
	const b0 = ring(bodyR, sb.collarHeight, sb.flatDepth);
	const b1 = ring(bodyR, sb.collarHeight + sb.bodyHeight, sb.flatDepth);
	cap(out, c0, false);
	lateral(out, c0, c1);
	lateral(out, c1, b0); // collar shoulder annulus (same z, shrinking r → faces +z)
	lateral(out, b0, b1);
	cap(out, b1, true);
	return Float32Array.from(out);
}

/** analog body length below the platform (mm) */
export const ANALOG_LENGTH = 12;
const ANALOG_COLLAR = 3;

/**
 * Implant-analog peg: stepped cylinder replicating the implant connection in
 * a lab model. Local coords: origin at the platform, the peg extends along
 * −z (into the model): platform-Ø seat collar, then a narrower flat-cut
 * retention body down to −ANALOG_LENGTH.
 */
export function analogMesh(platformDiameter: number): Float32Array {
	const out: number[] = [];
	const seatR = platformDiameter / 2;
	const bodyR = seatR * 0.75;
	const flat = bodyR * 0.3;
	const a0 = ring(bodyR, -ANALOG_LENGTH, flat);
	const a1 = ring(bodyR, -ANALOG_COLLAR, flat);
	const s0 = ring(seatR, -ANALOG_COLLAR);
	const s1 = ring(seatR, 0);
	cap(out, a0, false);
	lateral(out, a0, a1);
	lateral(out, a1, s0); // step annulus (same z, growing r → faces −z)
	lateral(out, s0, s1);
	cap(out, s1, true);
	return Float32Array.from(out);
}

// ---------------- placement ----------------

export interface Placement {
	origin: Vec3;
	dir: Vec3;
}

/**
 * Where the scanbody seat goes for an implant at the requested level.
 * - implant level: on the platform (head), pointing against the axis;
 * - abutment level: on the abutment top, along the tilted prosthetic
 *   direction (angle/rotation from the stored abutment; no abutment ⇒
 *   degenerates to implant level).
 */
export function scanbodyPlacement(im: VpeImplant, level: VpeLevel): Placement {
	const { n, u, v } = axisFrame({ x: im.ax, y: im.ay, z: im.az });
	if (level !== 'abutment' || !im.abutment) {
		return { origin: { x: im.x, y: im.y, z: im.z }, dir: { x: -n.x, y: -n.y, z: -n.z } };
	}
	const a = im.abutment;
	const th = ((a.angle ?? 0) * Math.PI) / 180;
	const ph = ((a.rotation ?? 0) * Math.PI) / 180;
	const wx = u.x * Math.cos(ph) + v.x * Math.sin(ph);
	const wy = u.y * Math.cos(ph) + v.y * Math.sin(ph);
	const wz = u.z * Math.cos(ph) + v.z * Math.sin(ph);
	const dir = {
		x: -(n.x * Math.cos(th) + wx * Math.sin(th)),
		y: -(n.y * Math.cos(th) + wy * Math.sin(th)),
		z: -(n.z * Math.cos(th) + wz * Math.sin(th))
	};
	const h = a.height ?? 0;
	return {
		origin: { x: im.x + dir.x * h, y: im.y + dir.y * h, z: im.z + dir.z * h },
		dir
	};
}

/**
 * Transform a local soup into world space: local +z → dir, +x/+y → the
 * deterministic axisFrame(dir) in-plane basis, origin at `origin`.
 */
export function placeMesh(local: Float32Array, origin: Vec3, dir: Vec3): Float32Array {
	const { n, u, v } = axisFrame(dir);
	const out = new Float32Array(local.length);
	for (let i = 0; i < local.length; i += 3) {
		const x = local[i];
		const y = local[i + 1];
		const z = local[i + 2];
		out[i] = origin.x + x * u.x + y * v.x + z * n.x;
		out[i + 1] = origin.y + x * u.y + y * v.y + z * n.y;
		out[i + 2] = origin.z + x * u.z + y * v.z + z * n.z;
	}
	return out;
}

// ---------------- assembly ----------------

/** 'Insert implant analogs' base prep: quick repair + close open boundary loops (≤ 60-edge centroid fans). */
export function closeBaseModel(positions: Float32Array): Float32Array {
	if (positions.length < 9) return positions;
	const repaired = repairMesh(positions).positions;
	if (repaired.length < 9) return repaired;
	return applyMeshEdit(repaired, { op: 'fillHoles' }).positions;
}

/**
 * Assemble the export parts: the base mesh (closed first in 'analogs' mode)
 * plus one shell per included item — the chosen scanbody at its level, and
 * in 'analogs' mode additionally an analog peg at the implant platform.
 * Items for positions without a prosthetic platform (pins) never get analogs.
 */
export function buildVpeParts(
	base: { name: string; positions: Float32Array },
	mode: VpeMode,
	implants: VpeImplant[],
	items: VpeItem[]
): VpePart[] {
	const byId = new Map(implants.map((im) => [im.id, im]));
	const parts: VpePart[] = [
		{
			name: base.name,
			positions: mode === 'analogs' ? closeBaseModel(base.positions) : base.positions
		}
	];
	for (const item of items) {
		if (!item.include) continue;
		const im = byId.get(item.implantId);
		if (!im) continue;
		if (mode === 'analogs' && implantPlatform(im) !== null) {
			const head = { x: im.x, y: im.y, z: im.z };
			const up = { x: -im.ax, y: -im.ay, z: -im.az };
			parts.push({
				name: `tooth_${im.tooth}_analog`,
				positions: placeMesh(analogMesh(im.diameter), head, up)
			});
		}
		const sb = item.scanbodyId ? getScanbody(item.scanbodyId) : null;
		if (sb) {
			const p = scanbodyPlacement(im, item.level);
			parts.push({
				name: `tooth_${im.tooth}_${item.level}_${sb.id}`,
				positions: placeMesh(scanbodyMesh(sb), p.origin, p.dir)
			});
		}
	}
	return parts;
}

// ---------------- output ----------------

function safeName(name: string): string {
	return name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'part';
}

/** Single file: every part concatenated into one binary STL. */
export function vpeSingleStl(parts: VpePart[], name = 'vpe'): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.positions.length;
	const all = new Float32Array(total);
	let off = 0;
	for (const p of parts) {
		all.set(p.positions, off);
		off += p.positions.length;
	}
	return meshToStlBinary(all, name);
}

/** Multi-file: one binary STL per part, zipped (names deduped with _2, _3, …). */
export function vpeZip(parts: VpePart[]): Uint8Array {
	const entries: Record<string, Uint8Array> = {};
	for (const p of parts) {
		const base = safeName(p.name);
		let file = `${base}.stl`;
		for (let k = 2; file in entries; k++) file = `${base}_${k}.stl`;
		entries[file] = meshToStlBinary(p.positions, base);
	}
	return zipSync(entries, { level: 1 });
}

/**
 * Flat preview payload for the dialog's 3D canvas. The base part (always
 * parts[0]) is triangle-strided down so the total stays under `maxFloats` —
 * a cheap O(n) pass, shells are left intact.
 */
export function vpePreview(parts: VpePart[], maxFloats = 300_000): VpePreviewPayload {
	let shellFloats = 0;
	for (let i = 1; i < parts.length; i++) shellFloats += parts[i].positions.length;
	const budget = Math.max(maxFloats - shellFloats, 9 * 1000);

	const positions: number[] = [];
	const out: VpePreviewPayload['parts'] = [];
	for (let i = 0; i < parts.length; i++) {
		let pos = parts[i].positions;
		if (i === 0 && pos.length > budget) {
			const tris = Math.floor(pos.length / 9);
			const stride = Math.ceil((tris * 9) / budget);
			const kept = new Float32Array(Math.ceil(tris / stride) * 9);
			let o = 0;
			for (let t = 0; t < tris; t += stride) {
				kept.set(pos.subarray(t * 9, t * 9 + 9), o);
				o += 9;
			}
			pos = kept.subarray(0, o);
		}
		const offset = positions.length;
		for (let k = 0; k < pos.length; k++) positions.push(pos[k]);
		out.push({ name: parts[i].name, offset, count: pos.length });
	}
	return { positions, parts: out };
}
