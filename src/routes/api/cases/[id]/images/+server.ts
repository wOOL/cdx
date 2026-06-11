import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getCase } from '$lib/server/db/repo';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';

/** Multipart: file=<png/jpeg>, name=<display name> — stores a snapshot in the patient's image library. */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No image uploaded');
	assertSize(file, LIMITS.image);
	const name = String(form.get('name') || 'Snapshot').slice(0, 80);

	const path = join(caseRel(caseId), `img_${crypto.randomUUID().slice(0, 8)}.png`);
	await Bun.write(resolveData(path), await file.arrayBuffer());

	const image = db
		.query(
			`INSERT INTO images (patient_id, case_id, name, file_path) VALUES (?1, ?2, ?3, ?4) RETURNING *`
		)
		.get(c.patient_id, caseId, name, path);
	return json({ image });
};
