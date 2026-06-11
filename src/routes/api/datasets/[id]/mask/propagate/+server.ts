import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { loadMask, normalizeSlot, propagateMask, saveMask } from '$lib/server/segMask';
import { recordPatch } from '$lib/server/segHistory';

/** A slice whose voxel count changes by more than this vs the previous slice gets a warning. */
const WARN_RATIO = 0.4;

/**
 * Body: { from, to, lo, hi } → propagate the mask region of slice `from`
 * slice-by-slice toward `to` (region growing seeded by the previous slice's
 * mask ∩ HU∈[lo,hi], 4-connected, boundary- and slot-aware, additive).
 * ?slot=<name> selects the mask slot (default 'main'). Records one undo step.
 *
 * Response: {
 *   slices: [{ index, changed, voxels }],   // per visited slice
 *   warnings: number[]                       // "check slice N" (>40% change)
 * }
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const slot = normalizeSlot(url.searchParams.get('slot'));
	if (!slot) error(400, 'Invalid slot');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Invalid body');
	const from = Number(body.from);
	const to = Number(body.to);
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 0 ||
		from >= ds.slices ||
		to < 0 ||
		to >= ds.slices ||
		from === to
	) {
		error(400, 'Invalid slice range');
	}
	const lo = Number(body.lo);
	const hi = Number(body.hi);
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) error(400, 'Invalid HU range');

	const vol = await loadVolume(ds);
	const mask = await loadMask(ds, slot);

	const CR = ds.cols * ds.rows;
	let prevVoxels = 0;
	for (let i = from * CR; i < (from + 1) * CR; i++) prevVoxels += mask[i];

	const { slices, patches } = await propagateMask(ds, vol, mask, slot, from, to, lo, hi);

	const warnings: number[] = [];
	for (const s of slices) {
		if (Math.abs(s.voxels - prevVoxels) > WARN_RATIO * Math.max(1, prevVoxels)) {
			warnings.push(s.index);
		}
		prevVoxels = s.voxels;
	}

	if (patches.length > 0) {
		recordPatch(ds.id, slot, patches);
		await saveMask(ds, mask, slot);
	}

	return json({ slices, warnings });
};
