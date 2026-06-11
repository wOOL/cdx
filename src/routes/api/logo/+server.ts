import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';

export const GET: RequestHandler = async () => {
	const file = Bun.file(`${DATA_DIR}/logo.png`);
	if (!(await file.exists())) error(404, 'No logo uploaded');
	// the stored file keeps whatever raster format was uploaded — sniff it
	const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
	const type =
		head[0] === 0xff && head[1] === 0xd8
			? 'image/jpeg'
			: head[0] === 0x42 && head[1] === 0x4d
				? 'image/bmp'
				: head[8] === 0x57 && head[9] === 0x45
					? 'image/webp'
					: 'image/png';
	return new Response(await file.arrayBuffer(), {
		headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=300' }
	});
};
