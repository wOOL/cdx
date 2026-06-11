import type { PageServerLoad } from './$types';
import {
	PROVIDER_SERVICES,
	getProviderProfile,
	listDirectory,
	listOrders
} from '$lib/server/orders';

// auth: like /settings, the global hook in hooks.server.ts redirects
// unauthenticated visitors to /login before this loader runs.
export const load: PageServerLoad = async () => {
	return {
		profile: getProviderProfile(),
		labs: listDirectory(),
		orders: listOrders(),
		services: PROVIDER_SERVICES.map((s) => ({ id: s.id, label: s.label }))
	};
};
