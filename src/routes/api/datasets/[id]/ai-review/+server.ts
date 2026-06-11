import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { getDataset, getMasterPlan, getPlan, listModels, listNerves, logAudit, updatePlan } from '$lib/server/db/repo';
import { parseStl, parsePly } from '$lib/server/stl';
import { canalCenterline, classifyAiModel, validateReviewApply } from '$lib/aiReviewMap';
import type { Nerve, Plan } from '$lib/types';

/**
 * AI-assistant review wizard aggregate (AiReviewWizard.svelte).
 *
 * GET ?planId=… → one bundle of everything the wizard reviews that is awkward
 * to assemble from the existing per-object endpoints:
 *   {
 *     dataset: { id, caseId, cols, rows, slices, spacing{x,y,z}, windowCenter, windowWidth },
 *     plan:    { id, locked },                       // ?planId or the master plan
 *     models:  [{ id, name, kind, color, ok, ai,    // ok = surface file with >0 triangles
 *                 objectKind, fdi, side, arch, label, transform }],
 *     canals:  [{ modelId, side, points }],          // centerline proposals from AI canal meshes
 *     pano:    { control, z } | null,                // plan's saved panoramic curve, if any
 *     scans:   [{ id, name, color, transform }]      // registered model scans (kind 'scan' + transform)
 *   }
 * PCS + pano proposals stay on the existing POST /api/datasets/[id]/pcs-propose.
 *
 * POST → apply the reviewed data (one transactional call instead of N client
 * PATCHes): body { planId?, pano?: {control,z}, nerves?: {right?/left?: {points, diameter?}} }
 * — pano is written to plans.pan_curve, nerves are upserted by name
 * ('Right nerve canal' / 'Left nerve canal'). Model keep/delete stays with the
 * case page (same contract as the old review dialog), the PCS rotation stays
 * on the existing POST /api/datasets/[id]/align.
 */

function resolvePlan(caseId: number, planId: number | undefined): Plan {
	if (planId) {
		const plan = getPlan(planId);
		if (!plan) error(404, 'Plan not found');
		if (plan.case_id !== caseId) error(400, 'Plan does not belong to this case');
		return plan;
	}
	return getMasterPlan(caseId);
}

function parseTransform(raw: string | null): number[] | null {
	try {
		const t = raw ? JSON.parse(raw) : null;
		return Array.isArray(t) && t.length === 16 ? t : null;
	} catch {
		return null;
	}
}

export const GET: RequestHandler = async ({ params, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const plan = resolvePlan(ds.case_id, Number(url.searchParams.get('planId')) || undefined);

	const models: {
		id: number;
		name: string;
		kind: string;
		color: string;
		ok: boolean;
		ai: boolean;
		objectKind: string;
		fdi: number | null;
		side: 'left' | 'right' | null;
		arch: 'upper' | 'lower' | null;
		label: string;
		transform: number[] | null;
		filePath: string;
	}[] = [];

	for (const m of listModels(ds.case_id)) {
		let p: { ai?: boolean; class?: string; fdi?: number } = {};
		try {
			p = m.params ? JSON.parse(m.params) : {};
		} catch {
			p = {};
		}
		const info = classifyAiModel(m.name, p);
		// ok = a surface file exists with at least one triangle (binary STL: 84-byte
		// header+count; ASCII/PLY just need non-trivial content)
		let ok = false;
		if (m.file_path) {
			const f = Bun.file(resolveData(m.file_path));
			ok = (await f.exists()) && f.size > 84;
		}
		models.push({
			id: m.id,
			name: m.name,
			kind: m.kind,
			color: m.color,
			ok,
			ai: !!p.ai,
			objectKind: info.kind,
			fdi: info.fdi,
			side: info.side,
			arch: info.arch,
			label: info.label,
			transform: parseTransform(m.transform),
			filePath: m.file_path
		});
	}

	// canal centerline proposals from the AI canal surface meshes (small meshes)
	const canals: { modelId: number; side: 'left' | 'right'; points: { x: number; y: number; z: number }[] }[] = [];
	for (const m of models) {
		if (!m.ai || m.objectKind !== 'canal' || !m.ok || !m.side) continue;
		try {
			const bytes = new Uint8Array(await Bun.file(resolveData(m.filePath)).arrayBuffer());
			const ext = m.filePath.split('.').pop()?.toLowerCase();
			const mesh = ext === 'ply' ? parsePly(bytes) : parseStl(bytes);
			if (!mesh) continue;
			const points = canalCenterline(mesh.positions, m.transform, 12);
			if (points) canals.push({ modelId: m.id, side: m.side, points });
		} catch {
			// unreadable mesh — no proposal for this canal
		}
	}

	let pano: { control: { x: number; y: number }[]; z: number } | null = null;
	try {
		const saved = plan.pan_curve ? JSON.parse(plan.pan_curve) : null;
		if (saved?.control?.length >= 2) {
			pano = { control: saved.control, z: saved.z ?? Math.floor(ds.slices / 2) };
		}
	} catch {
		pano = null;
	}

	const scans = models
		.filter((m) => m.kind === 'scan' && m.transform)
		.map((m) => ({ id: m.id, name: m.name, color: m.color, transform: m.transform }));

	return json({
		dataset: {
			id: ds.id,
			caseId: ds.case_id,
			cols: ds.cols,
			rows: ds.rows,
			slices: ds.slices,
			spacing: { x: ds.spacing_x, y: ds.spacing_y, z: ds.spacing_z },
			windowCenter: ds.window_center,
			windowWidth: ds.window_width
		},
		plan: { id: plan.id, locked: !!plan.locked },
		models: models.map(({ filePath: _drop, ...rest }) => rest),
		canals,
		pano,
		scans
	});
};

const NERVE_NAMES: Record<'right' | 'left', string> = {
	right: 'Right nerve canal',
	left: 'Left nerve canal'
};
const NERVE_COLORS: Record<'right' | 'left', string> = {
	right: '#e8d44d',
	left: '#e8a44d'
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	const v = validateReviewApply(body);
	if (!v.ok) error(400, v.error);

	const plan = resolvePlan(ds.case_id, v.value.planId);
	if (plan.locked) error(409, 'Plan is locked');

	const applied: { pano: boolean; nerves: string[] } = { pano: false, nerves: [] };

	if (v.value.pano) {
		const z = Math.max(0, Math.min(ds.slices - 1, v.value.pano.z));
		updatePlan(plan.id, {
			pan_curve: JSON.stringify({ control: v.value.pano.control, z })
		});
		applied.pano = true;
	}

	if (v.value.nerves) {
		const existing = listNerves(plan.id);
		for (const side of ['right', 'left'] as const) {
			const nerve = v.value.nerves[side];
			if (!nerve) continue;
			const name = NERVE_NAMES[side];
			const points = JSON.stringify(nerve.points);
			const prior = existing.find((n: Nerve) => n.name === name);
			if (prior) {
				db.query('UPDATE nerves SET points = ?2, diameter = ?3 WHERE id = ?1').run(
					prior.id,
					points,
					nerve.diameter ?? prior.diameter
				);
			} else {
				db.query(
					`INSERT INTO nerves (plan_id, name, color, diameter, points)
					 VALUES (?1, ?2, ?3, ?4, ?5)`
				).run(plan.id, name, NERVE_COLORS[side], nerve.diameter ?? 2.0, points);
			}
			applied.nerves.push(side);
		}
	}

	logAudit(
		locals.user,
		'aireview.apply',
		`dataset:${ds.id}`,
		`plan:${plan.id} ${applied.pano ? 'pano ' : ''}${applied.nerves.join(' ')}`.trim()
	);
	return json({ ok: true, planId: plan.id, applied });
};
