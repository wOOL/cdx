import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/** Compact case list for pickers: id + title + patient name. */
export const GET: RequestHandler = async () => {
	const cases = db
		.query(
			`SELECT c.id, c.title, TRIM(p.last_name || ', ' || p.first_name, ', ') AS patient
			 FROM cases c JOIN patients p ON p.id = c.patient_id
			 ORDER BY c.updated_at DESC`
		)
		.all() as { id: number; title: string; patient: string }[];
	return json({ cases });
};
