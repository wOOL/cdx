import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/** Unread-incoming counter for the inbox badge. */
export const GET: RequestHandler = async () => {
	const row = db
		.query(`SELECT COUNT(*) AS c FROM transfers WHERE direction = 'in' AND unread = 1`)
		.get() as { c: number };
	return json({ unread: row.c });
};
