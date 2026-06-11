import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseDir } from '$lib/server/db';
import { db } from '$lib/server/db';
import { getCase } from '$lib/server/db/repo';
import type { Model } from '$lib/types';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';

const KINDS = new Set(['scan', 'segmentation', 'guide', 'waxup', 'other']);

/** Multipart upload: file=<stl/ply>, kind=scan|waxup|other, name=<display name> */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file uploaded');
	assertSize(file, LIMITS.model);
	const kind = KINDS.has(String(form.get('kind'))) ? String(form.get('kind')) : 'scan';
	const name = String(form.get('name') || file.name || 'Model');

	const ext = (file.name.split('.').pop() ?? 'stl').toLowerCase();
	if (!['stl', 'ply', 'obj'].includes(ext)) {
		error(400, `Unsupported model format .${ext} — use STL or PLY`);
	}

	const dir = caseDir(caseId);
	const path = join(dir, `model_${crypto.randomUUID().slice(0, 8)}.${ext}`);
	await Bun.write(path, await file.arrayBuffer());

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color)
			 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`
		)
		.get(caseId, name, kind, path, kind === 'segmentation' ? '#d8cfc0' : '#c8b89a') as Model;

	return json({ model });
};
