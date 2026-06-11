import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { initFromThreshold, normalizeSlot, saveMask } from '$lib/server/segMask';
import { clearHistory } from '$lib/server/segHistory';

/**
 * Body: { threshold?: HU (default 300), hi?: HU (default 32767) } → (re)create
 * the mask. ?slot=<name> selects the mask slot (default 'main'). Re-creating
 * a mask resets the dataset's undo/redo history.
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const slot = normalizeSlot(url.searchParams.get('slot'));
	if (!slot) error(400, 'Invalid slot');

	const body = await request.json().catch(() => ({}));
	const lo = Number.isFinite(Number(body.threshold)) ? Number(body.threshold) : 300;
	const hi = Number.isFinite(Number(body.hi)) ? Number(body.hi) : 32767;

	const vol = await loadVolume(ds);
	const mask = new Uint8Array(vol.length);
	const filled = initFromThreshold(vol, mask, lo, hi);
	await saveMask(ds, mask, slot);
	clearHistory(ds.id);

	return json({ filled });
};
