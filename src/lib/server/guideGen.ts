/**
 * Surgical drill guide body generation.
 *
 * Voxel/heightfield pipeline: the surface scan is transformed into volume
 * space, rasterized into a top-surface heightfield over a region of interest
 * around the planned implants, extruded into a constant-thickness cap that
 * follows the anatomy (offset by the seating gap), merged with cylindrical
 * sleeve mounts around each guide sleeve, pierced by open drill channels
 * along each implant axis, and finally polygonized with marching cubes.
 *
 * Insertion direction is +z (guide seats from above; mandible-style).
 * All coordinates are volume-local millimetres.
 */
import { marchingCubes } from './marchingCubes';
import { applyMat4, type Mat4 } from '../registration';
import { segSegDistance, type Vec3 } from '../geometry';

export interface GuideImplant {
	/** Implant platform centre, volume-local mm. */
	head: { x: number; y: number; z: number };
	/** Unit vector head→apex (points INTO bone, typically -z-ish). */
	axis: { x: number; y: number; z: number };
	/**
	 * Guide sleeve: outer diameter and height (mm), plus the head→sleeve-bottom
	 * offset measured AGAINST the axis direction (the sleeve sits above the head).
	 */
	sleeve: { diameter: number; height: number; offset: number };
}

export interface GuideParams {
	/** Gap between scan surface and guide intaglio, mm (default 0.15). */
	offset?: number;
	/** Guide shell thickness, mm (default 2.5). */
	thickness?: number;
	/** Guide footprint radius around each implant axis in xy, mm (default 9). */
	regionRadius?: number;
	/** Voxel grid resolution, mm (default 0.3). */
	voxel?: number;
	/** Extra wall around each sleeve, mm (default 1.6). */
	mountWall?: number;
}

export interface GuideMesh {
	positions: Float32Array;
	normals: Float32Array;
	triangles: number;
}

/** Occupancy value for solid voxels; the isosurface is extracted at BODY / 2. */
const BODY = 200;
const ISO = 100;
/** Empty voxel layers kept around the body so marching cubes closes the surface. */
const PAD_VOXELS = 2;
/** The region mask is clipped to the scan xy bounding box grown by this much (mm). */
const SCAN_CLIP_MARGIN = 2;
/** Sleeve mounts may extend this far above the sleeve top (mm). */
const MOUNT_TOP_MARGIN = 0.5;
/** Sleeve mounts may start this far below the sleeve bottom (mm). */
const MOUNT_BOTTOM_DROP = 1;

function emptyMesh(): GuideMesh {
	return { positions: new Float32Array(0), normals: new Float32Array(0), triangles: 0 };
}

/** Squared distance from (px,py) to the 2D segment (ax,ay)-(bx,by). */
function pointSegDist2Sq(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const l2 = dx * dx + dy * dy;
	let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	const cx = ax + dx * t - px;
	const cy = ay + dy * t - py;
	return cx * cx + cy * cy;
}

/**
 * Generate a surgical drill guide body mesh from a surface scan and the
 * planned implants. Returns a triangle soup (positions/normals, length
 * divisible by 9) in volume-local mm.
 *
 * @param scanPositions triangle soup of the surface scan, scan-local mm
 * @param scanTransform scan→volume transform (null = identity)
 * @param implants      planned implants with their guide sleeves
 * @param params        optional generation parameters (see GuideParams)
 */
export function generateGuide(
	scanPositions: Float32Array,
	scanTransform: Mat4 | null,
	implants: GuideImplant[],
	params?: GuideParams
): GuideMesh {
	const offset = params?.offset ?? 0.15;
	const thickness = params?.thickness ?? 2.5;
	const regionRadius = params?.regionRadius ?? 9;
	const voxel = params?.voxel ?? 0.3;
	const mountWall = params?.mountWall ?? 1.6;

	if (implants.length === 0 || scanPositions.length < 9) return emptyMesh();

	/* ---- 1. transform scan vertices into volume space ---- */
	let pts: Float32Array;
	if (scanTransform) {
		pts = new Float32Array(scanPositions.length);
		for (let i = 0; i + 2 < scanPositions.length; i += 3) {
			const p = applyMat4(scanTransform, {
				x: scanPositions[i],
				y: scanPositions[i + 1],
				z: scanPositions[i + 2]
			});
			pts[i] = p.x;
			pts[i + 1] = p.y;
			pts[i + 2] = p.z;
		}
	} else {
		pts = scanPositions;
	}

	let scanMinX = Infinity;
	let scanMaxX = -Infinity;
	let scanMinY = Infinity;
	let scanMaxY = -Infinity;
	for (let i = 0; i + 2 < pts.length; i += 3) {
		const x = pts[i];
		const y = pts[i + 1];
		if (x < scanMinX) scanMinX = x;
		if (x > scanMaxX) scanMaxX = x;
		if (y < scanMinY) scanMinY = y;
		if (y > scanMaxY) scanMaxY = y;
	}

	/* ---- implant geometry: unit axes, sleeve bottom/top points ---- */
	const heads: Vec3[] = [];
	const sleeveBottoms: Vec3[] = [];
	const sleeveTops: Vec3[] = [];
	const axes: Vec3[] = [];
	for (const imp of implants) {
		const al = Math.hypot(imp.axis.x, imp.axis.y, imp.axis.z);
		if (al < 1e-9) {
			throw new Error('generateGuide: implant axis must be a non-zero vector');
		}
		const u: Vec3 = { x: imp.axis.x / al, y: imp.axis.y / al, z: imp.axis.z / al };
		axes.push(u);
		heads.push({ x: imp.head.x, y: imp.head.y, z: imp.head.z });
		// The sleeve sits above the head, i.e. against the axis direction.
		const so = imp.sleeve.offset;
		const st = imp.sleeve.offset + imp.sleeve.height;
		sleeveBottoms.push({
			x: imp.head.x - u.x * so,
			y: imp.head.y - u.y * so,
			z: imp.head.z - u.z * so
		});
		sleeveTops.push({
			x: imp.head.x - u.x * st,
			y: imp.head.y - u.y * st,
			z: imp.head.z - u.z * st
		});
	}

	/* ---- 2. region of interest in xy ---- */
	// Connect adjacent implants (sorted by angle around the xy centroid of the
	// heads, matching a dental arch) so multi-implant guides form one body.
	let cx = 0;
	let cy = 0;
	for (const h of heads) {
		cx += h.x;
		cy += h.y;
	}
	cx /= heads.length;
	cy /= heads.length;
	const order = heads
		.map((h, i) => ({ i, ang: Math.atan2(h.y - cy, h.x - cx) }))
		.sort((a, b) => a.ang - b.ang)
		.map((e) => e.i);
	const segments: Array<[Vec3, Vec3]> = [];
	for (let k = 0; k + 1 < order.length; k++) {
		segments.push([heads[order[k]], heads[order[k + 1]]]);
	}

	// Region bbox: implant discs union, clipped to the scan xy bbox + margin.
	const clipMinX = scanMinX - SCAN_CLIP_MARGIN;
	const clipMaxX = scanMaxX + SCAN_CLIP_MARGIN;
	const clipMinY = scanMinY - SCAN_CLIP_MARGIN;
	const clipMaxY = scanMaxY + SCAN_CLIP_MARGIN;
	let rMinX = Infinity;
	let rMaxX = -Infinity;
	let rMinY = Infinity;
	let rMaxY = -Infinity;
	for (const h of heads) {
		rMinX = Math.min(rMinX, h.x - regionRadius);
		rMaxX = Math.max(rMaxX, h.x + regionRadius);
		rMinY = Math.min(rMinY, h.y - regionRadius);
		rMaxY = Math.max(rMaxY, h.y + regionRadius);
	}
	rMinX = Math.max(rMinX, clipMinX);
	rMaxX = Math.min(rMaxX, clipMaxX);
	rMinY = Math.max(rMinY, clipMinY);
	rMaxY = Math.min(rMaxY, clipMaxY);
	if (rMinX >= rMaxX || rMinY >= rMaxY) return emptyMesh();

	// Grid origin/dims, padded so body voxels never touch the grid boundary.
	const pad = PAD_VOXELS * voxel;
	const ox = rMinX - pad;
	const oy = rMinY - pad;
	const nx = Math.ceil((rMaxX + pad - ox) / voxel) + 1;
	const ny = Math.ceil((rMaxY + pad - oy) / voxel) + 1;

	// Region mask per xy column: inside the clip rect AND within regionRadius
	// of an implant head or of a corridor segment between adjacent heads.
	const r2 = regionRadius * regionRadius;
	const mask = new Uint8Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		const py = oy + j * voxel;
		for (let i = 0; i < nx; i++) {
			const px = ox + i * voxel;
			if (px < clipMinX || px > clipMaxX || py < clipMinY || py > clipMaxY) continue;
			let inside = false;
			for (const h of heads) {
				const dx = px - h.x;
				const dy = py - h.y;
				if (dx * dx + dy * dy <= r2) {
					inside = true;
					break;
				}
			}
			if (!inside) {
				for (const [a, b] of segments) {
					if (pointSegDist2Sq(px, py, a.x, a.y, b.x, b.y) <= r2) {
						inside = true;
						break;
					}
				}
			}
			if (inside) mask[j * nx + i] = 1;
		}
	}

	/* ---- 3. heightfield: max scan z per xy column ---- */
	// O(total covered cells): per triangle, walk only the cells of its xy bbox
	// and test with barycentric coordinates.
	const zSurf = new Float32Array(nx * ny).fill(-Infinity);
	for (let t = 0; t + 8 < pts.length; t += 9) {
		const x0 = pts[t];
		const y0 = pts[t + 1];
		const z0 = pts[t + 2];
		const x1 = pts[t + 3];
		const y1 = pts[t + 4];
		const z1 = pts[t + 5];
		const x2 = pts[t + 6];
		const y2 = pts[t + 7];
		const z2 = pts[t + 8];

		const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
		if (Math.abs(denom) < 1e-12) continue; // degenerate in xy

		const i0 = Math.max(0, Math.ceil((Math.min(x0, x1, x2) - ox) / voxel - 1e-9));
		const i1 = Math.min(nx - 1, Math.floor((Math.max(x0, x1, x2) - ox) / voxel + 1e-9));
		const j0 = Math.max(0, Math.ceil((Math.min(y0, y1, y2) - oy) / voxel - 1e-9));
		const j1 = Math.min(ny - 1, Math.floor((Math.max(y0, y1, y2) - oy) / voxel + 1e-9));

		for (let j = j0; j <= j1; j++) {
			const py = oy + j * voxel;
			const row = j * nx;
			for (let i = i0; i <= i1; i++) {
				const px = ox + i * voxel;
				const a = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
				const b = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
				const c = 1 - a - b;
				if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
				const z = a * z0 + b * z1 + c * z2;
				if (z > zSurf[row + i]) zSurf[row + i] = z;
			}
		}
	}

	/* ---- z extent of the body ---- */
	let minZSurf = Infinity;
	let maxZSurf = -Infinity;
	for (let idx = 0; idx < mask.length; idx++) {
		if (mask[idx] === 0) continue;
		const z = zSurf[idx];
		if (z === -Infinity) continue;
		if (z < minZSurf) minZSurf = z;
		if (z > maxZSurf) maxZSurf = z;
	}
	if (minZSurf === Infinity) return emptyMesh(); // no scan coverage in the region

	let topZ = maxZSurf + offset + thickness;
	for (const st of sleeveTops) {
		topZ = Math.max(topZ, st.z + MOUNT_TOP_MARGIN);
	}
	const zLo = minZSurf + offset - pad;
	const zHi = topZ + pad;
	const nz = Math.ceil((zHi - zLo) / voxel) + 1;
	if (nz < 2) return emptyMesh();

	/* ---- 4. occupancy grid (x fastest, then y, then z) ---- */
	const nxny = nx * ny;
	const grid = new Uint8Array(nxny * nz);

	// 4a. anatomy-following cap: [zSurf + offset, zSurf + offset + thickness].
	for (let j = 0; j < ny; j++) {
		const row = j * nx;
		for (let i = 0; i < nx; i++) {
			const idx2 = row + i;
			if (mask[idx2] === 0) continue;
			const zs = zSurf[idx2];
			if (zs === -Infinity) continue;
			const zb = zs + offset;
			const k0 = Math.max(0, Math.ceil((zb - zLo) / voxel));
			const k1 = Math.min(nz - 1, Math.floor((zb + thickness - zLo) / voxel));
			for (let k = k0; k <= k1; k++) {
				grid[k * nxny + idx2] = BODY;
			}
		}
	}

	// 4b. sleeve mounts: cylinder around the sleeve segment, widened by
	// mountWall, reaching from the cap intaglio (or just below the sleeve
	// bottom) up to just above the sleeve top.
	for (let m = 0; m < implants.length; m++) {
		const bot = sleeveBottoms[m];
		const top = sleeveTops[m];
		const mountR = implants[m].sleeve.diameter / 2 + mountWall;
		const i0 = Math.max(0, Math.floor((Math.min(bot.x, top.x) - mountR - ox) / voxel));
		const i1 = Math.min(nx - 1, Math.ceil((Math.max(bot.x, top.x) + mountR - ox) / voxel));
		const j0 = Math.max(0, Math.floor((Math.min(bot.y, top.y) - mountR - oy) / voxel));
		const j1 = Math.min(ny - 1, Math.ceil((Math.max(bot.y, top.y) + mountR - oy) / voxel));
		const kTop = Math.min(nz - 1, Math.floor((top.z + MOUNT_TOP_MARGIN - zLo) / voxel));
		for (let j = j0; j <= j1; j++) {
			const py = oy + j * voxel;
			const row = j * nx;
			for (let i = i0; i <= i1; i++) {
				const px = ox + i * voxel;
				const zs = zSurf[row + i];
				const low =
					zs === -Infinity
						? bot.z - MOUNT_BOTTOM_DROP
						: Math.min(zs + offset, bot.z - MOUNT_BOTTOM_DROP);
				const kLow = Math.max(0, Math.ceil((low - zLo) / voxel));
				for (let k = kLow; k <= kTop; k++) {
					const p: Vec3 = { x: px, y: py, z: zLo + k * voxel };
					// Point-to-segment distance via segSegDistance with a degenerate segment.
					if (segSegDistance(p, p, bot, top) <= mountR) {
						grid[k * nxny + row + i] = BODY;
					}
				}
			}
		}
	}

	// 5. drill channels: clear everything within sleeve radius of the
	// (infinite) implant axis line from the head z up to the grid top, so each
	// sleeve seat is an open cylinder through the whole guide.
	for (let m = 0; m < implants.length; m++) {
		const h = heads[m];
		const u = axes[m];
		const r = implants[m].sleeve.diameter / 2;
		const rSq = r * r;
		const kFrom = Math.max(0, Math.ceil((h.z - zLo) / voxel));
		const halfWidth = r / Math.max(Math.abs(u.z), 0.2) + voxel;
		for (let k = kFrom; k < nz; k++) {
			const z = zLo + k * voxel;
			// xy centre of the channel in this slice (axis is never horizontal
			// for a seatable guide; halfWidth above is clamped accordingly).
			const tAx = Math.abs(u.z) > 1e-6 ? (z - h.z) / u.z : 0;
			const ccx = h.x + u.x * tAx;
			const ccy = h.y + u.y * tAx;
			const i0 = Math.max(0, Math.floor((ccx - halfWidth - ox) / voxel));
			const i1 = Math.min(nx - 1, Math.ceil((ccx + halfWidth - ox) / voxel));
			const j0 = Math.max(0, Math.floor((ccy - halfWidth - oy) / voxel));
			const j1 = Math.min(ny - 1, Math.ceil((ccy + halfWidth - oy) / voxel));
			const slab = k * nxny;
			for (let j = j0; j <= j1; j++) {
				const py = oy + j * voxel;
				const row = slab + j * nx;
				for (let i = i0; i <= i1; i++) {
					const px = ox + i * voxel;
					// Distance from the voxel to the infinite axis line.
					const vx = px - h.x;
					const vy = py - h.y;
					const vz = z - h.z;
					const proj = vx * u.x + vy * u.y + vz * u.z;
					const dSq = vx * vx + vy * vy + vz * vz - proj * proj;
					if (dSq <= rSq) grid[row + i] = 0;
				}
			}
		}
	}

	/* ---- 6. polygonize and shift into volume coordinates ---- */
	const { positions, normals } = marchingCubes(grid, [nx, ny, nz], [voxel, voxel, voxel], ISO);
	for (let i = 0; i + 2 < positions.length; i += 3) {
		positions[i] += ox;
		positions[i + 1] += oy;
		positions[i + 2] += zLo;
	}
	return { positions, normals, triangles: positions.length / 9 };
}
