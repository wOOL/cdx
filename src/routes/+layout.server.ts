import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals }) => {
	let inboxUnread = 0;
	if (locals.user) {
		const row = db
			.query(`SELECT COUNT(*) AS n FROM transfers WHERE direction = 'in' AND unread = 1`)
			.get() as { n: number };
		inboxUnread = row.n;
	}
	return { user: locals.user, inboxUnread };
};
