import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

/** Compact plan list for pickers: id + name + case title. */
export const GET: RequestHandler = async () => {
	const plans = db
		.query(
			`SELECT pl.id, pl.name, c.title AS case_title
			 FROM plans pl JOIN cases c ON c.id = pl.case_id
			 ORDER BY c.updated_at DESC, pl.is_master DESC, pl.created_at`
		)
		.all() as { id: number; name: string; case_title: string }[];
	return json({ plans });
};
