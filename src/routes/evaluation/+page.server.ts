import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listStudiesJoined } from '$lib/server/evaluation';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { studies: listStudiesJoined() };
};
