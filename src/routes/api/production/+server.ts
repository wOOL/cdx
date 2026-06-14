import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProductionOrders } from '$lib/server/production';
import { ORDER_STATUSES } from '$lib/restorationCatalog';

/**
 * GET /api/production[?status=<status>] — the production queue: every
 * restoration order across all cases (joined with case + patient), optionally
 * filtered to a single status.
 */
export const GET: RequestHandler = ({ url }) => {
	const status = url.searchParams.get('status') ?? undefined;
	const filter =
		status && (ORDER_STATUSES as readonly string[]).includes(status) ? { status } : {};
	return json({ orders: listProductionOrders(filter) });
};
