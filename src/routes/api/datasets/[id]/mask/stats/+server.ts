import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { countMaskRange, loadMask, normalizeSlot } from '$lib/server/segMask';

/**
 * GET → { voxels, ml } for the mask slot (?slot=, default 'main').
 * ml = voxels × spacing_x × spacing_y × spacing_z / 1000 (mm³ → ml).
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const slot = normalizeSlot(url.searchParams.get('slot'));
	if (!slot) error(400, 'Invalid slot');

	const mask = await loadMask(ds, slot);
	const voxels = countMaskRange(mask);
	const ml = (voxels * ds.spacing_x * ds.spacing_y * ds.spacing_z) / 1000;
	return json({ voxels, ml });
};
