import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listContacts, listTransfers } from '$lib/server/collab';

export const load: PageServerLoad = async () => {
	const stale = db
		.query(`SELECT COUNT(*) AS c FROM cases WHERE updated_at < datetime('now', '-30 days')`)
		.get() as { c: number };
	return {
		transfers: listTransfers(),
		contacts: listContacts(),
		staleCases: stale.c
	};
};
