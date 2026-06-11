import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getCase } from '$lib/server/db/repo';
import { parsePly, parseStl, meshToStlBinary } from '$lib/server/stl';
import type { Model } from '$lib/types';

/**
 * Merge several case models into ONE new model (desktop AI assistant:
 * "Create merged AI model" — pick teeth/jaw on the FDI chart, get a single
 * exportable mesh). Body: { modelIds: number[], name?: string }.
 * Each source is mapped through its own transform into the shared volume
 * frame; the merged model carries an identity transform.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');
	const body = await request.json().catch(() => ({}));
	const ids: number[] = Array.isArray(body.modelIds) ? body.modelIds.map(Number) : [];
	if (ids.length < 2) error(400, 'Pick at least two models to merge');

	const parts: Float32Array[] = [];
	let total = 0;
	const names: string[] = [];
	for (const id of ids) {
		const m = db
			.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
			.get(id, caseId) as Model | null;
		if (!m || !m.file_path) error(404, `Model ${id} not found in this case`);
		const bytes = new Uint8Array(await Bun.file(resolveData(m.file_path)).arrayBuffer());
		const parsed = parseStl(bytes) ?? parsePly(bytes);
		if (!parsed) error(415, `Model ${id}: unsupported mesh format`);
		let p = parsed.positions;
		let T: number[] | null = null;
		try {
			const t = m.transform ? JSON.parse(m.transform) : null;
			if (Array.isArray(t) && t.length === 16) T = t;
		} catch {
			T = null;
		}
		if (T) {
			const q = new Float32Array(p.length);
			for (let i = 0; i + 2 < p.length; i += 3) {
				const x = p[i];
				const y = p[i + 1];
				const z = p[i + 2];
				q[i] = T[0] * x + T[4] * y + T[8] * z + T[12];
				q[i + 1] = T[1] * x + T[5] * y + T[9] * z + T[13];
				q[i + 2] = T[2] * x + T[6] * y + T[10] * z + T[14];
			}
			p = q;
		}
		parts.push(p);
		total += p.length;
		names.push(m.name);
	}

	const merged = new Float32Array(total);
	let off = 0;
	for (const p of parts) {
		merged.set(p, off);
		off += p.length;
	}

	const name = String(body.name || `Merged AI model (${names.length})`);
	const path = join(caseRel(caseId), `merged_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(path), meshToStlBinary(merged));
	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color)
			 VALUES (?1, ?2, 'scan', ?3, '#cfd6c4') RETURNING *`
		)
		.get(caseId, name, path) as Model;
	return json({ model, triangles: merged.length / 9, sources: names });
};
