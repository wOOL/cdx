import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadMask, saveMask } from '$lib/server/segMask';
import { applyPatch, historyState, popUndo } from '$lib/server/segHistory';

/**
 * POST → undo the newest recorded mask mutation (paint/fill/propagate) of the
 * dataset, whatever slot it touched.
 *
 * Response: { ok, slot?, slices: number[], undo, redo } — `slices` lists the
 * affected axial slice indices (so the client can invalidate them), `undo` /
 * `redo` the remaining step counts. ok=false when there is nothing to undo.
 */
export const POST: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const patch = popUndo(ds.id);
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
