import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import {
	floodFill2D,
	floodFill3D,
	getSliceConstraint,
	loadMask,
	normalizeSlot,
	saveMask
} from '$lib/server/segMask';
import { diffRuns, recordPatch } from '$lib/server/segHistory';

/**
 * Body: { index, x, y, lo?, hi?, mode: 'add'|'erase', volume?: boolean } →
 * flood fill on an axial slice, or — with volume:true — a 6-connected
 * VOLUMETRIC fill from the same seed (the original's "click in the 3D area"),
 * spreading across slices through the HU range. ?slot=<name> selects the mask
 * slot (default 'main'). The fill cannot cross boundary polylines and
 * respects slot roles (exclude > source > boundaries); one undo step is
 * recorded (multi-slice for the volumetric fill).
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
	const CR = ds.cols * ds.rows;
	const value: 0 | 1 = body.mode === 'add' ? 1 : 0;

	if (body.volume === true) {
		const { voxels, capped } = await floodFill3D(vol, ds, x, y, index, lo, hi, value, (k) =>
			getSliceConstraint(ds, slot, k)
		);
		// group by slice so the undo patch only carries touched slices
		const bySlice = new Map<number, number[]>();
		for (const p of voxels) {
			const k = (p / CR) | 0;
			let list = bySlice.get(k);
			if (!list) bySlice.set(k, (list = []));
			list.push(p);
		}
		const patches: { index: number; runs: Uint32Array }[] = [];
		for (const [k, list] of bySlice) {
			const sliceBefore = mask.slice(k * CR, (k + 1) * CR);
			for (const p of list) mask[p] = value;
			const runs = diffRuns(sliceBefore, mask.subarray(k * CR, (k + 1) * CR));
			if (runs) patches.push({ index: k, runs });
		}
		if (patches.length) {
			recordPatch(ds.id, slot, patches);
			await saveMask(ds, mask, slot);
		}
		return json({ filled: voxels.length, slices: patches.length, capped });
	}

	const constraint = await getSliceConstraint(ds, slot, index);
	const before = mask.slice(index * CR, (index + 1) * CR);

	const filled = floodFill2D(vol, mask, ds, index, x, y, lo, hi, value, constraint);

	const runs = diffRuns(before, mask.subarray(index * CR, (index + 1) * CR));
	if (runs) recordPatch(ds.id, slot, [{ index, runs }]);
	if (filled > 0) await saveMask(ds, mask, slot);

	return json({ filled });
};
