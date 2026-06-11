import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import {
	floodFill2D,
	getSliceConstraint,
	loadMask,
	normalizeSlot,
	saveMask
} from '$lib/server/segMask';
import { diffRuns, recordPatch } from '$lib/server/segHistory';

/**
 * Body: { index, x, y, lo?, hi?, mode: 'add'|'erase' } → flood fill on an
 * axial slice. ?slot=<name> selects the mask slot (default 'main'). The fill
 * cannot cross boundary polylines and respects slot roles
 * (exclude > source > boundaries); one undo step is recorded.
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const slot = normalizeSlot(url.searchParams.get('slot'));
	if (!slot) error(400, 'Invalid slot');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Invalid body');
	const index = Number(body.index);
	if (!Number.isInteger(index) || index < 0 || index >= ds.slices) error(400, 'Invalid index');
	const x = Number(body.x);
	const y = Number(body.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) error(400, 'Invalid seed');
	const lo = Number.isFinite(Number(body.lo)) ? Number(body.lo) : 300;
	const hi = Number.isFinite(Number(body.hi)) ? Number(body.hi) : 32767;
	if (body.mode !== 'add' && body.mode !== 'erase') error(400, 'Invalid mode');

	const vol = await loadVolume(ds);
	const mask = await loadMask(ds, slot);
	const constraint = await getSliceConstraint(ds, slot, index);
	const CR = ds.cols * ds.rows;
	const before = mask.slice(index * CR, (index + 1) * CR);

	const filled = floodFill2D(
		vol,
		mask,
		ds,
		index,
		x,
		y,
		lo,
		hi,
		body.mode === 'add' ? 1 : 0,
		constraint
	);

	const runs = diffRuns(before, mask.subarray(index * CR, (index + 1) * CR));
	if (runs) recordPatch(ds.id, slot, [{ index, runs }]);
	if (filled > 0) await saveMask(ds, mask, slot);

	return json({ filled });
};
