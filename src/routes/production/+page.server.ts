import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listProductionOrders } from '$lib/server/production';
import { listContacts } from '$lib/server/collab';
import { MATERIALS, ORDER_STATUSES } from '$lib/restorationCatalog';

// auth: the global hook in hooks.server.ts redirects unauthenticated visitors to
// /login before this loader runs; the explicit guard keeps the next= param.
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);

	return {
		orders: listProductionOrders(),
		// only lab contacts can be subcontracted to
		labs: listContacts().filter((c) => c.kind === 'lab'),
		materials: MATERIALS.map((m) => ({ id: m.id, label: m.label })),
		statuses: [...ORDER_STATUSES]
	};
};
