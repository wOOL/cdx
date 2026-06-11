import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveData } from '$lib/server/db';
import { getCase, getMasterPlan, getPlan, listImplants, listModels } from '$lib/server/db/repo';
import { parsePly, parseStl } from '$lib/server/stl';
import { buildVpeParts, vpePreview, vpeSingleStl, vpeZip, type VpeImplant } from '$lib/server/vpe';
import { getScanbody, type VpeItem, type VpeRequest } from '$lib/vpeCatalog';
import type { Implant, Model, Plan } from '$lib/types';
import type { StoredAbutment } from '$lib/implantLibrary';

function parseAbutment(im: Implant): StoredAbutment | null {
	try {
		return im.abutment ? (JSON.parse(im.abutment) as StoredAbutment) : null;
	} catch {
		return null;
	}
}

function resolvePlan(caseId: number, planId: unknown): Plan {
	const plan = planId != null ? getPlan(Number(planId)) : getMasterPlan(caseId);
	if (!plan || plan.case_id !== caseId) error(404, 'Plan not found');
	return plan;
}

/** Dialog bootstrap: exportable models + the plan's implants (abutment parsed). ?plan= optional. */
export const GET: RequestHandler = async ({ params, url }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');
	const plan = resolvePlan(caseId, url.searchParams.get('plan'));

	const models = listModels(caseId)
		.filter((m) => m.file_path && m.kind !== 'guide')
		.map((m) => ({ id: m.id, name: m.name, kind: m.kind }));
	const implants = listImplants(plan.id).map((im) => ({
		id: im.id,
		tooth: im.tooth,
		manufacturer: im.manufacturer,
		line: im.line,
		article: im.article,
		diameter: im.diameter,
		abutment: parseAbutment(im)
	}));
	return json({ planId: plan.id, models, implants });
};

function validateItems(raw: unknown, implants: Map<number, VpeImplant>): VpeItem[] {
	if (!Array.isArray(raw)) error(400, 'items must be an array');
	const items: VpeItem[] = [];
	for (const r of raw as Record<string, unknown>[]) {
		if (typeof r !== 'object' || r === null) error(400, 'item must be an object');
		const implantId = Number(r.implantId);
		if (!implants.has(implantId)) error(400, `unknown implantId ${r.implantId}`);
		const level = r.level === 'abutment' ? 'abutment' : r.level === 'implant' ? 'implant' : null;
		if (!level) error(400, 'item level must be "implant" or "abutment"');
		const scanbodyId = r.scanbodyId == null ? null : String(r.scanbodyId);
		if (scanbodyId !== null && !getScanbody(scanbodyId)) {
			error(400, `unknown scanbody "${scanbodyId}"`);
		}
		items.push({ implantId, level, scanbodyId, include: r.include === true });
	}
	return items;
}

/** apply the model's stored column-major mat4 (if any) so the mesh sits in volume space */
function transformed(positions: Float32Array, m: Model): Float32Array {
	let t: number[] | null = null;
	try {
		const parsed = m.transform ? JSON.parse(m.transform) : null;
		if (Array.isArray(parsed) && parsed.length === 16) t = parsed;
	} catch {
		t = null;
	}
	if (!t) return positions;
	const out = new Float32Array(positions.length);
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		out[i] = t[0] * x + t[4] * y + t[8] * z + t[12];
		out[i + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
		out[i + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
	}
	return out;
}

/** rigid inverse of a column-major mat4 (R → Rᵀ, t → −Rᵀ·t) */
function rigidInverse(t: number[]): number[] {
	const tx = t[12];
	const ty = t[13];
	const tz = t[14];
	return [
		t[0], t[4], t[8], 0,
		t[1], t[5], t[9], 0,
		t[2], t[6], t[10], 0,
		-(t[0] * tx + t[1] * ty + t[2] * tz),
		-(t[4] * tx + t[5] * ty + t[6] * tz),
		-(t[8] * tx + t[9] * ty + t[10] * tz),
		1
	];
}

function applyMat(positions: Float32Array, t: number[]): Float32Array {
	const out = new Float32Array(positions.length);
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		out[i] = t[0] * x + t[4] * y + t[8] * z + t[12];
		out[i + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
		out[i + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
	}
	return out;
}

/** Virtual Planning Export: preview JSON or the .stl/.zip download (see VpeRequest). */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const body = (await request.json().catch(() => null)) as VpeRequest | null;
	if (!body || typeof body !== 'object') error(400, 'JSON body required');
	if (body.format !== 'stl') error(400, 'format must be "stl"');
	const mode = body.mode === 'analogs' ? 'analogs' : body.mode === 'untouched' ? 'untouched' : null;
	if (!mode) error(400, 'mode must be "untouched" or "analogs"');
	if (!body.source || typeof body.source !== 'object') error(400, 'source required');

	const plan = resolvePlan(caseId, body.planId ?? null);
	const implants: VpeImplant[] = listImplants(plan.id).map((im) => ({
		id: im.id,
		tooth: im.tooth,
		manufacturer: im.manufacturer,
		line: im.line,
		diameter: im.diameter,
		x: im.x,
		y: im.y,
		z: im.z,
		ax: im.ax,
		ay: im.ay,
		az: im.az,
		abutment: parseAbutment(im)
	}));
	const items = validateItems(body.items, new Map(implants.map((im) => [im.id, im])));

	const model = listModels(caseId).find((m) => m.id === Number(body.source.id));
	if (!model || !model.file_path) error(404, 'Source model not found');
	const wantSeg = body.source.kind === 'segmentation';
	if (wantSeg !== (model.kind === 'segmentation')) error(400, 'source kind does not match the model');

	const file = Bun.file(resolveData(model.file_path));
	if (!(await file.exists())) error(404, 'Source model file is missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = model.file_path.endsWith('.ply')
		? (parsePly(bytes) ?? parseStl(bytes))
		: (parseStl(bytes) ?? parsePly(bytes));
	if (!parsed) error(400, `Could not parse model file of "${model.name}"`);

	const parts = buildVpeParts(
		{ name: model.name, positions: transformed(parsed.positions, model) },
		mode,
		implants,
		items
	);

	// optional export coordinate system: re-express everything in a chosen
	// scan's local frame (inverse of its registration); no transform on the
	// frame model means it already IS the volume frame — nothing to do
	const frameId = Number((body as { frameModelId?: unknown }).frameModelId);
	if (Number.isFinite(frameId) && frameId > 0) {
		const fm = listModels(caseId).find((m) => m.id === frameId);
		if (!fm) error(400, 'frameModelId is not a model of this case');
		let ft: number[] | null = null;
		try {
			const p = fm.transform ? JSON.parse(fm.transform) : null;
			if (Array.isArray(p) && p.length === 16) ft = p;
		} catch {
			ft = null;
		}
		if (ft) {
			const inv = rigidInverse(ft);
			for (const part of parts) part.positions = applyMat(part.positions, inv);
		}
	}

	if (body.preview === true) return json(vpePreview(parts));

	const safe = `vpe_${caseId}_${model.name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '')}`;
	if (body.single !== false) {
		const stl = vpeSingleStl(parts, safe);
		return new Response(stl.buffer as ArrayBuffer, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${safe}.stl"`
			}
		});
	}
	const zip = vpeZip(parts);
	return new Response(zip.buffer as ArrayBuffer, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${safe}.zip"`
		}
	});
};
