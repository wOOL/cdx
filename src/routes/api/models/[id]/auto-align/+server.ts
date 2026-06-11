import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getDataset, listDatasets, listModels, logAudit } from '$lib/server/db/repo';
import { autoAlignModelToDataset, type AutoAlignResult } from '$lib/server/autoAlign';
import type { Dataset, Model } from '$lib/types';

function getModel(id: number): Model | null {
	return (db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model) ?? null;
}

/**
 * "Align using AI assistant" — automatic intraoral/model-scan → CBCT
 * registration (see $lib/server/autoAlign.ts for the coarse-to-fine
 * algorithm and its runtime bound; the call is synchronous and finishes in
 * ~1–2 s on a 256³ volume, hard-capped by the coarse-sweep budget).
 *
 * Body: { datasetId?: number } — defaults to the case's primary dataset
 * (newest, i.e. listDatasets()[0], same as the planner page).
 *
 * On success persists the recovered transform exactly like the manual
 * point-pair / Refine-fit flow (models.transform, column-major 4×4 JSON) and
 * returns { model, transform, rms, inliers, inlierFraction, quality,
 * targetSource, runtimeMs } where quality is 'good' | 'check' ('check' →
 * the UI should ask the user to verify the alignment).
 *
 * 422 when the registration does not converge confidently (high RMS / low
 * inlier fraction) — nothing is written in that case.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const m = getModel(Number(params.id));
	if (!m || !m.file_path) error(404, 'Model not found');
	if (m.kind !== 'scan') error(400, 'Automatic alignment works on imported scan models');

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	let ds: Dataset | null;
	if (body.datasetId !== undefined) {
		const id = Number(body.datasetId);
		if (!Number.isInteger(id)) error(400, 'datasetId must be an integer');
		ds = getDataset(id);
		if (!ds || ds.case_id !== m.case_id) error(404, 'Dataset not found in this case');
	} else {
		ds = listDatasets(m.case_id)[0] ?? null;
		if (!ds) error(400, 'Case has no DICOM dataset to align to');
	}

	let result: AutoAlignResult & { targetSource: 'ai-teeth' | 'iso-surface' };
	try {
		result = await autoAlignModelToDataset(m, ds, listModels(m.case_id));
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Automatic alignment failed');
	}

	if (result.quality === 'failed') {
		const rmsTxt = Number.isFinite(result.rms) ? `RMS ${result.rms.toFixed(2)} mm, ` : '';
		error(
			422,
			`Automatic alignment did not converge (${rmsTxt}${Math.round(result.inlierFraction * 100)}% surface match). ` +
				'Align manually with ≥3 point pairs, then Refine fit (ICP).'
		);
	}

	db.query('UPDATE models SET transform = ?2 WHERE id = ?1').run(
		m.id,
		JSON.stringify(result.transform)
	);

	logAudit(
		locals.user,
		'model.autoalign',
		`model:${m.id}`,
		`auto-align "${m.name}" → dataset:${ds.id} (${result.targetSource}) — ` +
			`rms ${result.rms.toFixed(3)} mm, ${Math.round(result.inlierFraction * 100)}% inliers, ${result.quality}`
	);

	return json({
		model: getModel(m.id),
		transform: result.transform,
		rms: result.rms,
		inliers: result.inliers,
		inlierFraction: result.inlierFraction,
		quality: result.quality,
		targetSource: result.targetSource,
		runtimeMs: result.runtimeMs
	});
};
