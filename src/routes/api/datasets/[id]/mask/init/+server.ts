import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { initFromThreshold, saveMask } from '$lib/server/segMask';

/** Body: { threshold?: HU (default 300), hi?: HU (default 32767) } → (re)create the mask. */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const lo = Number.isFinite(Number(body.threshold)) ? Number(body.threshold) : 300;
	const hi = Number.isFinite(Number(body.hi)) ? Number(body.hi) : 32767;

	const vol = await loadVolume(ds);
	const mask = new Uint8Array(vol.length);
	const filled = initFromThreshold(vol, mask, lo, hi);
	await saveMask(ds, mask);

	return json({ filled });
};
