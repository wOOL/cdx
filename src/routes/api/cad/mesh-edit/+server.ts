import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { applyMeshEditOps, type MeshEditOp } from '$lib/server/meshEdit';

/**
 * Mesh optimization / editing for the restoration workstation. Applies a list
 * of mesh-edit ops (smooth, fillHoles, keep-largest-part, reduce, plane cut, …)
 * to a scan and returns the cleaned geometry.
 *
 * POST — multipart body:
 *   positions : binary Float32 (xyz), required (the scan geometry)
 *   index     : binary Uint32 (triangle index), optional (else positions is a soup)
 *   ops       : JSON string — MeshEditOp[]
 *
 * Response: binary octet-stream = Float32 soup (xyz, length divisible by 9) of
 * the edited mesh. Headers: X-Triangles-After, X-Report (JSON of per-op reports).
 *
 * meshEdit operates on a triangle SOUP (every 9 floats = one triangle), so an
 * indexed input is expanded here first.
 */
function expandToSoup(positions: Float32Array, index: Uint32Array): Float32Array {
	const out = new Float32Array(index.length * 3);
	for (let i = 0; i < index.length; i++) {
		const v = index[i] * 3;
		out[i * 3] = positions[v];
		out[i * 3 + 1] = positions[v + 1];
		out[i * 3 + 2] = positions[v + 2];
	}
	return out;
}

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const posBlob = form?.get('positions');
	if (!(posBlob instanceof Blob)) error(400, 'Missing "positions" (binary Float32)');
	const positions = new Float32Array(await posBlob.arrayBuffer());

	const idxBlob = form?.get('index');
	const index = idxBlob instanceof Blob ? new Uint32Array(await idxBlob.arrayBuffer()) : undefined;

	let ops: MeshEditOp[];
	try {
		ops = JSON.parse(String(form?.get('ops') ?? '[]')) as MeshEditOp[];
	} catch {
		error(400, 'Invalid "ops" JSON');
	}
	if (!Array.isArray(ops) || ops.length === 0) error(400, '"ops" must be a non-empty array');

	const soup = index ? expandToSoup(positions, index) : positions;
	if (soup.length < 9 || soup.length % 9 !== 0) error(400, 'Geometry is not a valid triangle mesh');

	let result;
	try {
		result = applyMeshEditOps(soup, ops);
	} catch (e) {
		error(422, `Mesh edit failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	const body = result.positions.buffer.slice(
		result.positions.byteOffset,
		result.positions.byteOffset + result.positions.byteLength
	) as ArrayBuffer;
	return new Response(body, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Triangles-After': String(result.triangles),
			'X-Report': JSON.stringify(result.reports)
		}
	});
};
