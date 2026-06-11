import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { extractSlice, loadVolume, type Plane } from '$lib/server/volumeCache';

const PLANES = new Set(['axial', 'coronal', 'sagittal']);

export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const plane = params.plane as Plane;
	if (!PLANES.has(plane)) error(400, 'Invalid plane');
	const index = Number(params.index);
	if (!Number.isFinite(index)) error(400, 'Invalid index');

	const vol = await loadVolume(ds);
	const slice = extractSlice(vol, ds, plane, index);

	return new Response(
		new Uint8Array(slice.data.buffer, slice.data.byteOffset, slice.data.byteLength).slice(),
		{
			headers: {
				'Content-Type': 'application/octet-stream',
				'X-Width': String(slice.width),
				'X-Height': String(slice.height),
				'Cache-Control': 'no-store'
			}
		}
	);
};
