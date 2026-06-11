import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listOrders } from '$lib/server/orders';

/** Provider order list — incoming transfers that carry a service request. */
export const GET: RequestHandler = async () => {
	return json({ orders: listOrders() });
};
