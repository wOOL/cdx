import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadMask, paintDisc, saveMask } from '$lib/server/segMask';

const MAX_OPS = 500;

/** Body: { index, ops: [{ x, y, r, mode: 'add'|'erase' }] } → paint discs on an axial slice. */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Invalid body');
	const index = Number(body.index);
	if (!Number.isInteger(index) || index < 0 || index >= ds.slices) error(400, 'Invalid index');
	const ops = body.ops;
	if (!Array.isArray(ops) || ops.length > MAX_OPS) error(400, `Expected at most ${MAX_OPS} ops`);

	const mask = await loadMask(ds);
	for (const op of ops) {
		const x = Number(op?.x);
		const y = Number(op?.y);
		const r = Number(op?.r);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r) || r < 0) {
			error(400, 'Invalid op coordinates');
		}
		if (op.mode !== 'add' && op.mode !== 'erase') error(400, 'Invalid op mode');
		paintDisc(mask, ds, 'axial', index, x, y, r, op.mode === 'add' ? 1 : 0);
	}
	await saveMask(ds, mask);

	return json({ ok: true });
};
