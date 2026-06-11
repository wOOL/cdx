import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import {
	getSliceConstraint,
	loadMask,
	normalizeSlot,
	paintDisc,
	saveMask
} from '$lib/server/segMask';
import { diffRuns, recordPatch } from '$lib/server/segHistory';

const MAX_OPS = 500;

/**
 * Body: { index, ops: [{ x, y, r, mode: 'add'|'erase' }] } → paint discs on an
 * axial slice. ?slot=<name> selects the mask slot (default 'main'). Painting
 * respects boundary polylines and slot roles (exclude > source > boundaries)
 * and records one undo step for the request.
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
	const ops = body.ops;
	if (!Array.isArray(ops) || ops.length > MAX_OPS) error(400, `Expected at most ${MAX_OPS} ops`);

	const mask = await loadMask(ds, slot);
	const constraint = await getSliceConstraint(ds, slot, index);
	const CR = ds.cols * ds.rows;
	const before = mask.slice(index * CR, (index + 1) * CR);

	for (const op of ops) {
		const x = Number(op?.x);
		const y = Number(op?.y);
		const r = Number(op?.r);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r) || r < 0) {
			error(400, 'Invalid op coordinates');
		}
		if (op.mode !== 'add' && op.mode !== 'erase') error(400, 'Invalid op mode');
		paintDisc(mask, ds, 'axial', index, x, y, r, op.mode === 'add' ? 1 : 0, constraint);
	}

	const runs = diffRuns(before, mask.subarray(index * CR, (index + 1) * CR));
	let changed = 0;
	if (runs) {
		for (let i = 1; i < runs.length; i += 2) changed += runs[i];
		recordPatch(ds.id, slot, [{ index, runs }]);
	}
	await saveMask(ds, mask, slot);

	return json({ ok: true, changed });
};
