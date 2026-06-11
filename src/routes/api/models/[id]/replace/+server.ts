import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { parsePly, parseStl } from '$lib/server/stl';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';
import type { Model } from '$lib/types';

function getModel(id: number): Model | null {
	return (db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model) ?? null;
}

/**
 * Replace Mesh (SPEC §2.2): swap a model's geometry while keeping its
 * alignment. Multipart body with 'file' = STL/PLY. The row — id, kind,
 * color, transform (registration) — survives untouched; only file_path
 * changes. The old geometry file (and any stale '<file>.orig' repair
 * backup) is removed. 409 while any plan in the case is locked.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const m = getModel(id);
	if (!m) error(404, 'Model not found');

	const locked = db
		.query('SELECT COUNT(*) AS n FROM plans WHERE case_id = ?1 AND locked = 1')
		.get(m.case_id) as { n: number };
	if (locked.n > 0) error(409, 'A plan in this case is locked — unlock it before replacing meshes');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file uploaded');
	assertSize(file, LIMITS.model);
	const ext = (file.name.split('.').pop() ?? '').toLowerCase();
	if (!['stl', 'ply'].includes(ext)) {
		error(400, `Unsupported model format .${ext} — use STL or PLY`);
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = ext === 'ply' ? parsePly(bytes) : parseStl(bytes);
	if (!parsed) error(400, 'File is not a readable mesh');

	const rel = join(caseRel(m.case_id), `model_${crypto.randomUUID().slice(0, 8)}.${ext}`);
	await Bun.write(resolveData(rel), bytes);
	db.query('UPDATE models SET file_path = ?2 WHERE id = ?1').run(id, rel);

	const oldAbs = resolveData(m.file_path);
	await unlink(oldAbs).catch(() => {});
	await unlink(`${oldAbs}.orig`).catch(() => {}); // repair backup of the replaced geometry

	logAudit(
		locals.user,
		'model.replace',
		`model:${id}`,
		`${m.name} ← ${file.name} (${parsed.positions.length / 9} triangles)`
	);
	return json({ model: getModel(id) });
};
