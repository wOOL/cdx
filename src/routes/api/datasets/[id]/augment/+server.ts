import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	DEFAULT_AUGMENT_COLOR,
	DEFAULT_AUGMENT_NAME,
	runAugmentation,
	sanitizeOutlines
} from '$lib/server/augment';
import { getDataset } from '$lib/server/db/repo';

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Create an augmentation object from closed axial outlines.
 *
 * Body: {
 *   outlines: { [sliceIndex]: {x,y}[][] },  // slice pixel coords, ≥3 pts/poly
 *   density:  number,                       // 0–1 filling-material slider
 *   color?:   string,                       // default '#c08a3a'
 *   name?:    string                        // default 'Augmentation'
 * }
 * → { model, ml }. The model row is kind 'other' with
 * params { augmentation: true, density, ml }; its transform stays at the
 * default so the object can be repositioned via PATCH /api/models/[id].
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));

	const outlines = sanitizeOutlines(body.outlines, ds);
	if (outlines.size === 0) error(400, 'At least one closed outline (≥ 3 points) is required');

	const density = Number(body.density);
	if (!Number.isFinite(density)) error(400, 'Invalid density (expected a number 0–1)');

	const color =
		typeof body.color === 'string' && COLOR_RE.test(body.color)
			? body.color
			: DEFAULT_AUGMENT_COLOR;
	const name =
		typeof body.name === 'string' && body.name.trim() ? body.name.trim() : DEFAULT_AUGMENT_NAME;

	try {
		const { model, ml } = await runAugmentation(
			ds,
			outlines,
			Math.min(1, Math.max(0, density)),
			color,
			name
		);
		return json({ model, ml });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Augmentation failed');
	}
};
