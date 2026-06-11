import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import type { Model } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	const file = Bun.file(m.file_path);
	if (!(await file.exists())) error(404, 'Model file missing');
	const ext = m.file_path.split('.').pop()?.toLowerCase() ?? 'stl';
	return new Response(await file.arrayBuffer(), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Format': ext,
			'Cache-Control': 'private, max-age=60'
		}
	});
};
