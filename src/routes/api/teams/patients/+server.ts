import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/** Lightweight patient list (id + display name) for the ACL patient picker. */
export const GET: RequestHandler = async () => {
	const patients = db
		.query(
			`SELECT id, TRIM(last_name || ', ' || first_name, ', ') AS name
			 FROM patients ORDER BY last_name, first_name`
		)
		.all() as { id: number; name: string }[];
	return json({ patients });
};
