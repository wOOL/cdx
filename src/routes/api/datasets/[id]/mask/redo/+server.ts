import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadMask, saveMask } from '$lib/server/segMask';
import { applyPatch, historyState, popRedo } from '$lib/server/segHistory';

/**
 * POST → re-apply the most recently undone mask mutation.
 *
 * Response: { ok, slot?, slices: number[], undo, redo } (see ../undo).
 */
export const POST: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const patch = popRedo(ds.id);
	if (!patch) return json({ ok: false, slices: [], ...historyState(ds.id) });

	const mask = await loadMask(ds, patch.slot);
	applyPatch(mask, patch, ds.cols * ds.rows);
	await saveMask(ds, mask, patch.slot);

	return json({
		ok: true,
		slot: patch.slot,
		slices: patch.slices.map((s) => s.index),
		...historyState(ds.id)
	});
};
