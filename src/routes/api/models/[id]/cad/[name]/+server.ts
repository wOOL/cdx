import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import type { Model } from '$lib/types';

/**
 * Suffix-named alias of the model file, for consumers that infer the format
 * from the URL's final path segment (the embedded CAD's loadFileFromUrl).
 * `name` is display-only; the served bytes are always the model's own file.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!/^[\w\-. ]+\.(stl|ply)$/i.test(params.name)) error(404, 'Not found');
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');
	return new Response(file.stream(), {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Cache-Control': 'private, max-age=60'
		}
	});
};
