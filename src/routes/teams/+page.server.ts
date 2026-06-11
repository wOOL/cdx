import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { getAcl, getTeams } from '$lib/server/teams';

// auth: like /settings, the global hook in hooks.server.ts redirects
// unauthenticated visitors to /login before this loader runs.
export const load: PageServerLoad = async () => {
	const users = db.query('SELECT id, email, name FROM users ORDER BY id').all() as {
		id: number;
		email: string;
		name: string;
	}[];
	const patients = db
		.query(
			`SELECT id, TRIM(last_name || ', ' || first_name, ', ') AS name
			 FROM patients ORDER BY last_name, first_name`
		)
		.all() as { id: number; name: string }[];
	return { teams: getTeams(), acl: getAcl(), users, patients };
};
