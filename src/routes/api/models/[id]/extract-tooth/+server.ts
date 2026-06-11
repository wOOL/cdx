import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { classifyAiModel } from '$lib/aiReviewMap';
import {
	extractToothFromSoup,
	type ExtractMode,
	type MeshEditContext,
	type Vec3
} from '$lib/server/meshEdit';
import {
	extractToothMesh,
	type ToothExtractMode,
	type ToothExtractResult
} from '$lib/server/toothOps';
import { meshToStlBinary, parsePly, parseStl } from '$lib/server/stl';
import type { Model } from '$lib/types';

function parseVec3(v: unknown): Vec3 | null {
	const x = Number((v as Vec3)?.x);
	const y = Number((v as Vec3)?.y);
	const z = Number((v as Vec3)?.z);
	return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
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

function parseParams(raw: string | null | undefined): Record<string, unknown> {
	try {
		const p = raw ? JSON.parse(raw) : {};
		return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

async function loadSoup(m: Model): Promise<Float32Array> {
	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = parseStl(bytes) ?? parsePly(bytes);
	if (!parsed) error(400, 'Model file is not a readable STL/PLY mesh');
	return parsed.positions;
}

const INSERT_MODEL = `INSERT INTO models (case_id, name, kind, file_path, color, opacity, visible, transform, plan_id, params)
	 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) RETURNING *`;

/**
 * Tooth extraction on a surface scan. Two contracts:
 *
 * AI tooth extraction (the AI assistant video: scan → "Tooth extraction"):
 *   Body { toothModelId, mode: 'cut' | 'cut-close' | 'alveolus', addTooth? }
 *   [id] is the scan model, toothModelId an AI tooth model of the same case.
 *     'cut'       — drop the scan triangles inside the tooth, opening left as is
 *     'cut-close' — same, then close the cut openings (largest hole kept open)
 *     'alveolus'  — approximate CSG scan − tooth: the socket walls are kept
 *   The source models stay untouched; the result is a NEW model row
 *   '<scan name> (tooth extraction)' (kind 'scan', scan color/transform).
 *   addTooth additionally copies the tooth into its own planning model
 *   'Extracted tooth <fdi>' (kind 'waxup', own file — deleting either model
 *   never breaks the other, DELETE /api/models unlinks the row's file).
 *   → { model, toothModel?, removedTriangles, addedTriangles, holesFilled }
 *
 * Legacy automated virtual extraction (SPEC §5.6, implant-position capsule):
 *   Body { head: {x,y,z}, axis: {x,y,z}, diameter, mode: 'cut' | 'cutClose' |
 *   'cutAlveolus' } — triangles inside the capsule head → head + axis·depth
 *   are removed, '<name> (extracted)' is created. → { model, removed }
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');

	const body = await request.json().catch(() => ({}));

	/* ---------------- AI tooth extraction (toothModelId contract) ---------------- */
	if (body.toothModelId != null) {
		const mode = String(body.mode ?? '');
		if (!['cut', 'cut-close', 'alveolus'].includes(mode)) {
			error(400, "mode must be 'cut' | 'cut-close' | 'alveolus'");
		}
		const toothId = Number(body.toothModelId);
		if (!Number.isInteger(toothId) || toothId === m.id) {
			error(400, 'toothModelId must be another model of this case');
		}
		const tooth = db
			.query('SELECT * FROM models WHERE id = ?1 AND case_id = ?2')
			.get(toothId, m.case_id) as Model | null;
		if (!tooth || !tooth.file_path) error(404, 'Tooth model not found in this case');
		const tp = parseParams(tooth.params);
		const info = classifyAiModel(tooth.name, tp as { class?: string; fdi?: number });
		if (!tp.ai || info.kind !== 'tooth' || info.fdi == null) {
			error(400, 'toothModelId is not an AI tooth model');
		}

		const positions = await loadSoup(m);
		// same context contract as the Mesh Editor's combine op: the tooth is
		// mapped through inv(scanT) · toothT so both shells meet where the
		// planning views show them; the result lives in scan-local coordinates
		const ctx: MeshEditContext = {
			selfTransform: parseTransform(m.transform),
			loadModel: (otherId: number) => {
				if (otherId !== tooth.id) return null;
				let bytes: Uint8Array;
				try {
					bytes = readFileSync(resolveData(tooth.file_path));
				} catch {
					return null;
				}
				const parsed = parseStl(bytes) ?? parsePly(bytes);
				if (!parsed) return null;
				return { positions: parsed.positions, transform: parseTransform(tooth.transform) };
			}
		};

		let result: ToothExtractResult;
		try {
			result = extractToothMesh(positions, tooth.id, mode as ToothExtractMode, ctx);
		} catch (e) {
			error(400, e instanceof Error ? e.message : 'Tooth extraction failed');
		}
		if (
			result.removedTriangles === 0 &&
			(mode !== 'alveolus' || result.addedTriangles === 0)
		) {
			error(400, 'The tooth model does not intersect this scan');
		}

		const name = `${m.name} (tooth extraction)`;
		const rel = join(caseRel(m.case_id), `extract_${crypto.randomUUID().slice(0, 8)}.stl`);
		await Bun.write(resolveData(rel), meshToStlBinary(result.positions, name));
		const model = db
			.query(INSERT_MODEL)
			.get(
				m.case_id,
				name,
				'scan',
				rel,
				m.color,
				m.opacity,
				m.visible,
				m.transform,
				m.plan_id,
				JSON.stringify({
					extractedFrom: m.id,
					toothModelId: tooth.id,
					fdi: info.fdi,
					mode,
					holesFilled: result.holesFilled
				})
			) as Model;

		// optional planning copy of the extracted tooth — its own file, so the
		// DELETE handler (which unlinks the row's file) can remove either model
		// without breaking the other
		let toothModel: Model | undefined;
		if (body.addTooth) {
			const ext = tooth.file_path.split('.').pop()?.toLowerCase() || 'stl';
			const toothRel = join(caseRel(m.case_id), `tooth_${crypto.randomUUID().slice(0, 8)}.${ext}`);
			await copyFile(resolveData(tooth.file_path), resolveData(toothRel));
			toothModel = db
				.query(INSERT_MODEL)
				.get(
					m.case_id,
					`Extracted tooth ${info.fdi}`,
					'waxup',
					toothRel,
					tooth.color,
					tooth.opacity,
					1,
					tooth.transform,
					tooth.plan_id,
					JSON.stringify({ extractedTooth: true, fdi: info.fdi, source: tooth.id })
				) as Model;
		}

		logAudit(
			locals.user,
			'model.extractTooth',
			`model:${m.id}`,
			`tooth ${info.fdi} (${mode}) → model:${model.id}` +
				(toothModel ? ` + tooth model:${toothModel.id}` : '')
		);
		return json({
			model,
			...(toothModel ? { toothModel } : {}),
			removedTriangles: result.removedTriangles,
			addedTriangles: result.addedTriangles,
			holesFilled: result.holesFilled
		});
	}

	/* ---------------- legacy capsule contract (SPEC §5.6) ---------------- */
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

	const positions = await loadSoup(m);

	let result;
	try {
		result = extractToothFromSoup(positions, head, axis, diameter, mode);
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
