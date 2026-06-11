import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getCase, getPlan, listImplants, logAudit, setSetting } from '$lib/server/db/repo';
import {
	cutGuideToolPaths,
	generateGuide,
	GUIDE_RECIPES,
	validateGuideDesign,
	type GuideImplant,
	type GuideParams,
	type GuideReductionBar
} from '$lib/server/guideGen';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import { applyRot3, norm, rotationAligning, transpose3 } from '$lib/geometry';
import { applyMat4, type Mat4 } from '$lib/registration';
import type { Model } from '$lib/types';

/**
 * Body:
 *  { planId, convertToModel: true }
 *    — copies the plan's existing generated guide STL into a new 'other' model
 *      row (stacked-guide base). Never regenerates. Responds { model }.
 *
 *  { modelId, planId, insertion?, windows?, intaglioModelId?, mergeModelIds?, params? }
 *    — (re)generates the guide. params may carry:
 *      offset, thickness, regionRadius, voxel, mountWall,
 *      largeConnectors, mountHoleShape ('cylindrical' | 'fitForm'),
 *      label { text, x, y, height?, depth?, style? ('embossed' | 'impressed') },
 *      supportRegions [{ x, y, radius }],
 *      contactPolygons [[{ x, y }, ...]],
 *      reductionBars [{ x1, y1, x2, y2, width, height, zTop }].
 *      intaglioModelId: a second model of the same case whose surface is used
 *      for the intaglio heightfield (dual-scan denture bottom).
 *      mergeModelIds: other case models (typically the imported denture STL)
 *      merged INTO the produced guide STL as additional shells, with the
 *      guide's drill corridors and inspection windows cut through them
 *      ("Add object", coDX 9.10 dual-scan).
 *      intaglioModelId / mergeModelIds are also accepted inside params.
 *      Responds { model, triangles, warnings }.
 */
export const GET: RequestHandler = async () => {
	return json({
		recipes: GUIDE_RECIPES.map((r) => ({ key: r.key, name: r.name, description: r.description, params: r.params }))
	});
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const body = await request.json().catch(() => ({}));
	const plan = getPlan(Number(body.planId));
	if (!plan || plan.case_id !== caseId) error(404, 'Plan not found');

	/* ---- convert guide → 3D model (stacked-guide base) — no regeneration ---- */
	if (body.convertToModel) {
		const guideRow = db
			.query(`SELECT * FROM models WHERE case_id = ?1 AND kind = 'guide' AND plan_id = ?2`)
			.get(caseId, plan.id) as Model | null;
		if (!guideRow || !guideRow.file_path) {
			error(404, 'No generated guide to convert — generate the guide first');
		}
		const copyPath = join(caseRel(caseId), `guide_model_${crypto.randomUUID().slice(0, 8)}.stl`);
		await Bun.write(resolveData(copyPath), Bun.file(resolveData(guideRow.file_path)));
		const row = db
			.query(
				`INSERT INTO models (case_id, name, kind, file_path, color, opacity, plan_id, transform)
				 VALUES (?1, ?2, 'other', ?3, ?4, ?5, ?6, ?7) RETURNING *`
			)
			.get(
				caseId,
				`${plan.name} guide as model`,
				copyPath,
				guideRow.color,
				guideRow.opacity,
				plan.id,
				guideRow.transform ?? ''
			) as Model;
		logAudit(locals.user, 'guide.convert', `plan:${plan.id}`, `model:${row.id}`);
		return json({ model: row });
	}

	if (plan.locked) error(409, 'Plan is locked');
	if (plan.approved) {
		error(409, 'Plan is approved — revoke approval before regenerating the guide');
	}

	const model = db
		.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
		.get(Number(body.modelId), caseId) as Model | null;
	if (!model) error(404, 'Base model not found');

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

	const loadSoup = async (m: Model): Promise<Float32Array> => {
		const bytes = new Uint8Array(await Bun.file(resolveData(m.file_path)).arrayBuffer());
		const parsed = m.file_path.endsWith('.ply') ? parsePly(bytes) : parseStl(bytes);
		if (!parsed) error(400, `Could not parse model file of "${m.name}"`);
		return parsed.positions;
	};
	const parseTransform = (m: Model): number[] | null => {
		try {
			const t = m.transform ? JSON.parse(m.transform) : null;
			return Array.isArray(t) && t.length === 16 ? t : null;
		} catch {
			return null;
		}
	};

	const positions = await loadSoup(model);
	const transform = parseTransform(model);

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
	const rotateSoup = (src: Float32Array, xf: number[] | null): Float32Array => {
		const out = new Float32Array(src.length);
		for (let i = 0; i < src.length; i += 3) {
			let v = { x: src[i], y: src[i + 1], z: src[i + 2] };
			if (xf) v = applyMat4(xf as Mat4, v);
			v = applyRot3(R, v);
			out[i] = v.x;
			out[i + 1] = v.y;
			out[i + 2] = v.z;
		}
		return out;
	};
	const rotated = rotateSoup(positions, transform);
	const rotatedImplants = withSleeves.map((im) => ({
		head: applyRot3(R, im.head),
		axis: applyRot3(R, im.axis),
		sleeve: im.sleeve
	}));

	// dual-scan bottom: second model of the same case supplies the intaglio
	// surface (merged with the primary scan for heightfield sampling)
	let intaglio: Float32Array | null = null;
	const intaglioModelId = Number(body.intaglioModelId ?? body.params?.intaglioModelId);
	if (Number.isFinite(intaglioModelId) && intaglioModelId > 0) {
		const im = db
			.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
			.get(intaglioModelId, caseId) as Model | null;
		if (!im) error(404, 'Intaglio model not found');
		intaglio = rotateSoup(await loadSoup(im), parseTransform(im));
	}

	// "Add object" (coDX 9.10 dual-scan): other case models merged into the
	// produced guide as additional shells, with the guide's tool paths (drill
	// corridors) and inspection windows cut through them.
	const mergeIdsRaw = Array.isArray(body.mergeModelIds)
		? body.mergeModelIds
		: Array.isArray(body.params?.mergeModelIds)
			? body.params.mergeModelIds
			: [];
	const mergeModelIds = [
		...new Set(
			(mergeIdsRaw as unknown[])
				.map((v) => Number(v))
				.filter((n) => Number.isFinite(n) && n > 0)
		)
	].slice(0, 8);
	const mergeSoups: Float32Array[] = [];
	for (const mid of mergeModelIds) {
		const mm = db
			.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
			.get(mid, caseId) as Model | null;
		if (!mm) error(404, `Merge model ${mid} not found`);
		if (mm.kind === 'guide') continue; // never merge a generated guide into itself
		mergeSoups.push(rotateSoup(await loadSoup(mm), parseTransform(mm)));
	}

	const p = body.params ?? {};
	const fin = (v: unknown): number | null => {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	};
	// xy coordinates arrive in volume coords — rotate into the insertion frame
	const rotXY = (x: number, y: number, z = 0): { x: number; y: number; z: number } =>
		applyRot3(R, { x, y, z });

	// inspection windows
	const windows = (Array.isArray(body.windows) ? body.windows : [])
		.filter(
			(w: { x?: number; y?: number; diameter?: number }) =>
				Number.isFinite(w?.x) && Number.isFinite(w?.y) && Number(w?.diameter) > 0.5
		)
		.map((w: { x: number; y: number; z?: number; diameter: number }) => {
			const cc = rotXY(w.x, w.y, Number(w.z) || 0);
			return { x: cc.x, y: cc.y, diameter: Math.min(12, Number(w.diameter)) };
		});

	// embossed label
	let label: GuideParams['label'];
	if (p.label && typeof p.label.text === 'string' && p.label.text.trim().length > 0) {
		const lx = fin(p.label.x);
		const ly = fin(p.label.y);
		if (lx !== null && ly !== null) {
			const cc = rotXY(lx, ly);
			label = {
				text: String(p.label.text).slice(0, 24),
				x: cc.x,
				y: cc.y,
				height: Math.min(10, Math.max(1, fin(p.label.height) ?? 3)),
				depth: Math.min(2, Math.max(0.2, fin(p.label.depth) ?? 0.8)),
				style: p.label.style === 'impressed' ? 'impressed' : 'embossed'
			};
		}
	}

	// bone support regions
	const supportRegions = (Array.isArray(p.supportRegions) ? p.supportRegions : [])
		.filter(
			(s: { x?: number; y?: number; radius?: number }) =>
				fin(s?.x) !== null && fin(s?.y) !== null && Number(s?.radius) > 0.5
		)
		.map((s: { x: number; y: number; radius: number }) => {
			const cc = rotXY(s.x, s.y);
			return { x: cc.x, y: cc.y, radius: Math.min(20, Number(s.radius)) };
		});

	// free-hand contact polygons
	const contactPolygons = (Array.isArray(p.contactPolygons) ? p.contactPolygons : [])
		.filter((poly: unknown) => Array.isArray(poly) && poly.length >= 3)
		.map((poly: { x: number; y: number }[]) =>
			poly
				.filter((pt) => fin(pt?.x) !== null && fin(pt?.y) !== null)
				.map((pt) => {
					const cc = rotXY(pt.x, pt.y);
					return { x: cc.x, y: cc.y };
				})
		)
		.filter((poly: { x: number; y: number }[]) => poly.length >= 3);

	// bone reduction bars
	const reductionBars: GuideReductionBar[] = (
		Array.isArray(p.reductionBars) ? p.reductionBars : []
	)
		.filter(
			(b: Record<string, unknown>) =>
				fin(b?.x1) !== null &&
				fin(b?.y1) !== null &&
				fin(b?.x2) !== null &&
				fin(b?.y2) !== null &&
				Number(b?.width) > 0 &&
				Number(b?.height) > 0 &&
				fin(b?.zTop) !== null
		)
		.map((b: { x1: number; y1: number; x2: number; y2: number; width: number; height: number; zTop: number }) => {
			const a = rotXY(b.x1, b.y1, b.zTop);
			const e = rotXY(b.x2, b.y2, b.zTop);
			return {
				x1: a.x,
				y1: a.y,
				x2: e.x,
				y2: e.y,
				width: Math.min(10, Number(b.width)),
				height: Math.min(10, Number(b.height)),
				zTop: (a.z + e.z) / 2
			};
		});

	const guideParams: GuideParams = {
		offset: fin(p.offset) ?? 0.15,
		thickness: fin(p.thickness) ?? 2.5,
		regionRadius: fin(p.regionRadius) ?? 9,
		voxel: Math.min(1, Math.max(0.15, fin(p.voxel) ?? 0.3)),
		mountWall: fin(p.mountWall) ?? 1.6,
		windows,
		label,
		supportRegions,
		contactPolygons,
		reductionBars,
		largeConnectors: Boolean(p.largeConnectors),
		mountHoleShape: p.mountHoleShape === 'fitForm' ? 'fitForm' : 'cylindrical'
	};

	const guide = generateGuide(rotated, null, rotatedImplants, guideParams, intaglio);
	if (guide.triangles === 0) error(400, 'Guide generation produced an empty mesh');

	// design-rule validation (in the insertion frame, same data as generation)
	const warnings = validateGuideDesign(rotatedImplants, guideParams, guide);

	// "Add object": append the merged shells with the tool paths cut through
	// them (same corridor/window volumes the body generation cleared).
	let outPositions = guide.positions;
	if (mergeSoups.length > 0) {
		const shells = mergeSoups.map((s) => cutGuideToolPaths(s, rotatedImplants, guideParams));
		const combined = new Float32Array(
			outPositions.length + shells.reduce((a, s) => a + s.length, 0)
		);
		combined.set(outPositions, 0);
		let off = outPositions.length;
		for (const s of shells) {
			combined.set(s, off);
			off += s.length;
		}
		outPositions = combined;
	}
	const outTriangles = outPositions.length / 9;

	// rotate the guide (and merged shells) back into volume space
	for (let i = 0; i < outPositions.length; i += 3) {
		const v = applyRot3(Rinv, {
			x: outPositions[i],
			y: outPositions[i + 1],
			z: outPositions[i + 2]
		});
		outPositions[i] = v.x;
		outPositions[i + 1] = v.y;
		outPositions[i + 2] = v.z;
	}

	const stl = meshToStlBinary(outPositions, 'surgical_guide');
	const path = join(caseRel(caseId), `guide_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(path), stl);

	// regenerating replaces this plan's previous guide
	const old = db
		.query(`SELECT * FROM models WHERE case_id = ?1 AND kind = 'guide' AND plan_id = ?2`)
		.all(caseId, plan.id) as Model[];
	for (const o of old) {
		if (o.file_path) await unlink(resolveData(o.file_path)).catch(() => {});
		db.query('DELETE FROM models WHERE id = ?1').run(o.id);
	}

	const guideModel = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, opacity, plan_id)
			 VALUES (?1, ?2, 'guide', ?3, '#4d9fd6', 0.85, ?4) RETURNING *`
		)
		.get(caseId, `Guide — ${plan.name}`, path, plan.id) as Model;

	db.query('UPDATE plans SET guide_stale = 0 WHERE id = ?1').run(plan.id);

	// persist the (un-rotated, client-space) generation parameters per plan so
	// the UI can restore them — there is no plans.guide_params column, so they
	// live in the settings table under a per-plan key.
	setSetting(
		`guide_params_${plan.id}`,
		JSON.stringify({
			modelId: Number(body.modelId),
			insertion: insertionMode,
			intaglioModelId: Number.isFinite(intaglioModelId) && intaglioModelId > 0 ? intaglioModelId : null,
			mergeModelIds,
			windows: Array.isArray(body.windows) ? body.windows : [],
			params: p
		})
	);

	logAudit(
		locals.user,
		'guide.generate',
		`plan:${plan.id}`,
		`${outTriangles} triangles, ${warnings.length} warning(s)` +
			(mergeSoups.length > 0 ? `, ${mergeSoups.length} merged object(s)` : '')
	);
	return json({ model: guideModel, triangles: outTriangles, warnings });
};
