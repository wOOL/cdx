import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseDir, db } from '$lib/server/db';
import { getCase, getPlan, listImplants } from '$lib/server/db/repo';
import { generateGuide, type GuideImplant } from '$lib/server/guideGen';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import { applyRot3, norm, rotationAligning, transpose3 } from '$lib/geometry';
import { applyMat4, type Mat4 } from '$lib/registration';
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

	// insertion direction: rotate everything so the seating axis is vertical,
	// generate, then rotate the result back.
	// 'auto' = mean implant axis; 'vertical' = volume -z (mandible default).
	const insertionMode = body.insertion === 'vertical' ? 'vertical' : 'auto';
	let seat = { x: 0, y: 0, z: -1 };
	if (insertionMode === 'auto') {
		const sum = withSleeves.reduce(
			(a, im) => ({ x: a.x + im.axis.x, y: a.y + im.axis.y, z: a.z + im.axis.z }),
			{ x: 0, y: 0, z: 0 }
		);
		const n = norm(sum);
		// guard against degenerate / horizontal averages
		if (Math.abs(n.z) > 0.3) seat = n;
	}
	const R = rotationAligning(seat, { x: 0, y: 0, z: -1 });
	const Rinv = transpose3(R);

	// rotate scan vertices (after their own transform) into the insertion frame
	const rotated = new Float32Array(mesh.positions.length);
	for (let i = 0; i < mesh.positions.length; i += 3) {
		let v = { x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] };
		if (transform) v = applyMat4(transform as Mat4, v);
		v = applyRot3(R, v);
		rotated[i] = v.x;
		rotated[i + 1] = v.y;
		rotated[i + 2] = v.z;
	}
	const rotatedImplants = withSleeves.map((im) => ({
		head: applyRot3(R, im.head),
		axis: applyRot3(R, im.axis),
		sleeve: im.sleeve
	}));

	const p = body.params ?? {};
	const guide = generateGuide(rotated, null, rotatedImplants, {
		offset: Number(p.offset) || 0.15,
		thickness: Number(p.thickness) || 2.5,
		regionRadius: Number(p.regionRadius) || 9,
		voxel: Number(p.voxel) || 0.3
	});
	if (guide.triangles === 0) error(400, 'Guide generation produced an empty mesh');

	// rotate the guide back into volume space
	for (let i = 0; i < guide.positions.length; i += 3) {
		const v = applyRot3(Rinv, {
			x: guide.positions[i],
			y: guide.positions[i + 1],
			z: guide.positions[i + 2]
		});
		guide.positions[i] = v.x;
		guide.positions[i + 1] = v.y;
		guide.positions[i + 2] = v.z;
	}

	const stl = meshToStlBinary(guide.positions, 'surgical_guide');
	const path = join(caseDir(caseId), `guide_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(path, stl);

	const guideModel = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, opacity, plan_id)
			 VALUES (?1, ?2, 'guide', ?3, '#4d9fd6', 0.85, ?4) RETURNING *`
		)
		.get(caseId, `Guide — ${plan.name}`, path, plan.id) as Model;

	return json({ model: guideModel, triangles: guide.triangles });
};
