import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

const IMG_DIR =
	process.env.CDX_MANUAL_DIR != null
		? join(process.env.CDX_MANUAL_DIR, 'img')
		: join(process.cwd(), 'docs', 'manual', 'img');

export const GET: RequestHandler = async ({ params }) => {
	const name = params.name;
	if (!/^[\w.-]+\.png$/.test(name)) error(404, 'Not found');
	try {
		const bytes = readFileSync(join(IMG_DIR, name));
		return new Response(new Uint8Array(bytes), {
			headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }
		});
	} catch {
		error(404, 'Not found');
	}
};
