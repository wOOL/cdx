import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { copyFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import { cutMeshZ, detectMeshIssues, repairMesh } from '$lib/server/meshTools';
import type { Model } from '$lib/types';

function getModel(id: number): Model | null {
	return (db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model) ?? null;
}

async function loadSoup(m: Model): Promise<Float32Array> {
	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const ext = m.file_path.split('.').pop()?.toLowerCase();
	const parsed =
		ext === 'ply' ? (parsePly(bytes) ?? parseStl(bytes)) : (parseStl(bytes) ?? parsePly(bytes));
	if (!parsed) error(400, 'Model file is not a readable STL/PLY mesh');
	return parsed.positions;
}

/**
 * Mesh-repair toolset (SPEC §2.2 post-import scan tools).
 * Body: { mode: 'repair' | 'detect' | 'cut', zMin?: number, zMax?: number }
 *
 * - repair: drops degenerate + duplicate triangles, unifies winding, then
 *   rewrites the model file in place (binary STL). The pristine upload is
 *   kept once as '<file>.orig'; later repairs never clobber that backup.
 *   Returns { report }.
 * - detect: read-only scan, returns { issues }.
 * - cut:    keeps triangles fully inside z ∈ [zMin, zMax] and writes the
 *   result as a NEW model row + file named '<name> (cut)'. Returns { model }.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const m = getModel(id);
	if (!m) error(404, 'Model not found');

	const body = await request.json().catch(() => ({}));
	const mode = String(body.mode ?? '');
	const positions = await loadSoup(m);

	if (mode === 'detect') {
		return json({ issues: detectMeshIssues(positions) });
	}

	if (mode === 'repair') {
		const { positions: fixed, report } = repairMesh(positions);
		if (fixed.length === 0) error(400, 'Repair would remove every triangle');
		const abs = resolveData(m.file_path);
		const backup = `${abs}.orig`;
		if (!existsSync(backup)) await copyFile(abs, backup);
		const stl = meshToStlBinary(fixed, m.name);
		if (m.file_path.toLowerCase().endsWith('.stl')) {
			await Bun.write(abs, stl);
		} else {
			// repaired output is always binary STL — move non-STL sources (PLY)
			// to a .stl path so the stored extension keeps matching the content
			const relStl = m.file_path.replace(/\.[^.]+$/, '') + '.stl';
			await Bun.write(resolveData(relStl), stl);
			db.query('UPDATE models SET file_path = ?2 WHERE id = ?1').run(id, relStl);
			await unlink(abs).catch(() => {});
		}
		logAudit(
			locals.user,
			'model.repair',
			`model:${id}`,
			`${m.name} — degenerate:${report.removedDegenerate} duplicate:${report.removedDuplicate} flipped:${report.flippedNormals}`
		);
		return json({ report });
	}

	if (mode === 'cut') {
		const zMin = Number(body.zMin);
		const zMax = Number(body.zMax);
		if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin > zMax) {
			error(400, 'cut requires numeric zMin <= zMax');
		}
		const cut = cutMeshZ(positions, zMin, zMax);
		if (cut.length === 0) error(400, 'Cut range keeps no triangles');
		const name = `${m.name} (cut)`;
		const rel = join(caseRel(m.case_id), `model_${crypto.randomUUID().slice(0, 8)}.stl`);
		await Bun.write(resolveData(rel), meshToStlBinary(cut, name));
		const row = db
			.query(
				`INSERT INTO models (case_id, name, kind, file_path, color, opacity, visible, transform, plan_id, params)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING *`
			)
			.get(
				m.case_id,
				name,
				m.kind,
				rel,
				m.color,
				m.opacity,
				m.visible,
				m.transform,
				m.plan_id,
				m.params
			) as Model;
		logAudit(
			locals.user,
			'model.cut',
			`model:${id}`,
			`${m.name} z∈[${zMin}, ${zMax}] → model:${row.id} (${cut.length / 9} triangles)`
		);
		return json({ model: row });
	}

	error(400, "mode must be 'repair', 'detect' or 'cut'");
};
