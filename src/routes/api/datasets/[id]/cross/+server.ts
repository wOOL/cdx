import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { crossImage } from '$lib/server/recon';

/** Body: { origin: {x,y} (mm), dir: {x,y} (unit), halfWidth?: mm, step?: mm } */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	const origin = body?.origin as { x: number; y: number } | undefined;
	const dir = body?.dir as { x: number; y: number } | undefined;
	if (!origin || !dir) error(400, 'origin and dir required');
	const len = Math.hypot(dir.x, dir.y) || 1;
	const unit = { x: dir.x / len, y: dir.y / len };
	const halfWidth = Math.max(2, Math.min(40, Number(body.halfWidth) || 15));
	const step = Math.max(0.1, Number(body.step) || Math.min(ds.spacing_x, ds.spacing_y));

	const vol = await loadVolume(ds);
	const img = crossImage(vol, ds, origin, unit, halfWidth, step);

	return new Response(img.data.buffer as ArrayBuffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'X-Width': String(img.width),
				'X-Height': String(img.height),
				'X-Step': String(step),
				'Cache-Control': 'no-store'
			}
		}
	);
};
