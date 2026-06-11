import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { proposePcs } from '$lib/server/pcsProposal';

/**
 * Geometric auto-proposal of the Patient Coordinate System and a panoramic
 * curve from a jaw-arch fit (FEATURES §5).
 *
 * POST → { yaw, pitch, roll, curve, confidence }
 *
 * This endpoint is read-only: it does NOT apply anything to the dataset or
 * any plan. The case page is expected to review the proposal, apply the
 * angles itself via POST /api/datasets/[id]/align, and then set the returned
 * curve as the plan's panoramic curve (the curve is expressed in volume-local
 * mm of the post-align volume, so it must be set after the alignment).
 * Confidence 'low' means the volume looked degenerate (no/too little bone or
 * no recognisable arch) and the proposal should not be offered.
 */
export const POST: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const data = await loadVolume(ds);
	const proposal = proposePcs({
		data,
		dims: { x: ds.cols, y: ds.rows, z: ds.slices },
		spacing: { x: ds.spacing_x, y: ds.spacing_y, z: ds.spacing_z }
	});
	return json(proposal);
};
