import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';
import { runIosSeg } from '$lib/server/iosSeg';

/**
 * Run the vendor intraoral-scan (IOS) tooth-segmentation model on an uploaded
 * surface scan and return per-vertex FDI tooth labels.
 *
 * POST — multipart body with 'file' = the scan mesh (.obj/.stl/.ply).
 *
 * Response JSON:
 *   {
 *     vertexCount,                // number of vertices in the scan
 *     presentLabels: number[],    // distinct label indices present (excl. -1)
 *     presentFdis: string[],      // distinct FDI tooth numbers present
 *     gingivaCount,               // vertices labelled gingiva (label 0)
 *     labelsB64                   // see below
 *   }
 *
 * labelsB64 encodes the full per-vertex label array compactly: it is the
 * base64 of the raw little-endian bytes of an Int16Array of length vertexCount
 * (label per vertex; 0=gingiva, 1..32=tooth, 33..38=other, -1=unmatched).
 * Decode client-side with:
 *   new Int16Array(Uint8Array.from(atob(labelsB64), c => c.charCodeAt(0)).buffer)
 * (assumes a little-endian host, which all supported browsers are).
 *
 * Geometry of the SEGMENTED mesh is returned so the client can rebuild a
 * coloured mesh faithfully (the vendor may re-weld vertices, so labels are NOT
 * guaranteed to align with the uploaded buffers):
 *   positionsB64  base64 of Float32Array(vertexCount*3) xyz (tightly packed)
 *   indexB64      base64 of Uint32Array (triangle index), or null if non-indexed
 */
const b64 = (a: ArrayBufferView): string =>
	Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File)) error(400, 'No file uploaded (multipart field "file")');
	assertSize(file, LIMITS.model);
	const ext = (file.name.split('.').pop() ?? '').toLowerCase();
	if (!['obj', 'stl', 'ply'].includes(ext)) {
		error(400, `Unsupported scan format .${ext} — use OBJ, STL or PLY`);
	}

	const bytes = new Uint8Array(await file.arrayBuffer());

	let result;
	try {
		result = await runIosSeg(bytes, file.name, { includeGeometry: true });
	} catch (e) {
		error(502, `IOS segmentation failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	return json({
		vertexCount: result.vertexCount,
		presentLabels: result.presentLabels,
		presentFdis: result.presentFdis,
		gingivaCount: result.gingivaCount,
		labelsB64: b64(result.perVertexLabel),
		positionsB64: result.positions ? b64(result.positions) : null,
		indexB64: result.index ? b64(result.index) : null
	});
};
