import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateVirtualTooth } from '$lib/server/virtualTooth';
import { virtualToothTemplate } from '$lib/implantLibrary';

/**
 * Parametric "library tooth" geometry for the restoration crown proposal.
 *
 * GET ?fdi=<11..48>&width=<desired mesiodistal width in mm, optional>
 *
 * Returns a watertight crown solid as a triangle soup. The model is generated
 * z-up with its origin at the cervical base (emergence point), +z toward the
 * occlusal surface, x = mesiodistal, y = buccolingual (see virtualTooth.ts).
 * When `width` is given, the tooth is uniformly scaled so its mesiodistal width
 * matches it (so it fits the detected gap); otherwise scale = 1.
 *
 * Response JSON:
 *   { fdi, widthMM, heightMM, scale, vertexCount, positionsB64 }
 * positionsB64 = base64 of a Float32Array (xyz soup, length divisible by 9).
 */
const b64 = (a: ArrayBufferView): string =>
	Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

export const GET: RequestHandler = async ({ url }) => {
	const fdi = Number(url.searchParams.get('fdi'));
	if (!Number.isInteger(fdi)) error(400, 'fdi query parameter required (FDI tooth number)');
	const tpl = virtualToothTemplate(fdi);
	if (!tpl) error(400, `Unknown FDI tooth ${fdi}`);

	const widthParam = url.searchParams.get('width');
	let scale = 1;
	if (widthParam != null) {
		const desired = Number(widthParam);
		if (Number.isFinite(desired) && desired > 0 && tpl.widthMM > 0) {
			scale = desired / tpl.widthMM;
			scale = Math.max(0.3, Math.min(3, scale)); // clamp to a sane range
		}
	}

	let positions: Float32Array;
	try {
		positions = generateVirtualTooth(fdi, { scale });
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}

	return json({
		fdi,
		widthMM: tpl.widthMM,
		heightMM: tpl.heightMM,
		scale,
		vertexCount: positions.length / 3,
		positionsB64: b64(positions)
	});
};
