import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unlink } from 'node:fs/promises';
import { db, resolveData } from '$lib/server/db';

interface ImageRow {
	id: number;
	file_path: string;
	name: string;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const img = db.query('SELECT * FROM images WHERE id = ?1').get(Number(params.id)) as ImageRow | null;
	if (!img) error(404, 'Image not found');
	const file = Bun.file(resolveData(img.file_path));
	if (!(await file.exists())) error(404, 'Image file missing');
	const headers: Record<string, string> = {
		'Content-Type': 'image/png',
		'Cache-Control': 'private, max-age=3600'
	};
	if (url.searchParams.has('download')) {
		headers['Content-Disposition'] = `attachment; filename="${img.name.replace(/[^\w\-. ]+/g, '_')}.png"`;
	}
	return new Response(await file.arrayBuffer(), { headers });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const img = db.query('SELECT * FROM images WHERE id = ?1').get(Number(params.id)) as ImageRow | null;
	if (img?.file_path) await unlink(resolveData(img.file_path)).catch(() => {});
	db.query('DELETE FROM images WHERE id = ?1').run(Number(params.id));
	return json({ ok: true });
};
