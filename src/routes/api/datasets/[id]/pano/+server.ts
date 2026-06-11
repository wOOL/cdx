import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { panoImage } from '$lib/server/recon';
import { sampleCurve } from '$lib/curve';

/** Body: { control: [{x,y}...] (mm), step?: mm, thickness?: mm } */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	const control = body?.control as { x: number; y: number }[] | undefined;
	if (!control || !Array.isArray(control) || control.length < 2) {
		error(400, 'Need at least 2 control points');
	}
	const step = Math.max(0.1, Number(body.step) || 0.5);
	const thickness = Math.max(0, Math.min(10, Number(body.thickness) || 0));

	const curve = sampleCurve(control, step);
	if (!curve) error(400, 'Curve too short');

	const vol = await loadVolume(ds);
	const img = panoImage(vol, ds, curve.points, curve.normals, thickness);

	return new Response(img.data.buffer as ArrayBuffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'X-Width': String(img.width),
				'X-Height': String(img.height),
				'X-Step': String(step),
				'X-Length': String(curve.length),
				'Cache-Control': 'no-store'
			}
		}
	);
};
