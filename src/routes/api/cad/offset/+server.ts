import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { thickenSurface } from '$lib/server/meshSdf';

/**
 * Thicken a surface mesh into a watertight solid shell (voxel distance field +
 * marching cubes). Used by copings/splints/models and as the basis for the
 * crown intrados.
 *
 * POST — multipart body:
 *   positions    : binary Float32 (xyz), required
 *   index        : binary Uint32 (triangle index), optional
 *   halfThickness: string (mm), optional (default 0.45)
 *   voxel        : string (mm), optional (default 0.2)
 *
 * Response: binary octet-stream = Float32 soup of the solid. Header X-Triangles.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const posBlob = form?.get('positions');
	if (!(posBlob instanceof Blob)) error(400, 'Missing "positions" (binary Float32)');
	const positions = new Float32Array(await posBlob.arrayBuffer());
	const idxBlob = form?.get('index');
	const index = idxBlob instanceof Blob ? new Uint32Array(await idxBlob.arrayBuffer()) : undefined;

	const halfThickness = Number(form?.get('halfThickness') ?? 0.45);
	const voxel = Number(form?.get('voxel') ?? 0.2);
	if (!(halfThickness > 0) || !(voxel > 0)) error(400, 'halfThickness and voxel must be positive');
	if (positions.length < 9) error(400, 'Mesh too small');

	let solid: Float32Array;
	try {
		solid = thickenSurface(positions, index, { halfThickness, voxel });
	} catch (e) {
		error(422, `Offset failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (solid.length < 9) error(422, 'Offset produced an empty solid');

	const body = solid.buffer.slice(solid.byteOffset, solid.byteOffset + solid.byteLength) as ArrayBuffer;
	return new Response(body, {
		headers: { 'Content-Type': 'application/octet-stream', 'X-Triangles': String(solid.length / 9) }
	});
};
