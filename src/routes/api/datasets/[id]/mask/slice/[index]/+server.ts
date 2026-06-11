import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadMask } from '$lib/server/segMask';

/** Raw Uint8 axial mask slice (zeros if no mask exists yet). */
export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const index = Number(params.index);
	if (!Number.isFinite(index)) error(400, 'Invalid index');

	const mask = await loadMask(ds);
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
