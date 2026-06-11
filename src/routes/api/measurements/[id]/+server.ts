import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

export const DELETE: RequestHandler = async ({ params }) => {
	db.query('DELETE FROM measurements WHERE id = ?1').run(Number(params.id));
	return json({ ok: true });
};
