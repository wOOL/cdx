import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setWorkMode } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'Not authenticated');
	const body = await request.json().catch(() => ({}));
	if ('work_mode' in body) {
		setWorkMode(locals.user.id, body.work_mode === 'easy' ? 'easy' : 'expert');
	}
	return json({ ok: true });
};
