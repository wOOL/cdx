import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { resolveData } from '$lib/server/db';

/** Downsampled uint8 volume (window [-1000, 3000] HU → 0..255) for 3D texture rendering. */
export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	if (!ds.preview_path) error(404, 'No preview volume');

	const file = Bun.file(resolveData(ds.preview_path));
	if (!(await file.exists())) error(404, 'Preview volume file missing');

	return new Response(await file.arrayBuffer(), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Cols': String(ds.preview_cols),
			'X-Rows': String(ds.preview_rows),
			'X-Slices': String(ds.preview_slices),
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
