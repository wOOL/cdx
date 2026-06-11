/**
 * Custom sleeve systems: validation, DB row mapping, planning glyph metadata
 * and calibration-matrix mesh generation.
 *
 * Storage (table `custom_sleeves`, migration 14): rows are
 *   { id, name, data TEXT (JSON), created_at }.
 * The `data` JSON holds everything beyond the name:
 *   {
 *     manufacturer: string,
 *     notes: string,
 *     segments: SleeveSegment[]   // 1–3 stacked conical segments (negative geometry)
 *     drillOffset: number         // mm, sleeve-bottom -> drill-stop
 *   }
 *
 * A segment is an axially symmetric truncated cone of the HOLE the guide
 * generator subtracts ("negative geometry"). `distanceToZeroLevel` is measured
 * from the sleeve zero level (= sleeve bottom) to the segment's lower rim and
 * may be 0 or negative (a hole extending below the sleeve bottom). The segment
 * spans z in [distanceToZeroLevel, distanceToZeroLevel + height] with
 * lowerDiameter at the bottom rim and upperDiameter at the top rim.
 */

import { db } from './db';
import { marchingCubes } from './marchingCubes';

export interface SleeveSegment {
	/** segment height (mm) */
	height: number;
	/** diameter at the segment's upper rim (mm) */
	upperDiameter: number;
	/** diameter at the segment's lower rim (mm) */
	lowerDiameter: number;
	/** lower rim -> sleeve zero level (= sleeve bottom), mm; 0 or negative allowed */
	distanceToZeroLevel: number;
}

export interface CustomSleeveSystem {
	id: number;
	name: string;
	manufacturer: string;
	notes: string;
	segments: SleeveSegment[];
	/** mm from sleeve bottom to the drill stop */
	drillOffset: number;
	created_at: string;
}

/** Validated payload ready to be stored in custom_sleeves.data. */
export interface SleeveSystemInput {
	name: string;
	manufacturer: string;
	notes: string;
	segments: SleeveSegment[];
	drillOffset: number;
}

// ---------------- validation ----------------

export const SEGMENTS_MIN = 1;
export const SEGMENTS_MAX = 3;
/** height / upperØ / lowerØ allowed range (mm) */
export const DIM_MIN = 0.5;
export const DIM_MAX = 20;
/** distance-to-zero-level allowed range (mm) — may be 0 / negative */
export const DIST_MIN = -20;
export const DIST_MAX = 20;
/** sum of segment heights allowed range (mm) */
export const HEIGHT_SUM_MIN = 2;
export const HEIGHT_SUM_MAX = 15;
/** drill offset allowed range (mm) */
export const DRILL_OFFSET_MIN = 0;
export const DRILL_OFFSET_MAX = 30;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Validate an untrusted create/update payload. Returns the normalized value
 * (trimmed strings, numbers rounded to 0.01 mm) or an error message.
 */
export function validateSleeveSystem(
	input: unknown
): { ok: true; value: SleeveSystemInput } | { ok: false; error: string } {
	if (typeof input !== 'object' || input === null) {
		return { ok: false, error: 'Body must be a JSON object' };
	}
	const o = input as Record<string, unknown>;

	const name = typeof o.name === 'string' ? o.name.trim() : '';
	if (!name) return { ok: false, error: 'Name is required' };
	if (name.length > 80) return { ok: false, error: 'Name must be at most 80 characters' };

	const manufacturer = typeof o.manufacturer === 'string' ? o.manufacturer.trim().slice(0, 120) : '';
	const notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 2000) : '';

	if (!Array.isArray(o.segments)) return { ok: false, error: 'segments must be an array' };
	if (o.segments.length < SEGMENTS_MIN || o.segments.length > SEGMENTS_MAX) {
		return { ok: false, error: `segments: ${SEGMENTS_MIN}–${SEGMENTS_MAX} segments required` };
	}

	const segments: SleeveSegment[] = [];
	let heightSum = 0;
	for (let i = 0; i < o.segments.length; i++) {
		const s = o.segments[i] as Record<string, unknown>;
		if (typeof s !== 'object' || s === null) {
			return { ok: false, error: `segment ${i + 1}: must be an object` };
		}
		const height = Number(s.height);
		const upperDiameter = Number(s.upperDiameter);
		const lowerDiameter = Number(s.lowerDiameter);
		const distanceToZeroLevel = Number(s.distanceToZeroLevel);
		for (const [label, v] of [
			['height', height],
			['upperDiameter', upperDiameter],
			['lowerDiameter', lowerDiameter]
		] as const) {
			if (!Number.isFinite(v) || v < DIM_MIN || v > DIM_MAX) {
				return {
					ok: false,
					error: `segment ${i + 1}: ${label} must be ${DIM_MIN}–${DIM_MAX} mm`
				};
			}
		}
		if (
			!Number.isFinite(distanceToZeroLevel) ||
			distanceToZeroLevel < DIST_MIN ||
			distanceToZeroLevel > DIST_MAX
		) {
			return {
				ok: false,
				error: `segment ${i + 1}: distanceToZeroLevel must be ${DIST_MIN}–${DIST_MAX} mm`
			};
		}
		heightSum += height;
		segments.push({
			height: round2(height),
			upperDiameter: round2(upperDiameter),
			lowerDiameter: round2(lowerDiameter),
			distanceToZeroLevel: round2(distanceToZeroLevel)
		});
	}
	if (heightSum < HEIGHT_SUM_MIN || heightSum > HEIGHT_SUM_MAX) {
		return {
			ok: false,
			error: `sum of segment heights must be ${HEIGHT_SUM_MIN}–${HEIGHT_SUM_MAX} mm (got ${round2(heightSum)})`
		};
	}

	const drillOffset = o.drillOffset == null ? 0 : Number(o.drillOffset);
	if (!Number.isFinite(drillOffset) || drillOffset < DRILL_OFFSET_MIN || drillOffset > DRILL_OFFSET_MAX) {
		return { ok: false, error: `drillOffset must be ${DRILL_OFFSET_MIN}–${DRILL_OFFSET_MAX} mm` };
	}

	return {
		ok: true,
		value: { name, manufacturer, notes, segments, drillOffset: round2(drillOffset) }
	};
}

// ---------------- DB row mapping ----------------

export interface CustomSleeveRow {
	id: number;
	name: string;
	data: string;
	created_at: string;
}

/** Map a custom_sleeves row to a system; tolerates malformed JSON. */
export function rowToSystem(row: CustomSleeveRow): CustomSleeveSystem {
	let data: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(row.data);
		if (typeof parsed === 'object' && parsed !== null) data = parsed;
	} catch {
		data = {};
	}
	const segments = Array.isArray(data.segments) ? (data.segments as SleeveSegment[]) : [];
	return {
		id: row.id,
		name: row.name,
		manufacturer: typeof data.manufacturer === 'string' ? data.manufacturer : '',
		notes: typeof data.notes === 'string' ? data.notes : '',
		segments,
		drillOffset: Number.isFinite(Number(data.drillOffset)) ? Number(data.drillOffset) : 0,
		created_at: row.created_at
	};
}

/**
 * Used heuristic: a system is "in use" when any implant's sleeve JSON carries
 * its systemId. Pass the raw sleeve JSON strings of all implants.
 */
export function collectUsedSystemIds(sleeveJsons: string[]): Set<number> {
	const used = new Set<number>();
	for (const s of sleeveJsons) {
		if (!s || !s.includes('systemId')) continue;
		try {
			const v = JSON.parse(s) as { systemId?: unknown };
			const id = Number(v?.systemId);
			if (Number.isInteger(id) && id > 0) used.add(id);
		} catch {
			// ignore malformed sleeve JSON
		}
	}
	return used;
}

/** Append " (2)" / " (3)" … until `name` is not in `taken`. Registers the result. */
export function dedupeName(name: string, taken: Set<string>): string {
	let candidate = name;
	for (let n = 2; taken.has(candidate); n++) candidate = `${name} (${n})`;
	taken.add(candidate);
	return candidate;
}

// ---------------- DB access ----------------

export function listSystems(): CustomSleeveSystem[] {
	const rows = db.query('SELECT * FROM custom_sleeves ORDER BY id').all() as CustomSleeveRow[];
	return rows.map(rowToSystem);
}

export function getSystem(id: number): CustomSleeveSystem | null {
	const row = db.query('SELECT * FROM custom_sleeves WHERE id = ?1').get(id) as
		| CustomSleeveRow
		| null;
	return row ? rowToSystem(row) : null;
}

export function insertSystem(value: SleeveSystemInput): CustomSleeveSystem {
	const data = JSON.stringify({
		manufacturer: value.manufacturer,
		notes: value.notes,
		segments: value.segments,
		drillOffset: value.drillOffset
	});
	const row = db
		.query('INSERT INTO custom_sleeves (name, data) VALUES (?1, ?2) RETURNING *')
		.get(value.name, data) as CustomSleeveRow;
	return rowToSystem(row);
}

export function updateSystem(id: number, value: SleeveSystemInput): CustomSleeveSystem | null {
	const data = JSON.stringify({
		manufacturer: value.manufacturer,
		notes: value.notes,
		segments: value.segments,
		drillOffset: value.drillOffset
	});
	const row = db
		.query('UPDATE custom_sleeves SET name = ?2, data = ?3 WHERE id = ?1 RETURNING *')
		.get(id, value.name, data) as CustomSleeveRow | null;
	return row ? rowToSystem(row) : null;
}

/** Ids of systems referenced by any implant's sleeve JSON (`"systemId":<id>`). */
export function usedSystemIds(): Set<number> {
	const rows = db
		.query(`SELECT sleeve FROM implants WHERE sleeve LIKE '%systemId%'`)
		.all() as { sleeve: string }[];
	return collectUsedSystemIds(rows.map((r) => r.sleeve));
}

// ---------------- per-printer scale factors ----------------

/** Settings key holding the named printer scale-factor map (JSON). */
export const PRINTER_SCALES_KEY = 'sleeve_printer_scales';

export function getPrinterScales(): Record<string, number> {
	const row = db
		.query('SELECT value FROM settings WHERE key = ?1')
		.get(PRINTER_SCALES_KEY) as { value: string } | null;
	if (!row) return {};
	try {
		const parsed = JSON.parse(row.value) as Record<string, unknown>;
		const out: Record<string, number> = {};
		if (typeof parsed === 'object' && parsed !== null) {
			for (const [k, v] of Object.entries(parsed)) {
				const n = Number(v);
				if (k && Number.isFinite(n)) out[k] = n;
			}
		}
		return out;
	} catch {
		return {};
	}
}

// ---------------- planning glyph metadata ----------------

/**
 * Map a custom system to the implant sleeve JSON shape consumed by the guide
 * generator ({ diameter, height, offset } + systemId provenance).
 *
 * Without segmentIndex the whole negative geometry is summarized:
 * outer diameter = max upper Ø across segments, height = sum of segment
 * heights, offset = distanceToZeroLevel of segment 1. With segmentIndex the
 * single segment is mapped instead (diameter = its upper Ø).
 */
export function systemToSleeveJson(
	sys: Pick<CustomSleeveSystem, 'id' | 'segments'>,
	segmentIndex?: number
): { diameter: number; height: number; offset: number; systemId: number } {
	const segs = sys.segments;
	if (segmentIndex != null && segs[segmentIndex]) {
		const s = segs[segmentIndex];
		return {
			diameter: s.upperDiameter,
			height: s.height,
			offset: s.distanceToZeroLevel,
			systemId: sys.id
		};
	}
	let maxUpper = 0;
	let heightSum = 0;
	for (const s of segs) {
		if (s.upperDiameter > maxUpper) maxUpper = s.upperDiameter;
		heightSum += s.height;
	}
	return {
		diameter: round2(maxUpper),
		height: round2(heightSum),
		offset: segs.length ? segs[0].distanceToZeroLevel : 0,
		systemId: sys.id
	};
}

// ---------------- calibration matrix plate ----------------

export const PLATE_X = 60; // mm
export const PLATE_Y = 40; // mm
export const PLATE_Z = 3; // mm
export const BORE_COLS = 4;
export const BORE_ROWS = 3;

/** 12 bore scale factors, evenly spaced over 0.98–1.04 (one per grid cell). */
export const CALIBRATION_SCALES: number[] = Array.from(
	{ length: BORE_COLS * BORE_ROWS },
	(_, i) => 0.98 + (i * (1.04 - 0.98)) / (BORE_COLS * BORE_ROWS - 1)
);

const VOXEL = 0.2; // mm
const MARGIN = 0.7; // mm of empty space around the solid (off-grid => clean MC faces)
const NOTCH = 4; // mm — 45° chamfer cut at the (0,0) corner for orientation

/**
 * Build the calibration plate triangle soup (mm): a 60×40×3 base plate with a
 * 4×3 grid of through-bores. Bore k has diameter
 *   boreDiameter * CALIBRATION_SCALES[k] * globalScale,
 * so the printed plate lets the user pick which scale fits their printer.
 * One corner (min-x / min-y) carries a chamfer notch for orientation.
 *
 * Implementation: voxelize a sign-correct inside-positive distance field at
 * 0.2 mm and run marching cubes at iso 0 — robust CSG without mesh booleans.
 */
export function buildCalibrationPlate(boreDiameter: number, globalScale = 1): Float32Array {
	const nx = Math.ceil((PLATE_X + 2 * MARGIN) / VOXEL) + 1;
	const ny = Math.ceil((PLATE_Y + 2 * MARGIN) / VOXEL) + 1;
	const nz = Math.ceil((PLATE_Z + 2 * MARGIN) / VOXEL) + 1;

	// bore centers (plate-local mm) and radii
	const centers: { x: number; y: number; r: number }[] = [];
	for (let row = 0; row < BORE_ROWS; row++) {
		for (let col = 0; col < BORE_COLS; col++) {
			const k = row * BORE_COLS + col;
			centers.push({
				x: (PLATE_X / (BORE_COLS + 1)) * (col + 1),
				y: (PLATE_Y / (BORE_ROWS + 1)) * (row + 1),
				r: (boreDiameter * CALIBRATION_SCALES[k] * globalScale) / 2
			});
		}
	}

	// 2D inside-positive distance per (x, y) column: plate outline minus
	// through-bores minus the corner chamfer (all are full-height cuts).
	const SQRT1_2 = Math.SQRT1_2;
	const colDist = new Float64Array(nx * ny);
	for (let yi = 0; yi < ny; yi++) {
		const ly = yi * VOXEL - MARGIN;
		for (let xi = 0; xi < nx; xi++) {
			const lx = xi * VOXEL - MARGIN;
			let d = Math.min(lx, PLATE_X - lx, ly, PLATE_Y - ly);
			for (const c of centers) {
				const hole = Math.hypot(lx - c.x, ly - c.y) - c.r; // negative inside the bore
				if (hole < d) d = hole;
			}
			const chamfer = (lx + ly - NOTCH) * SQRT1_2; // negative inside the notch cut
			if (chamfer < d) d = chamfer;
			colDist[yi * nx + xi] = d;
		}
	}

	// 3D field: clamp to ±1.5 mm and quantize to micro-metres (Int16-safe).
	const data = new Int16Array(nx * ny * nz);
	const nxny = nx * ny;
	for (let zi = 0; zi < nz; zi++) {
		const lz = zi * VOXEL - MARGIN;
		const dz = Math.min(lz, PLATE_Z - lz);
		const zOff = zi * nxny;
		for (let i = 0; i < nxny; i++) {
			let d = colDist[i];
			if (dz < d) d = dz;
			if (d > 1.5) d = 1.5;
			else if (d < -1.5) d = -1.5;
			data[zOff + i] = Math.round(d * 1000);
		}
	}

	const { positions } = marchingCubes(data, [nx, ny, nz], [VOXEL, VOXEL, VOXEL], 0);
	return positions;
}
