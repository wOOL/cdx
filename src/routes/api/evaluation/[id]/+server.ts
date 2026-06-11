import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/db/repo';
import { deleteStudy, getStudy } from '$lib/server/evaluation';

/** DELETE /api/evaluation/[id] — remove a study. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const study = getStudy(params.id ?? '');
	if (!study) error(404, 'Study not found');
	deleteStudy(study.id);
	logAudit(locals.user, 'evaluation.delete', `study:${study.id}`, study.name);
	return json({ ok: true });
};
