import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';

export const GET: RequestHandler = async () => {
	const file = Bun.file(`${DATA_DIR}/logo.png`);
	if (!(await file.exists())) error(404, 'No logo uploaded');
	return new Response(await file.arrayBuffer(), {
		headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' }
	});
};
