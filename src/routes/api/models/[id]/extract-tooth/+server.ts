import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { extractToothFromSoup, type ExtractMode, type Vec3 } from '$lib/server/meshEdit';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import type { Model } from '$lib/types';

function parseVec3(v: unknown): Vec3 | null {
	const x = Number((v as Vec3)?.x);
	const y = Number((v as Vec3)?.y);
	const z = Number((v as Vec3)?.z);
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

/**
 * Automated virtual tooth extraction on a surface scan (SPEC §5.6).
 *
 * Body: { head: {x,y,z}, axis: {x,y,z}, diameter: number,
 *         mode: 'cut' | 'cutClose' | 'cutAlveolus' }
 *
 * Triangles whose centroid falls inside the capsule head → head + axis·14 mm
 * (radius = diameter/2 × 1.3) are removed; 'cutClose' also fills the new
 * openings (healed-site look); 'cutAlveolus' uses radius × 1.8 and 18 mm
 * depth. The source model is left untouched — a new model row
 * '<name> (extracted)' with its own STL file is created.
 * → { model, removed }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');

	const body = await request.json().catch(() => ({}));
	const head = parseVec3(body.head);
	const axis = parseVec3(body.axis);
	const diameter = Number(body.diameter);
	const mode = body.mode as ExtractMode;
	if (!head) error(400, 'head {x,y,z} is required');
	if (!axis) error(400, 'axis {x,y,z} is required');
	if (!Number.isFinite(diameter) || diameter <= 0) error(400, 'diameter must be > 0');
	if (!['cut', 'cutClose', 'cutAlveolus'].includes(mode)) {
		error(400, "mode must be 'cut' | 'cutClose' | 'cutAlveolus'");
	}

	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = parseStl(bytes) ?? parsePly(bytes);
	if (!parsed) error(400, 'Model file is not a readable STL/PLY mesh');

	let result;
	try {
		result = extractToothFromSoup(parsed.positions, head, axis, diameter, mode);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Extraction failed');
	}
	if (result.positions.length < 9) error(400, 'Extraction would remove the whole mesh');

	const name = `${m.name} (extracted)`;
	const rel = join(caseRel(m.case_id), `extract_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(rel), meshToStlBinary(result.positions, name));

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, params)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`
		)
		.get(
			m.case_id,
			name,
			m.kind,
			rel,
			m.color,
			JSON.stringify({
				extractedFrom: m.id,
				mode,
				head,
				axis,
				diameter,
				holesFilled: result.holesFilled
			})
		) as Model;

	return json({ model, removed: result.removed });
};
