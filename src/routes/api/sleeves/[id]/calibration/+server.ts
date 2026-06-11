/**
 * Calibration matrix STL for a custom sleeve system.
 *
 * GET /api/sleeves/[id]/calibration?scale=100&printer=<name>
 *   -> binary STL download of a 60×40×3 mm plate with a 4×3 grid of test
 *      bores. Bores use the system's segment-1 lower diameter scaled by
 *      factors 0.98–1.04 across the grid; a chamfered corner marks the
 *      0.98-factor corner for orientation. Print it, pick the bore the real
 *      sleeve fits best, and use that scale for your printer.
 *
 *   scale   — optional global percentage applied to ALL bores (50–200, default 100)
 *   printer — optional named per-printer scale factor (settings key
 *             'sleeve_printer_scales', managed via PUT /api/sleeves?printers=1);
 *             multiplied with `scale`
 */
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { meshToStlBinary } from '$lib/server/stl';
import { buildCalibrationPlate, getPrinterScales, getSystem } from '$lib/server/sleeveGeom';

export const GET: RequestHandler = async ({ params, url }) => {
	const id = Number(params.id);
	const system = getSystem(id);
	if (!system) error(404, 'Sleeve system not found');
	const seg1 = system.segments[0];
	if (!seg1) error(400, 'System has no segments');

	const scaleParam = url.searchParams.get('scale');
	const scalePct = scaleParam == null ? 100 : Number(scaleParam);
	if (!Number.isFinite(scalePct) || scalePct < 50 || scalePct > 200) {
		error(400, 'scale must be 50–200 (percent)');
	}

	let printerFactor = 1;
	const printer = url.searchParams.get('printer');
	if (printer) {
		const scales = getPrinterScales();
		if (!(printer in scales)) error(404, `Unknown printer "${printer}"`);
		printerFactor = scales[printer];
	}

	const positions = buildCalibrationPlate(seg1.lowerDiameter, (scalePct / 100) * printerFactor);
	const stl = meshToStlBinary(positions, `calibration ${system.name}`);

	const safe = system.name.replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'sleeve';
	const suffix = printer ? `_${printer.replace(/[^\w\-. ]+/g, '_')}` : '';
	return new Response(new Uint8Array(stl), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(stl.length),
			'Content-Disposition': `attachment; filename="calibration_${safe}${suffix}.stl"`
		}
	});
};
