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
 * Extras supported through GuideParams:
 *  - embossed text labels raised from the guide top surface (5×7 bitmap font)
 *  - bone support regions (extra footprint circles, SPEC §9.5)
 *  - free-hand contact areas (footprint polygons, SPEC §9.6)
 *  - bone reduction bars (cut-profile guides, SPEC §9.8)
 *  - explicit connectors between consecutive implants, normal or large
 *  - sleeve-mount hole shape: cylindrical or fit-to-sleeve-form
 *  - dual-scan bottom: a second mesh supplies the intaglio surface
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

/** Embossed label: raised text on the guide top surface. */
export interface GuideLabel {
	/** Text, A–Z / 0–9 / space / dash (anything else renders as space). */
	text: string;
	/** Lower-left anchor of the text block, mm. */
	x: number;
	y: number;
	/** Letter height, mm (default 3). */
	height?: number;
	/** Relief depth raised above the top surface, mm (default 0.8). */
	depth?: number;
}

/**
 * Bone reduction bar: a solid rectangular bar (box oriented along the
 * (x1,y1)→(x2,y2) segment) merged into the guide body. The bar's bottom face
 * (zTop − height) marks the planned bone-reduction level: during surgery the
 * bone is removed flush with the bar's underside (cut-profile guides, SPEC §9.8).
 */
export interface GuideReductionBar {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	/** Bar width perpendicular to the segment, mm. */
	width: number;
	/** Bar height (vertical extent), mm. */
	height: number;
	/** z of the bar top face, mm; bottom face = zTop − height. */
	zTop: number;
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
	/** Inspection windows: vertical cylindrical cutouts through the whole guide. */
	windows?: { x: number; y: number; diameter: number }[];
	/** Embossed label raised from the guide top surface. */
	label?: GuideLabel;
	/** Bone support regions: extra footprint circles (no sleeves), SPEC §9.5. */
	supportRegions?: { x: number; y: number; radius: number }[];
	/** Free-hand contact areas: xy polygons added to the footprint, SPEC §9.6. */
	contactPolygons?: { x: number; y: number }[][];
	/** Bone reduction bars merged into the body (cut-profile guides). */
	reductionBars?: GuideReductionBar[];
	/**
	 * Use large connectors: the connector strips between consecutive implant
	 * footprints are twice as wide (radius = regionRadius instead of
	 * regionRadius/2). Recommended for apicoectomy / sinus-lift / stacked guides.
	 */
	largeConnectors?: boolean;
	/**
	 * Sleeve-mount hole shape. 'cylindrical' (default) keeps a straight bore at
	 * the sleeve outer radius. 'fitForm' follows the sleeve profile with a
	 * press-fit clearance, approximated as a slight cone: +0.05 mm at the
	 * sleeve top widening to +0.15 mm at the sleeve bottom.
	 */
	mountHoleShape?: 'cylindrical' | 'fitForm';
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
/** fitForm press-fit clearance at the sleeve top / bottom (mm). */
const FIT_CLEAR_TOP = 0.05;
const FIT_CLEAR_BOTTOM = 0.15;

/* ------------------------------------------------------------------ */
/* 5×7 bitmap font (A–Z, 0–9, space, dash) — rows top→bottom, 5-bit,   */
/* MSB = leftmost pixel.                                               */
/* ------------------------------------------------------------------ */
const FONT_5X7: Record<string, number[]> = {
	A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
	B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
	C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
	D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
	E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
	F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
	G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
	H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
	I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
	J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
	K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
	L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
	M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
	N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
	O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
	P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
	Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
	R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
	S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
	T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
	U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
	V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
	W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
	X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
	Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
	Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
	'0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
	'1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
	'2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
	'3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
	'4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
	'5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
	'6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
	'7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
	'8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
	'9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
	'-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
	' ': [0, 0, 0, 0, 0, 0, 0]
};

const LABEL_HEIGHT_DEFAULT = 3;
const LABEL_DEPTH_DEFAULT = 0.8;

/** Normalize label text to the supported character set (others → space). */
function normalizeLabelText(text: string): string {
	return text
		.toUpperCase()
		.split('')
		.map((ch) => (FONT_5X7[ch] ? ch : ' '))
		.join('');
}

/** Width in mm of a rendered label (glyph 5 cells + 1 cell spacing). */
export function labelWidth(label: GuideLabel): number {
	const text = normalizeLabelText(label.text);
	if (text.length === 0) return 0;
	const cell = (label.height ?? LABEL_HEIGHT_DEFAULT) / 7;
	return (text.length * 6 - 1) * cell;
}

/** Returns a tester: is the label pixel at world (px,py) lit? */
function makeLabelTester(label: GuideLabel): (px: number, py: number) => boolean {
	const text = normalizeLabelText(label.text);
	const cell = (label.height ?? LABEL_HEIGHT_DEFAULT) / 7;
	const cols = text.length * 6 - 1;
	return (px: number, py: number): boolean => {
		const u = (px - label.x) / cell;
		const v = (py - label.y) / cell;
		if (u < 0 || u >= cols || v < 0 || v >= 7) return false;
		const ci = Math.floor(u / 6);
		const gc = Math.floor(u - ci * 6);
		if (gc >= 5) return false;
		const glyph = FONT_5X7[text[ci]];
		if (!glyph) return false;
		const gr = 6 - Math.floor(v); // glyph rows stored top→bottom
		return ((glyph[gr] >> (4 - gc)) & 1) === 1;
	};
}

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

/** Even-odd ray-cast point-in-polygon test in xy. */
function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const yi = poly[i].y;
		const yj = poly[j].y;
		if (yi > py === yj > py) continue;
		const xCross = poly[j].x + ((py - yj) / (yi - yj)) * (poly[i].x - poly[j].x);
		if (px < xCross) inside = !inside;
	}
	return inside;
}

/** Connector capsule radius between consecutive implants. */
function connectorRadius(regionRadius: number, largeConnectors: boolean): number {
	return regionRadius * (largeConnectors ? 1.0 : 0.5);
}

/** Implant heads ordered by angle around their xy centroid (dental arch order). */
function archSegments(heads: Vec3[]): Array<[Vec3, Vec3]> {
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
	return segments;
}

/**
 * Generate a surgical drill guide body mesh from a surface scan and the
 * planned implants. Returns a triangle soup (positions/normals, length
 * divisible by 9) in volume-local mm.
 *
 * @param scanPositions     triangle soup of the surface scan, scan-local mm
 * @param scanTransform     scan→volume transform (null = identity)
 * @param implants          planned implants with their guide sleeves
 * @param params            optional generation parameters (see GuideParams)
 * @param intaglioPositions optional second triangle soup (dual-scan denture
 *                          bottom) in the SAME space as scanPositions; its
 *                          surface contributes to the intaglio heightfield
 *                          while the primary scan still defines the footprint
 *                          clip rectangle.
 */
export function generateGuide(
	scanPositions: Float32Array,
	scanTransform: Mat4 | null,
	implants: GuideImplant[],
	params?: GuideParams,
	intaglioPositions?: Float32Array | null
): GuideMesh {
	const offset = params?.offset ?? 0.15;
	const thickness = params?.thickness ?? 2.5;
	const regionRadius = params?.regionRadius ?? 9;
	const voxel = params?.voxel ?? 0.3;
	const mountWall = params?.mountWall ?? 1.6;
	const largeConnectors = params?.largeConnectors ?? false;
	const fitForm = params?.mountHoleShape === 'fitForm';
	const supportRegions = params?.supportRegions ?? [];
	const contactPolygons = (params?.contactPolygons ?? []).filter((p) => p.length >= 3);
	const reductionBars = (params?.reductionBars ?? []).filter(
		(b) => b.width > 0 && b.height > 0 && Number.isFinite(b.zTop)
	);
	const label =
		params?.label && normalizeLabelText(params.label.text).trim().length > 0
			? params.label
			: null;
	const labelDepth = label ? (label.depth ?? LABEL_DEPTH_DEFAULT) : 0;
	const labelHeight = label ? (label.height ?? LABEL_HEIGHT_DEFAULT) : 0;

	if (implants.length === 0 || scanPositions.length < 9) return emptyMesh();

	/* ---- 1. transform scan vertices into volume space ---- */
	const applyXf = (src: Float32Array): Float32Array => {
		if (!scanTransform) return src;
		const out = new Float32Array(src.length);
		for (let i = 0; i + 2 < src.length; i += 3) {
			const p = applyMat4(scanTransform, { x: src[i], y: src[i + 1], z: src[i + 2] });
			out[i] = p.x;
			out[i + 1] = p.y;
			out[i + 2] = p.z;
		}
		return out;
	};
	const pts = applyXf(scanPositions);
	// Dual-scan approximation: instead of a separate intaglio surface pass, the
	// second mesh (denture bottom) is merged with the primary scan for the
	// heightfield sampling below — per xy column the HIGHER of the two surfaces
	// defines the seating surface. The footprint clip rectangle is still taken
	// from the primary scan only, so the denture mesh cannot grow the guide
	// outside the scanned anatomy.
	const intaglio =
		intaglioPositions && intaglioPositions.length >= 9 ? applyXf(intaglioPositions) : null;

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
	// Explicit connector strips between consecutive implants (sorted by angle
	// around the xy centroid of the heads, matching a dental arch) so
	// multi-implant guides form one body. Strip radius is regionRadius/2, or
	// the full regionRadius with "use large connectors".
	const segments = archSegments(heads);
	const connR = connectorRadius(regionRadius, largeConnectors);
	const connR2 = connR * connR;

	// Region bbox: implant discs union plus support regions, contact polygons,
	// label block and reduction bars — clipped to the scan xy bbox + margin.
	const clipMinX = scanMinX - SCAN_CLIP_MARGIN;
	const clipMaxX = scanMaxX + SCAN_CLIP_MARGIN;
	const clipMinY = scanMinY - SCAN_CLIP_MARGIN;
	const clipMaxY = scanMaxY + SCAN_CLIP_MARGIN;
	let rMinX = Infinity;
	let rMaxX = -Infinity;
	let rMinY = Infinity;
	let rMaxY = -Infinity;
	const grow = (x: number, y: number, r: number): void => {
		rMinX = Math.min(rMinX, x - r);
		rMaxX = Math.max(rMaxX, x + r);
		rMinY = Math.min(rMinY, y - r);
		rMaxY = Math.max(rMaxY, y + r);
	};
	for (const h of heads) grow(h.x, h.y, regionRadius);
	for (const s of supportRegions) grow(s.x, s.y, s.radius);
	for (const poly of contactPolygons) for (const p of poly) grow(p.x, p.y, 0);
	for (const b of reductionBars) {
		grow(b.x1, b.y1, b.width / 2);
		grow(b.x2, b.y2, b.width / 2);
	}
	if (label) {
		grow(label.x, label.y, 0);
		grow(label.x + labelWidth(label), label.y + labelHeight, 0);
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
	// of an implant head, within connR of a connector segment, inside a bone
	// support circle, or inside a free-hand contact polygon.
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
					if (pointSegDist2Sq(px, py, a.x, a.y, b.x, b.y) <= connR2) {
						inside = true;
						break;
					}
				}
			}
			if (!inside) {
				for (const s of supportRegions) {
					const dx = px - s.x;
					const dy = py - s.y;
					if (dx * dx + dy * dy <= s.radius * s.radius) {
						inside = true;
						break;
					}
				}
			}
			if (!inside) {
				for (const poly of contactPolygons) {
					if (pointInPolygon(px, py, poly)) {
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
	// and test with barycentric coordinates. Run over the primary scan and, for
	// dual-scan guides, additionally over the denture-bottom mesh (see above).
	const zSurf = new Float32Array(nx * ny).fill(-Infinity);
	const sampleSoup = (soup: Float32Array): void => {
		for (let t = 0; t + 8 < soup.length; t += 9) {
			const x0 = soup[t];
			const y0 = soup[t + 1];
			const z0 = soup[t + 2];
			const x1 = soup[t + 3];
			const y1 = soup[t + 4];
			const z1 = soup[t + 5];
			const x2 = soup[t + 6];
			const y2 = soup[t + 7];
			const z2 = soup[t + 8];

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
	};
	sampleSoup(pts);
	if (intaglio) sampleSoup(intaglio);

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

	let topZ = maxZSurf + offset + thickness + labelDepth;
	for (const st of sleeveTops) {
		topZ = Math.max(topZ, st.z + MOUNT_TOP_MARGIN);
	}
	let bottomZ = minZSurf + offset;
	for (const b of reductionBars) {
		topZ = Math.max(topZ, b.zTop);
		bottomZ = Math.min(bottomZ, b.zTop - b.height);
	}
	const zLo = bottomZ - pad;
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

	// 4a'. embossed label: extrude lit font pixels OUTWARD (+z) from the cap top
	// surface so the text stands raised ~labelDepth above the guide.
	if (label) {
		const lit = makeLabelTester(label);
		const li0 = Math.max(0, Math.floor((label.x - ox) / voxel));
		const li1 = Math.min(nx - 1, Math.ceil((label.x + labelWidth(label) - ox) / voxel));
		const lj0 = Math.max(0, Math.floor((label.y - oy) / voxel));
		const lj1 = Math.min(ny - 1, Math.ceil((label.y + labelHeight - oy) / voxel));
		for (let j = lj0; j <= lj1; j++) {
			const py = oy + j * voxel;
			const row = j * nx;
			for (let i = li0; i <= li1; i++) {
				const idx2 = row + i;
				if (mask[idx2] === 0) continue;
				const zs = zSurf[idx2];
				if (zs === -Infinity) continue;
				const px = ox + i * voxel;
				if (!lit(px, py)) continue;
				const capTop = zs + offset + thickness;
				const k0 = Math.max(0, Math.ceil((capTop - zLo) / voxel) - 1); // overlap the cap
				const k1 = Math.min(nz - 1, Math.floor((capTop + labelDepth - zLo) / voxel));
				for (let k = k0; k <= k1; k++) {
					grid[k * nxny + idx2] = BODY;
				}
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

	// 4c. bone reduction bars: solid rectangular bars (boxes oriented along the
	// bar segment) merged into the body. The bar's bottom face marks the
	// planned bone-reduction level (cut flush with the bar underside).
	for (const b of reductionBars) {
		const halfW = b.width / 2;
		const halfW2 = halfW * halfW;
		const i0 = Math.max(0, Math.floor((Math.min(b.x1, b.x2) - halfW - ox) / voxel));
		const i1 = Math.min(nx - 1, Math.ceil((Math.max(b.x1, b.x2) + halfW - ox) / voxel));
		const j0 = Math.max(0, Math.floor((Math.min(b.y1, b.y2) - halfW - oy) / voxel));
		const j1 = Math.min(ny - 1, Math.ceil((Math.max(b.y1, b.y2) + halfW - oy) / voxel));
		const k0 = Math.max(0, Math.ceil((b.zTop - b.height - zLo) / voxel));
		const k1 = Math.min(nz - 1, Math.floor((b.zTop - zLo) / voxel));
		for (let j = j0; j <= j1; j++) {
			const py = oy + j * voxel;
			for (let i = i0; i <= i1; i++) {
				const px = ox + i * voxel;
				if (pointSegDist2Sq(px, py, b.x1, b.y1, b.x2, b.y2) > halfW2) continue;
				const idx2 = j * nx + i;
				for (let k = k0; k <= k1; k++) {
					grid[k * nxny + idx2] = BODY;
				}
			}
		}
	}

	// 5. drill channels: clear everything within the bore radius of the
	// (infinite) implant axis line from the head z up to the grid top, so each
	// sleeve seat is an open cylinder through the whole guide.
	// 'fitForm' hole shape: the bore follows the sleeve with a press-fit
	// clearance — approximated as a cone widening from sleeve top (+0.05mm)
	// to sleeve bottom (+0.15mm); outside the sleeve span the end clearances
	// continue unchanged.
	for (let m = 0; m < implants.length; m++) {
		const h = heads[m];
		const u = axes[m];
		const r = implants[m].sleeve.diameter / 2;
		const so = implants[m].sleeve.offset;
		const sh = Math.max(implants[m].sleeve.height, 1e-6);
		const rMaxEff = fitForm ? r + FIT_CLEAR_BOTTOM : r;
		const kFrom = Math.max(0, Math.ceil((h.z - zLo) / voxel));
		const halfWidth = rMaxEff / Math.max(Math.abs(u.z), 0.2) + voxel;
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
					let rEff = r;
					if (fitForm) {
						// axial position above the head, 0 at sleeve bottom → 1 at top
						const frac = Math.min(1, Math.max(0, (-proj - so) / sh));
						rEff = r + FIT_CLEAR_BOTTOM + (FIT_CLEAR_TOP - FIT_CLEAR_BOTTOM) * frac;
					}
					if (dSq <= rEff * rEff) grid[row + i] = 0;
				}
			}
		}
	}

	// 5b. inspection windows: vertical cylindrical cutouts through the full height.
	for (const w of params?.windows ?? []) {
		const r = w.diameter / 2;
		const rSq = r * r;
		const i0 = Math.max(0, Math.floor((w.x - r - ox) / voxel));
		const i1 = Math.min(nx - 1, Math.ceil((w.x + r - ox) / voxel));
		const j0 = Math.max(0, Math.floor((w.y - r - oy) / voxel));
		const j1 = Math.min(ny - 1, Math.ceil((w.y + r - oy) / voxel));
		for (let k = 0; k < nz; k++) {
			const slab = k * nxny;
			for (let j = j0; j <= j1; j++) {
				const py = oy + j * voxel;
				const row = slab + j * nx;
				for (let i = i0; i <= i1; i++) {
					const px = ox + i * voxel;
					const dx = px - w.x;
					const dy = py - w.y;
					if (dx * dx + dy * dy <= rSq) grid[row + i] = 0;
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

/* ------------------------------------------------------------------ */
/* Design-rule validation                                              */
/* ------------------------------------------------------------------ */

/**
 * Check a guide design against basic manufacturability/safety rules and
 * return human-readable warnings (empty array = no findings).
 *
 * Rules: minimum 1.5mm wall around each sleeve mount, 0.5mm clearance
 * between sleeves, inspection windows must not cut into sleeve mounts,
 * labels must lie on the guide footprint, reduction bars must not cross
 * drill channels, and the generated mesh must not be empty.
 */
export function validateGuideDesign(
	implants: GuideImplant[],
	params: GuideParams | undefined,
	mesh: GuideMesh
): string[] {
	const warnings: string[] = [];
	const regionRadius = params?.regionRadius ?? 9;
	const mountWall = params?.mountWall ?? 1.6;
	const largeConnectors = params?.largeConnectors ?? false;

	if (mesh.triangles === 0) {
		warnings.push('Guide mesh is empty — no printable body was generated.');
	}

	// derived sleeve geometry (skip implants with a degenerate axis)
	const heads: Vec3[] = [];
	const bottoms: Vec3[] = [];
	const tops: Vec3[] = [];
	const axesU: Vec3[] = [];
	const outerR: number[] = [];
	for (let i = 0; i < implants.length; i++) {
		const imp = implants[i];
		const al = Math.hypot(imp.axis.x, imp.axis.y, imp.axis.z);
		if (al < 1e-9) {
			warnings.push(`Implant ${i + 1} has a degenerate axis — skipped from validation.`);
			continue;
		}
		const u = { x: imp.axis.x / al, y: imp.axis.y / al, z: imp.axis.z / al };
		heads.push({ x: imp.head.x, y: imp.head.y, z: imp.head.z });
		axesU.push(u);
		const so = imp.sleeve.offset;
		const st = imp.sleeve.offset + imp.sleeve.height;
		bottoms.push({ x: imp.head.x - u.x * so, y: imp.head.y - u.y * so, z: imp.head.z - u.z * so });
		tops.push({ x: imp.head.x - u.x * st, y: imp.head.y - u.y * st, z: imp.head.z - u.z * st });
		outerR.push(imp.sleeve.diameter / 2);
	}

	// 1. wall thickness around each sleeve: limited by the mount wall itself
	// and by the footprint radius beyond the sleeve outer radius.
	for (let i = 0; i < heads.length; i++) {
		const wall = Math.min(mountWall, regionRadius - outerR[i]);
		if (wall < 1.5) {
			warnings.push(
				`Sleeve ${i + 1}: wall is only ${wall.toFixed(2)} mm thick (sleeve outer ` +
					`radius ${outerR[i].toFixed(2)} mm + mount wall ${mountWall.toFixed(2)} mm vs ` +
					`region radius ${regionRadius.toFixed(2)} mm) — minimum 1.5 mm.`
			);
		}
	}

	// 2. sleeve-to-sleeve clearance ≥ 0.5mm (surface to surface).
	for (let i = 0; i < heads.length; i++) {
		for (let j = i + 1; j < heads.length; j++) {
			const gap = segSegDistance(bottoms[i], tops[i], bottoms[j], tops[j]) - outerR[i] - outerR[j];
			if (gap < 0.5) {
				warnings.push(
					gap < 0
						? `Sleeves ${i + 1} and ${j + 1} overlap by ${(-gap).toFixed(2)} mm.`
						: `Sleeves ${i + 1} and ${j + 1} are only ${gap.toFixed(2)} mm apart — minimum 0.5 mm.`
				);
			}
		}
	}

	// 3. inspection windows must not cut into a sleeve mount.
	for (const w of params?.windows ?? []) {
		for (let i = 0; i < heads.length; i++) {
			const d = Math.sqrt(
				pointSegDist2Sq(w.x, w.y, bottoms[i].x, bottoms[i].y, tops[i].x, tops[i].y)
			);
			if (d < w.diameter / 2 + outerR[i] + mountWall) {
				warnings.push(
					`Window at (${w.x.toFixed(1)}, ${w.y.toFixed(1)}) overlaps the sleeve mount ` +
						`of implant ${i + 1}.`
				);
			}
		}
	}

	// 4. label must lie on the guide footprint (centre inside an implant disc
	// or a connector strip; support regions / polygons also count).
	const label = params?.label;
	if (label && normalizeLabelText(label.text).trim().length > 0 && heads.length > 0) {
		const lh = label.height ?? LABEL_HEIGHT_DEFAULT;
		const lcx = label.x + labelWidth(label) / 2;
		const lcy = label.y + lh / 2;
		const connR = connectorRadius(regionRadius, largeConnectors);
		let inside = heads.some(
			(h) => (lcx - h.x) * (lcx - h.x) + (lcy - h.y) * (lcy - h.y) <= regionRadius * regionRadius
		);
		if (!inside) {
			inside = archSegments(heads).some(
				([a, b]) => pointSegDist2Sq(lcx, lcy, a.x, a.y, b.x, b.y) <= connR * connR
			);
		}
		if (!inside) {
			inside = (params?.supportRegions ?? []).some(
				(s) => (lcx - s.x) * (lcx - s.x) + (lcy - s.y) * (lcy - s.y) <= s.radius * s.radius
			);
		}
		if (!inside) {
			inside = (params?.contactPolygons ?? []).some(
				(poly) => poly.length >= 3 && pointInPolygon(lcx, lcy, poly)
			);
		}
		if (!inside) {
			warnings.push(`Label "${label.text}" lies outside the guide footprint.`);
		}
	}

	// 5. reduction bars must not intersect a drill channel.
	for (const b of params?.reductionBars ?? []) {
		for (let i = 0; i < heads.length; i++) {
			const h = heads[i];
			const u = axesU[i];
			const reach = outerR[i] + b.width / 2;
			let hit = false;
			// sample the channel centre at the bar's top, middle and bottom z
			for (const z of [b.zTop, b.zTop - b.height / 2, b.zTop - b.height]) {
				const tAx = Math.abs(u.z) > 1e-6 ? (z - h.z) / u.z : 0;
				const ccx = h.x + u.x * tAx;
				const ccy = h.y + u.y * tAx;
				if (pointSegDist2Sq(ccx, ccy, b.x1, b.y1, b.x2, b.y2) <= reach * reach) {
					hit = true;
					break;
				}
			}
			if (hit) {
				warnings.push(
					`Reduction bar (${b.x1.toFixed(1)}, ${b.y1.toFixed(1)})→(${b.x2.toFixed(1)}, ` +
						`${b.y2.toFixed(1)}) intersects the drill channel of implant ${i + 1}.`
				);
			}
		}
	}

	return warnings;
}

/* ------------------------------------------------------------------ */
/* Recipe presets (SPEC §9.11 — specialized guide recipes)             */
/* ------------------------------------------------------------------ */

export interface GuideRecipe {
	key: string;
	name: string;
	description: string;
	params: GuideParams;
}

export const GUIDE_RECIPES: GuideRecipe[] = [
	{
		key: 'standard',
		name: 'Standard (tooth-supported)',
		description:
			'Default drill guide: matched model scan, contact surfaces at the implant ' +
			'positions, sleeve mounts for all sleeves, automatic connectors.',
		params: {}
	},
	{
		key: 'endodontic',
		name: 'Endodontic guide',
		description:
			'Endodontic drill + its sleeve; contact surfaces on the treated teeth; place ' +
			'inspection windows BELOW the sleeves. Requires a straight drill path to the canal.',
		params: { regionRadius: 6, thickness: 2 }
	},
	{
		key: 'apicoectomy',
		name: 'Apicoectomy guide',
		description:
			'Bone reduction guide with inverted profile and a vestibular-only bar; ' +
			'use large connectors (bar W 3.9–4.0 / H 3.0–4.0 / offset 0.5–1.0 mm).',
		params: { largeConnectors: true }
	},
	{
		key: 'sinusLift',
		name: 'External sinus lift',
		description:
			'Bone support regions + cut profile defining the bone window opening region; ' +
			'use large connectors (bar W 3.0–4.0 / H 3.0–4.0 / offset 0.5–1.5 mm).',
		params: { largeConnectors: true }
	},
	{
		key: 'stacked',
		name: 'Stacked guide',
		description:
			'Convert the bone-reduction guide to a 3D model and use it as the wizard base; ' +
			'unselect pin sleeves, place spheres on the pin-hole surfaces, draw the front ' +
			'edge contact, use large connectors. Warning: stacked guides must be ' +
			'pin-supported, never purely bone-supported.',
		params: { largeConnectors: true }
	},
	{
		key: 'transplant',
		name: 'Tooth auto-transplantation (evaluation)',
		description:
			'Donor-tooth segmentation converted to a 3D model and positioned at the ' +
			'recipient site; the guide is used to evaluate the prepared site before ' +
			'transplantation.',
		params: {}
	}
];
