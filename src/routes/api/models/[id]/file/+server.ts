import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { getPlan, logAudit } from '$lib/server/db/repo';
import { spendCredit } from '$lib/server/auth';
import type { Model } from '$lib/types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	const file = Bun.file(resolveData(m.file_path));
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
			if (plan.guide_stale) {
				error(409, 'The plan changed after this guide was generated — regenerate the guide first');
			}
			// every production export burns one credit — spent atomically so parallel
			// downloads can never push the balance below zero.
			const remaining = locals.user ? spendCredit(locals.user.id) : null;
			if (remaining === null) {
				error(402, 'No export credits left — top up in your account console');
			}
			headers['X-Credits-Remaining'] = String(remaining);
			logAudit(locals.user, 'guide.export', `model:${m.id}`, `${m.name} — credits left: ${remaining}`);
		}
		const safe = m.name.replace(/[^\w\-. ]+/g, '_');
		headers['Content-Disposition'] = `attachment; filename="${safe}.${ext}"`;
	}
	return new Response(await file.arrayBuffer(), { headers });
};
