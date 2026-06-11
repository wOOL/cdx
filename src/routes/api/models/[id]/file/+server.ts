import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan, logAudit } from '$lib/server/db/repo';
import type { Model } from '$lib/types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	const file = Bun.file(m.file_path);
	if (!(await file.exists())) error(404, 'Model file missing');
	const ext = m.file_path.split('.').pop()?.toLowerCase() ?? 'stl';
	const headers: Record<string, string> = {
		'Content-Type': 'application/octet-stream',
		'X-Format': ext,
		'Cache-Control': 'private, max-age=60'
	};
	if (url.searchParams.has('download')) {
		// production export gate: a guide may only leave the system once its plan is approved.
		// Fail closed: a guide whose plan no longer resolves is never exportable.
		if (m.kind === 'guide') {
			const plan = m.plan_id ? getPlan(m.plan_id) : null;
			if (!plan || !plan.approved) {
				error(409, 'Approve the plan before exporting the guide for production');
			}
			logAudit(locals.user, 'guide.export', `model:${m.id}`, m.name);
		}
		const safe = m.name.replace(/[^\w\-. ]+/g, '_');
		headers['Content-Disposition'] = `attachment; filename="${safe}.${ext}"`;
	}
	return new Response(await file.arrayBuffer(), { headers });
};
