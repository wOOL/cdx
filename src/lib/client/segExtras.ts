/**
 * Client helpers for the extended segmentation features (Scanview aux tools):
 * polygon area measurement, measurement-grid overlay, and the API type
 * definitions for boundaries / slots / LOD presets / propagation.
 *
 * Pure module — no fetches, no state; the case page wires it to the API:
 *   GET/PUT  /api/datasets/:id/mask/boundaries          BoundarySet
 *   POST     /api/datasets/:id/mask/boundaries/from-model { modelId, mode? }
 *   POST     /api/datasets/:id/mask/propagate           { from,to,lo,hi } → PropagateResult
 *   POST     /api/datasets/:id/mask/undo|redo           → UndoResult
 *   GET      /api/datasets/:id/mask/stats               → MaskStats
 *   GET/PATCH /api/datasets/:id/mask/slots              → { slots: SlotInfo[] }
 *   GET/POST/PATCH/DELETE /api/seg-lod                  → LodPreset CRUD
 * All mask endpoints accept ?slot=<name> (default 'main').
 */

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

export interface BoundaryPoint {
	x: number;
	y: number;
}

/** one closed polyline, slice pixel coordinates */
export type BoundaryPolyline = BoundaryPoint[];

/** sliceIndex → closed polylines (the GET/PUT /mask/boundaries payload) */
export type BoundarySet = Record<number, BoundaryPolyline[]>;

export type SlotRole = 'target' | 'source' | 'exclude' | 'none';

/** entry of GET /mask/slots; precedence when editing: exclude > source > boundaries */
export interface SlotInfo {
	name: string;
	voxels: number;
	role: SlotRole;
}

export interface MaskStats {
	voxels: number;
	/** voxels × voxel volume (mm³) / 1000 */
	ml: number;
}

export interface PropagateSliceResult {
	index: number;
	/** pixels newly set on this slice */
	changed: number;
	/** total set pixels on this slice afterwards */
	voxels: number;
}

export interface PropagateResult {
	slices: PropagateSliceResult[];
	/** slice indices whose voxel count changed by >40% vs the previous slice ("check slice N") */
	warnings: number[];
}

export interface UndoResult {
	ok: boolean;
	/** slot the undone/redone patch belonged to (when ok) */
	slot?: string;
	/** affected axial slice indices — invalidate these mask slices */
	slices: number[];
	/** remaining steps */
	undo: number;
	redo: number;
}

export type LodResolution = 'full' | 'half';

export interface LodParams {
	resolution: LodResolution;
	/** Laplacian smoothing passes 0–3 */
	smoothing: number;
	/** decimation strength 0–0.9 */
	reduction: number;
	/** 1 = drop mask components < 50 voxels */
	noise: 0 | 1;
}

export interface LodPreset extends LodParams {
	id: string;
	name: string;
	isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Area measurement (trace outline → cm²)
// ---------------------------------------------------------------------------

/**
 * Area of a traced polygon in cm². `points` are slice pixel coordinates,
 * spacing the pixel size in mm. Shoelace formula × pixel area; the polygon is
 * treated as closed (last→first edge implied). Self-intersecting outlines
 * yield the net (signed-sum) area, like the desktop tool.
 */
export function areaCm2(
	points: readonly BoundaryPoint[],
	spacingX: number,
	spacingY: number
): number {
	if (points.length < 3) return 0;
	let sum2 = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		sum2 += a.x * b.y - b.x * a.y;
	}
	const areaPx = Math.abs(sum2) / 2;
	const areaMm2 = areaPx * spacingX * spacingY;
	return areaMm2 / 100; // 1 cm² = 100 mm²
}

// ---------------------------------------------------------------------------
// Measurement-grid overlay (mm)
// ---------------------------------------------------------------------------

/**
 * Draw the Scanview measurement grid over a 2D view.
 *
 * @param ctx     target canvas context (drawn over the slice image)
 * @param w       canvas width in px
 * @param h       canvas height in px
 * @param mmPerPx current view scale (mm represented by one canvas pixel)
 * @param spacing grid pitch in mm (e.g. 1); every 5th line is emphasized
 *
 * Lines are anchored at the canvas origin. Skips drawing when the pitch would
 * be denser than 4 canvas px to keep the overlay readable while zoomed out.
 */
export function gridOverlayDraw(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	mmPerPx: number,
	spacing = 1
): void {
	if (!(mmPerPx > 0) || !(spacing > 0)) return;
	const stepPx = spacing / mmPerPx;
	if (stepPx < 4) return;

	ctx.save();
	ctx.lineWidth = 1;
	for (let i = 0, x = 0; x <= w; i++, x = i * stepPx) {
		ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,160,0.35)' : 'rgba(255,255,160,0.15)';
		ctx.beginPath();
		const px = Math.round(x) + 0.5;
		ctx.moveTo(px, 0);
		ctx.lineTo(px, h);
		ctx.stroke();
	}
	for (let i = 0, y = 0; y <= h; i++, y = i * stepPx) {
		ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,160,0.35)' : 'rgba(255,255,160,0.15)';
		ctx.beginPath();
		const py = Math.round(y) + 0.5;
		ctx.moveTo(0, py);
		ctx.lineTo(w, py);
		ctx.stroke();
	}
	ctx.restore();
}
