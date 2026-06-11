import { error, json } from '@sveltejs/kit';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { DATA_DIR } from '$lib/server/db';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';

/**
 * Store a user-designed implant STL under data/designer/.
 * The file is reference-only (linked from the published line's techInfo);
 * the planning glyph stays parametric.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!(file instanceof File) || file.size === 0) error(400, 'Missing STL file');
	assertSize(file, LIMITS.model);
	if (!/\.stl$/i.test(file.name)) error(400, 'Only .stl files are accepted');

	const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'design.stl';
	const rel = join('designer', `${Date.now()}-${safe}`);
	mkdirSync(join(DATA_DIR, 'designer'), { recursive: true });
	writeFileSync(join(DATA_DIR, rel), new Uint8Array(await file.arrayBuffer()));
	return json({ path: rel }, { status: 201 });
};
