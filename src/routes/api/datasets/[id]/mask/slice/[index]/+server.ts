import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadMask, normalizeSlot } from '$lib/server/segMask';

/**
 * Raw Uint8 axial mask slice (zeros if no mask exists yet).
 * ?slot=<name> selects the mask slot (default 'main').
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const index = Number(params.index);
	if (!Number.isFinite(index)) error(400, 'Invalid index');
	const slot = normalizeSlot(url.searchParams.get('slot'));
	if (!slot) error(400, 'Invalid slot');

	const mask = await loadMask(ds, slot);
	const CR = ds.cols * ds.rows;
	const k = Math.max(0, Math.min(ds.slices - 1, Math.trunc(index)));

	return new Response(mask.slice(k * CR, (k + 1) * CR), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Width': String(ds.cols),
			'X-Height': String(ds.rows),
			'Cache-Control': 'no-store'
		}
	});
};
