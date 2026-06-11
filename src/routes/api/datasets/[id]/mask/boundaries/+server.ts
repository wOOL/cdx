import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadBoundaries, sanitizeBoundaries, saveBoundaries } from '$lib/server/segBoundary';

/**
 * Segmentation boundary polylines for the dataset, shared by all mask slots.
 *
 * GET → { [sliceIndex]: [[{x,y},...], ...] }  (slice pixel coordinates)
 * PUT (same shape, the FULL set — slices omitted from the body lose their
 * boundaries) → { ok: true, slices, polylines }
 */
export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	return json(await loadBoundaries(ds));
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	const set = sanitizeBoundaries(body, ds);
	if (!set) error(400, 'Invalid boundary set');

	await saveBoundaries(ds, set);
	let polylines = 0;
	for (const polys of Object.values(set)) polylines += polys.length;
	return json({ ok: true, slices: Object.keys(set).length, polylines });
};
