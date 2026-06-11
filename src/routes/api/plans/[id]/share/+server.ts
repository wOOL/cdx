import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan, logAudit } from '$lib/server/db/repo';

/** Create (or return the existing) read-only share link for a plan. */
export const POST: RequestHandler = async ({ params, url, locals }) => {
	const plan = getPlan(Number(params.id));
	if (!plan) error(404, 'Plan not found');

	let row = db
		.query('SELECT token FROM shares WHERE plan_id = ?1 AND revoked = 0')
		.get(plan.id) as { token: string } | null;
	if (!row) {
		const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
		db.query('INSERT INTO shares (token, plan_id) VALUES (?1, ?2)').run(token, plan.id);
		row = { token };
		logAudit(locals.user, 'plan.share', `plan:${plan.id}`, plan.name);
	}
	return json({ token: row.token, url: `${url.origin}/share/${row.token}` });
};

/** Revoke all share links for a plan. */
export const DELETE: RequestHandler = async ({ params }) => {
	db.query('UPDATE shares SET revoked = 1 WHERE plan_id = ?1').run(Number(params.id));
	return json({ ok: true });
};
