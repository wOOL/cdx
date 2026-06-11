import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listModels, logAudit } from '$lib/server/db/repo';
import { classifyAiModel } from '$lib/aiReviewMap';
import { planRenumber, renameToothModel } from '$lib/server/toothOps';
import type { Model } from '$lib/types';

/**
 * Change the FDI numbering of an AI-segmented tooth (the AI assistant's
 * "change tooth numbering" tool — see the tutorial video).
 *
 * POST body { newFdi: number }. [id] must be an AI tooth model (params.ai +
 * a resolvable FDI). Same-arch targets shift the contiguous run of existing
 * AI teeth extending from this tooth in the move direction by the same
 * position delta (renumbering 24→23 while 23..17 exist renumbers all of
 * them by −1); collisions with teeth outside the run, or shifts off the
 * arch, return 409. A target on the opposite arch relabels only this tooth.
 *
 * Every changed row gets params.fdi / params.class ('tooth_<fdi>') and the
 * vendor name pattern ("AI — Tooth <fdi>") updated so classifyAiModel keeps
 * resolving it. → { changes: [{ modelId, oldFdi, newFdi }] }
 */

function parseParams(raw: string | null | undefined): Record<string, unknown> {
	try {
		const p = raw ? JSON.parse(raw) : {};
		return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model | null;
	if (!m) error(404, 'Model not found');

	const mp = parseParams(m.params);
	if (!mp.ai) error(400, 'Not an AI-imported model');
	const info = classifyAiModel(m.name, mp as { class?: string; fdi?: number });
	if (info.kind !== 'tooth' || info.fdi == null) error(400, 'Model is not an AI tooth');

	const body = await request.json().catch(() => ({}));
	const newFdi = Number(body.newFdi);
	if (!Number.isInteger(newFdi)) error(400, 'newFdi must be an FDI tooth number (11–48)');

	// all AI tooth models of the case by current FDI (duplicate rows move together)
	const byFdi = new Map<number, { model: Model; params: Record<string, unknown> }[]>();
	for (const row of listModels(m.case_id)) {
		const rp = parseParams(row.params);
		if (!rp.ai) continue;
		const ri = classifyAiModel(row.name, rp as { class?: string; fdi?: number });
		if (ri.kind !== 'tooth' || ri.fdi == null) continue;
		const list = byFdi.get(ri.fdi);
		if (list) list.push({ model: row, params: rp });
		else byFdi.set(ri.fdi, [{ model: row, params: rp }]);
	}

	const plan = planRenumber(byFdi.keys(), info.fdi, newFdi);
	if (!plan.ok) error(plan.status, plan.error);

	const changes: { modelId: number; oldFdi: number; newFdi: number }[] = [];
	db.transaction(() => {
		for (const c of plan.changes) {
			for (const entry of byFdi.get(c.oldFdi) ?? []) {
				db.query('UPDATE models SET name = ?2, params = ?3 WHERE id = ?1').run(
					entry.model.id,
					renameToothModel(entry.model.name, c.newFdi),
					JSON.stringify({ ...entry.params, fdi: c.newFdi, class: `tooth_${c.newFdi}` })
				);
				changes.push({ modelId: entry.model.id, oldFdi: c.oldFdi, newFdi: c.newFdi });
			}
		}
	})();

	logAudit(
		locals.user,
		'model.renumber',
		`model:${id}`,
		`tooth ${info.fdi} → ${newFdi}: ${changes.map((c) => `${c.oldFdi}→${c.newFdi}`).join(' ')}`
	);
	return json({ changes });
};
