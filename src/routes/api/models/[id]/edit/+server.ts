import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import {
	applyMeshEdit,
	applyMeshEditOps,
	listHoles,
	listParts,
	meshStats,
	partPositions,
	type MeshEditContext,
	type MeshEditOp,
	type Vec3
} from '$lib/server/meshEdit';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import type { Model } from '$lib/types';

const MAX_OPS = 300;
const MAX_MARGIN_POINTS = 2000;
const MAX_SMOOTH_CENTERS = 500;
const OP_NAMES = new Set([
	'smooth',
	'remesh',
	'fillHoles',
	'boundarySmooth',
	'bridge',
	'partialFill',
	'parts',
	'reduce',
	'invert',
	'erase',
	'marginCut',
	'combine'
]);

function parseVec3(v: unknown): Vec3 | null {
	const x = Number((v as Vec3)?.x);
	const y = Number((v as Vec3)?.y);
	const z = Number((v as Vec3)?.z);
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function posNum(v: unknown, what: string): number {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) error(400, `${what} must be a number > 0`);
	return n;
}

/** Validate a client-held op list (the replay contract). 400s on bad input. */
function validateOps(raw: unknown): MeshEditOp[] {
	if (!Array.isArray(raw)) error(400, 'ops must be an array');
	if (raw.length > MAX_OPS) error(400, `Too many ops (max ${MAX_OPS})`);
	return raw.map((item, i) => {
		const at = `ops[${i}]`;
		const name = (item as MeshEditOp)?.op;
		if (typeof name !== 'string' || !OP_NAMES.has(name)) error(400, `${at}: unknown op`);
		const op: MeshEditOp = { op: name as MeshEditOp['op'] };
		const o = item as Record<string, unknown>;
		switch (op.op) {
			case 'smooth': {
				if (o.mode != null) {
					if (o.mode !== 'flatten' && o.mode !== 'add') error(400, `${at}: mode must be 'flatten' | 'add'`);
					op.mode = o.mode;
				}
				if (o.strength != null) {
					if (!['A', 'B', 'C', 'D'].includes(String(o.strength))) error(400, `${at}: strength must be A–D`);
					op.strength = o.strength as MeshEditOp['strength'];
				}
				if (o.center != null) {
					const c = parseVec3(o.center);
					if (!c) error(400, `${at}: bad center`);
					op.center = c;
				}
				if (o.points != null) {
					// select-area smoothing: union of spheres around several centers
					if (!Array.isArray(o.points) || o.points.length < 1) {
						error(400, `${at}: points must be a non-empty array`);
					}
					if (o.points.length > MAX_SMOOTH_CENTERS) error(400, `${at}: too many smooth centers`);
					const pts = (o.points as unknown[]).map((p) => parseVec3(p));
					if (pts.some((p) => !p)) error(400, `${at}: bad smooth center`);
					op.points = pts as Vec3[];
				}
				if (o.radius != null) op.radius = posNum(o.radius, `${at}: radius`);
				break;
			}
			case 'remesh': {
				if (o.center != null) {
					const c = parseVec3(o.center);
					if (!c) error(400, `${at}: bad center`);
					op.center = c;
				}
				if (o.radius != null) op.radius = posNum(o.radius, `${at}: radius`);
				if (o.maxEdge != null) op.maxEdge = posNum(o.maxEdge, `${at}: maxEdge`);
				if (o.iterations != null) {
					const it = Number(o.iterations);
					if (!Number.isInteger(it) || it < 0 || it > 10) error(400, `${at}: iterations must be 0–10`);
					op.iterations = it;
				}
				break;
			}
			case 'fillHoles': {
				if (o.hole != null) {
					const h = Number(o.hole);
					if (!Number.isInteger(h) || h < 0) error(400, `${at}: hole must be an index ≥ 0`);
					op.hole = h;
				}
				if (o.exceptLargest != null) op.exceptLargest = Boolean(o.exceptLargest);
				if (o.maxEdges != null) op.maxEdges = posNum(o.maxEdges, `${at}: maxEdges`);
				break;
			}
			case 'boundarySmooth': {
				if (o.iterations != null) {
					const it = Number(o.iterations);
					if (!Number.isInteger(it) || it < 1 || it > 10) error(400, `${at}: iterations must be 1–10`);
					op.iterations = it;
				}
				if (o.loop != null) {
					const l = Number(o.loop);
					if (!Number.isInteger(l) || l < 0) error(400, `${at}: loop must be an index ≥ 0`);
					op.loop = l;
				}
				break;
			}
			case 'bridge':
			case 'partialFill': {
				const a = parseVec3(o.a);
				const b = parseVec3(o.b);
				if (!a || !b) error(400, `${at}: ${op.op} requires points a and b`);
				op.a = a;
				op.b = b;
				break;
			}
			case 'parts': {
				if (!['deleteSelected', 'keepSelected', 'keepLargest'].includes(String(o.action))) {
					error(400, `${at}: action must be deleteSelected | keepSelected | keepLargest`);
				}
				op.action = o.action as MeshEditOp['action'];
				if (o.action !== 'keepLargest') {
					const p = Number(o.part);
					if (!Number.isInteger(p) || p < 0) error(400, `${at}: part must be an index ≥ 0`);
					op.part = p;
				}
				break;
			}
			case 'reduce': {
				const p = Number(o.targetPercent);
				if (!Number.isFinite(p) || p < 1 || p > 100) error(400, `${at}: targetPercent must be 1–100`);
				op.targetPercent = p;
				break;
			}
			case 'invert':
				break;
			case 'erase': {
				const c = parseVec3(o.center);
				if (!c) error(400, `${at}: erase requires center {x,y,z}`);
				op.center = c;
				if (o.radius != null) op.radius = posNum(o.radius, `${at}: radius`);
				if (o.deep != null) op.deep = Boolean(o.deep);
				if (o.axis != null) {
					const a = parseVec3(o.axis);
					if (!a) error(400, `${at}: bad axis`);
					op.axis = a;
				}
				if (o.depth != null) op.depth = posNum(o.depth, `${at}: depth`);
				break;
			}
			case 'marginCut': {
				if (!Array.isArray(o.points) || o.points.length < 3) {
					error(400, `${at}: marginCut requires ≥ 3 points`);
				}
				if (o.points.length > MAX_MARGIN_POINTS) error(400, `${at}: too many margin points`);
				const pts = (o.points as unknown[]).map((p) => parseVec3(p));
				if (pts.some((p) => !p)) error(400, `${at}: bad margin point`);
				op.points = pts as Vec3[];
				if (o.keep !== 'inside' && o.keep !== 'outside') {
					error(400, `${at}: keep must be 'inside' | 'outside'`);
				}
				op.keep = o.keep;
				break;
			}
			case 'combine': {
				const id = Number(o.modelId);
				if (!Number.isInteger(id) || id <= 0) error(400, `${at}: combine requires modelId`);
				op.modelId = id;
				if (o.mode != null) {
					if (o.mode !== 'merge' && o.mode !== 'subtract') {
						error(400, `${at}: mode must be 'merge' | 'subtract'`);
					}
					op.mode = o.mode;
				}
				break;
			}
		}
		return op;
	});
}

function getModel(id: number): Model {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	return m;
}

async function loadPositions(m: Model): Promise<{ positions: Float32Array; bytes: Uint8Array }> {
	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = parseStl(bytes) ?? parsePly(bytes);
	if (!parsed) error(400, 'Model file is not a readable STL/PLY mesh');
	return { positions: parsed.positions, bytes };
}

function parseTransform(raw: string | null | undefined): number[] | null {
	if (!raw) return null;
	try {
		const t = JSON.parse(raw);
		return Array.isArray(t) && t.length === 16 ? (t as number[]) : null;
	} catch {
		return null;
	}
}

/** Combine-op resolver: sibling models of the same case, soup + transform. */
function editContext(m: Model): MeshEditContext {
	return {
		selfTransform: parseTransform(m.transform),
		loadModel: (otherId: number) => {
			const row = db
				.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
				.get(otherId, m.case_id) as Model | null;
			if (!row?.file_path || row.id === m.id) return null;
			let bytes: Uint8Array;
			try {
				bytes = readFileSync(resolveData(row.file_path));
			} catch {
				return null;
			}
			const parsed = parseStl(bytes) ?? parsePly(bytes);
			if (!parsed) return null;
			return { positions: parsed.positions, transform: parseTransform(row.transform) };
		}
	};
}

function replayOrError(positions: Float32Array, ops: MeshEditOp[], ctx: MeshEditContext) {
	try {
		return applyMeshEditOps(positions, ops, ctx);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Mesh edit failed');
	}
}

function binaryMesh(positions: Float32Array, vertices: number, reports: unknown): Response {
	// all soups here are freshly built arrays that own their whole buffer
	return new Response(positions.buffer as ArrayBuffer, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Triangles': String(positions.length / 9),
			'X-Vertices': String(vertices),
			'X-Reports': JSON.stringify(reports)
		}
	});
}

/**
 * Mesh editor inspection (SPEC §5.7). Query:
 *   ?inspect=stats (default) → { name, triangles, vertices, models: [{id,name,kind}] }
 *                              (models = same-case siblings, for Combine)
 *   ?inspect=parts           → { triangles, vertices, parts: [{index,triangles,vertices}] }
 *   ?inspect=holes           → { triangles, vertices, openEdges, holes: [...] }
 *   ?inspect=part&part=k     → binary Float32 soup of part k (for highlighting)
 *   &ops=<json MeshEditOp[]> → inspect the replayed (preview) state instead of the file
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const m = getModel(Number(params.id));
	let { positions } = await loadPositions(m);

	const opsRaw = url.searchParams.get('ops');
	if (opsRaw) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(opsRaw);
		} catch {
			error(400, 'ops is not valid JSON');
		}
		positions = replayOrError(positions, validateOps(parsed), editContext(m)).positions;
	}

	const inspect = url.searchParams.get('inspect') ?? 'stats';
	if (inspect === 'parts') {
		return json(listParts(positions));
	}
	if (inspect === 'holes') {
		const stats = meshStats(positions);
		return json({ ...stats, ...listHoles(positions) });
	}
	if (inspect === 'part') {
		const idx = Number(url.searchParams.get('part'));
		if (!Number.isInteger(idx) || idx < 0) error(400, 'part must be an index ≥ 0');
		let part: Float32Array;
		try {
			part = partPositions(positions, idx);
		} catch (e) {
			error(400, e instanceof Error ? e.message : 'Part not found');
		}
		return binaryMesh(part, 0, []);
	}
	const stats = meshStats(positions);
	const siblings = db
		.query('SELECT id, name, kind FROM models WHERE case_id = ?1 AND id != ?2 ORDER BY id')
		.all(m.case_id, m.id) as { id: number; name: string; kind: string }[];
	return json({ name: m.name, caseId: m.case_id, ...stats, models: siblings });
};

/**
 * Mesh editor (SPEC §5.7). Two contracts:
 *
 * Replay (the Mesh Editor window): { ops: MeshEditOp[], apply?, saveAsCopy?, name? }
 *   The op list is CLIENT-HELD and re-applied here from the model's pristine
 *   baseline (= the file as it is on disk — previews never write, so the file
 *   stays the session baseline until Apply). Undo/redo are therefore pop /
 *   re-push + replay, and Cancel needs no server call at all.
 *     default      → preview: binary Float32 soup of the replayed mesh
 *                    (X-Triangles / X-Vertices / X-Reports headers), no write.
 *     apply        → overwrite the model file (one-time <file>.orig backup,
 *                    same mechanism as the legacy contract below).
 *     saveAsCopy   → write the result as a NEW model row of the same case
 *                    (kind/color/transform copied; name defaults to
 *                    "<name> (edited)"); the source file is left untouched.
 *
 * Legacy single op (kept for the planning sidebar's quick tools):
 *   { op: 'smooth'|'remesh'|'fillHoles'|'bridge', ... } — rewrites the file in
 *   place as binary STL; the very first edit stores a one-time backup next to
 *   it (<file>.orig). Models whose file is not already STL (e.g. imported PLY
 *   scans) get a fresh .stl file and the row's file_path is updated.
 *
 * Returns { triangles, report(s) }. Audited as 'model.edit'.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const m = getModel(Number(params.id));
	const body = await request.json().catch(() => ({}));

	/* ---------------- replay contract ---------------- */
	if (Array.isArray(body.ops)) {
		const ops = validateOps(body.ops);
		const { positions, bytes } = await loadPositions(m);
		const replay = replayOrError(positions, ops, editContext(m));
		if (replay.positions.length < 9) error(400, 'Edit would leave an empty mesh');

		if (body.saveAsCopy) {
			const name =
				typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `${m.name} (edited)`;
			const rel = join(caseRel(m.case_id), `model_${crypto.randomUUID().slice(0, 8)}.stl`);
			await Bun.write(resolveData(rel), meshToStlBinary(replay.positions, name));
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
				'model.edit',
				`model:${m.id}`,
				`${ops.length} op(s), saved as copy → model:${row.id} (${replay.triangles} triangles)`
			);
			return json({
				model: row,
				triangles: replay.triangles,
				vertices: replay.vertices,
				reports: replay.reports
			});
		}

		if (body.apply) {
			const absPath = resolveData(m.file_path);
			const origPath = `${absPath}.orig`;
			if (!(await Bun.file(origPath).exists())) {
				await Bun.write(origPath, bytes);
			}
			const stl = meshToStlBinary(replay.positions, m.name);
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
				`${ops.length} op(s) applied — ${m.name} (${replay.triangles} triangles)`
			);
			return json({ triangles: replay.triangles, vertices: replay.vertices, reports: replay.reports });
		}

		// preview: never writes — the on-disk file remains the session baseline
		return binaryMesh(replay.positions, replay.vertices, replay.reports);
	}

	/* ---------------- legacy single-op contract ---------------- */
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
	const { positions, bytes } = await loadPositions(m);

	let result;
	try {
		result = applyMeshEdit(positions, op);
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
