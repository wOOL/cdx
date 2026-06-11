import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseDir, db } from '$lib/server/db';
import { getCase, getPlan, listImplants } from '$lib/server/db/repo';
import { generateGuide, type GuideImplant } from '$lib/server/guideGen';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import type { Model } from '$lib/types';

/** Body: { modelId, planId, params?: { offset, thickness, regionRadius, voxel } } */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const body = await request.json().catch(() => ({}));
	const model = db
		.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
		.get(Number(body.modelId), caseId) as Model | null;
	if (!model) error(404, 'Base model not found');
	const plan = getPlan(Number(body.planId));
	if (!plan || plan.case_id !== caseId) error(404, 'Plan not found');

	const implants = listImplants(plan.id);
	const withSleeves: GuideImplant[] = [];
	for (const im of implants) {
		let sleeve: { diameter: number; height: number; offset: number } | null = null;
		try {
			sleeve = im.sleeve ? JSON.parse(im.sleeve) : null;
		} catch {
			sleeve = null;
		}
		if (!sleeve) continue;
		withSleeves.push({
			head: { x: im.x, y: im.y, z: im.z },
			axis: { x: im.ax, y: im.ay, z: im.az },
			sleeve
		});
	}
	if (withSleeves.length === 0) {
		error(400, 'No implants with sleeves — assign sleeves before generating a guide');
	}

	const bytes = new Uint8Array(await Bun.file(model.file_path).arrayBuffer());
	const mesh = model.file_path.endsWith('.ply') ? parsePly(bytes) : parseStl(bytes);
	if (!mesh) error(400, 'Could not parse base model file');

	let transform: number[] | null = null;
	try {
		const t = model.transform ? JSON.parse(model.transform) : null;
		if (Array.isArray(t) && t.length === 16) transform = t;
	} catch {
		transform = null;
	}

	const p = body.params ?? {};
	const guide = generateGuide(mesh.positions, transform, withSleeves, {
		offset: Number(p.offset) || 0.15,
		thickness: Number(p.thickness) || 2.5,
		regionRadius: Number(p.regionRadius) || 9,
		voxel: Number(p.voxel) || 0.3
	});
	if (guide.triangles === 0) error(400, 'Guide generation produced an empty mesh');

	const stl = meshToStlBinary(guide.positions, 'surgical_guide');
	const path = join(caseDir(caseId), `guide_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(path, stl);

	const guideModel = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, opacity)
			 VALUES (?1, ?2, 'guide', ?3, '#4d9fd6', 0.85) RETURNING *`
		)
		.get(caseId, `Guide — ${plan.name}`, path) as Model;

	return json({ model: guideModel, triangles: guide.triangles });
};
