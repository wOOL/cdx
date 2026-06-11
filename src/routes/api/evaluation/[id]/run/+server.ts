import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/db/repo';
import { getStudy, runStudy, setStudyResult } from '$lib/server/evaluation';

/**
 * POST /api/evaluation/[id]/run — register the study model against the case's
 * planning base scan and compute the per-implant deviation report.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const study = getStudy(params.id ?? '');
	if (!study) error(404, 'Study not found');

	let result;
	try {
		result = await runStudy(study);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Evaluation failed');
	}

	const updated = setStudyResult(study.id, result);
	if (!updated) error(404, 'Study not found');
	logAudit(
		locals.user,
		'evaluation.run',
		`study:${study.id}`,
		`rms ${result.rms} mm, icp ${result.alignedRmsICP} mm`
	);
	return json({ study: updated });
};
