import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { icp, type Point3 } from '$lib/registration';

/**
 * Rigid scan alignment (IFU "smart match"): register a source mesh onto a
 * target mesh by ICP and return the transform. Used to align a secondary scan
 * (antagonist / re-scan / die) to the primary arch.
 *
 * POST — multipart body:
 *   source : binary Float32 (xyz) — the mesh to move
 *   target : binary Float32 (xyz) — the reference mesh
 *
 * Response JSON: { transform: number[16] (column-major), rms, iterations }.
 */
function sample(positions: Float32Array, maxPts: number): Point3[] {
	const n = Math.floor(positions.length / 3);
	const stride = Math.max(1, Math.ceil(n / maxPts));
	const pts: Point3[] = [];
	for (let i = 0; i < n; i += stride) {
		pts.push({ x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] });
	}
	return pts;
}

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const srcBlob = form?.get('source');
	const tgtBlob = form?.get('target');
	if (!(srcBlob instanceof Blob) || !(tgtBlob instanceof Blob)) {
		error(400, 'Need "source" and "target" (binary Float32 xyz)');
	}
	const source = new Float32Array(await srcBlob.arrayBuffer());
	const target = new Float32Array(await tgtBlob.arrayBuffer());
	if (source.length < 9 || target.length < 9) error(400, 'Meshes too small to align');

	const result = icp(sample(source, 4000), sample(target, 6000), { maxIterations: 60 });
	return json({ transform: result.transform, rms: result.rms, iterations: result.iterations });
};
