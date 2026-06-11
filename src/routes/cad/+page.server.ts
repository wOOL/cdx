import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);

	const cases = db
		.query(
			`SELECT c.id, c.title, TRIM(p.last_name || ', ' || p.first_name, ', ') AS patient
			 FROM cases c JOIN patients p ON p.id = c.patient_id
			 ORDER BY c.updated_at DESC`
		)
		.all() as { id: number; title: string; patient: string }[];

	const caseId = Number(url.searchParams.get('case') ?? cases[0]?.id ?? 0);
	const models = caseId
		? (db
				.query(
					`SELECT id, name, kind FROM models
					 WHERE case_id = ?1 AND file_path != ''
					 ORDER BY id DESC`
				)
				.all(caseId) as { id: number; name: string; kind: string }[])
		: [];

	return { cases, caseId, models };
};
