import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDirectory } from '$lib/server/orders';

/** Lab directory: static demo providers plus the own lab once registered. */
export const GET: RequestHandler = async () => {
	return json({ labs: listDirectory() });
};
