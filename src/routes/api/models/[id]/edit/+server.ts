import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { applyMeshEdit, type MeshEditOp, type Vec3 } from '$lib/server/meshEdit';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import type { Model } from '$lib/types';

function parseVec3(v: unknown): Vec3 | null {
	const x = Number((v as Vec3)?.x);
	const y = Number((v as Vec3)?.y);
	const z = Number((v as Vec3)?.z);
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

/**
 * Mesh editor (SPEC §5.7). Body is a single op:
 *   { op: 'smooth'|'remesh'|'fillHoles'|'bridge',
 *     mode?: 'flatten',            // wax knife (smooth only)
 *     center?: {x,y,z}, radius?: number,   // smooth / remesh (radius default 5 mm)
 *     a?: {x,y,z}, b?: {x,y,z} }           // bridge loop hints
 *
 * The model file is rewritten in place as binary STL; the very first edit
 * stores a one-time backup next to it (<file>.orig). Models whose file is
 * not already STL (e.g. imported PLY scans) get a fresh .stl file and the
 * row's file_path is updated — the .orig backup is still the untouched
 * original. Returns { triangles, report }. Audited as 'model.edit'.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');

	const body = await request.json().catch(() => ({}));
	const opName = body.op;
	if (!['smooth', 'remesh', 'fillHoles', 'bridge'].includes(opName)) {
		error(400, "op must be 'smooth' | 'remesh' | 'fillHoles' | 'bridge'");
	}
	const op: MeshEditOp = { op: opName };
	if (body.mode != null) {
		if (body.mode !== 'flatten') error(400, "mode must be 'flatten'");
		op.mode = 'flatten';
	}
	if (opName === 'smooth' || opName === 'remesh') {
		const center = parseVec3(body.center);
		if (!center) error(400, `${opName} requires center {x,y,z}`);
		op.center = center;
		const radius = body.radius == null ? 5 : Number(body.radius);
		if (!Number.isFinite(radius) || radius <= 0) error(400, 'radius must be > 0');
		op.radius = radius;
	}
	if (opName === 'bridge') {
		const a = parseVec3(body.a);
		const b = parseVec3(body.b);
		if (!a || !b) error(400, 'bridge requires points a and b');
		op.a = a;
		op.b = b;
	}

	const absPath = resolveData(m.file_path);
	const file = Bun.file(absPath);
	if (!(await file.exists())) error(404, 'Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = parseStl(bytes) ?? parsePly(bytes);
	if (!parsed) error(400, 'Model file is not a readable STL/PLY mesh');

	let result;
	try {
		result = applyMeshEdit(parsed.positions, op);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Mesh edit failed');
	}
	if (result.positions.length < 9) error(400, 'Edit would leave an empty mesh');

	// one-time backup of the original file
	const origPath = `${absPath}.orig`;
	if (!(await Bun.file(origPath).exists())) {
		await Bun.write(origPath, bytes);
	}

	const stl = meshToStlBinary(result.positions, m.name);
	const ext = m.file_path.split('.').pop()?.toLowerCase();
	if (ext === 'stl') {
		await Bun.write(absPath, stl);
	} else {
		const rel = join(caseRel(m.case_id), `edit_${crypto.randomUUID().slice(0, 8)}.stl`);
		await Bun.write(resolveData(rel), stl);
		db.query('UPDATE models SET file_path = ?2 WHERE id = ?1').run(m.id, rel);
	}

	logAudit(
		locals.user,
		'model.edit',
		`model:${m.id}`,
		`${op.op}${op.mode ? '/' + op.mode : ''} — ${m.name}`
	);
	return json({ triangles: result.positions.length / 9, report: result.report });
};
