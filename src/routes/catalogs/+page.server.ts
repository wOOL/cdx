import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listCatalogs } from '$lib/server/catalogs';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { catalogs: listCatalogs() };
};
