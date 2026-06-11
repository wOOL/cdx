import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStudy, studyCsv } from '$lib/server/evaluation';

/** GET /api/evaluation/[id]/csv — deviation table as a CSV attachment. */
export const GET: RequestHandler = async ({ params }) => {
	const study = getStudy(params.id ?? '');
	if (!study) error(404, 'Study not found');
	if (!study.result) error(400, 'Run the study first — no results to export');

	const safeName = study.name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'study';
	return new Response(studyCsv(study), {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="evaluation-${safeName}.csv"`
		}
	});
};
