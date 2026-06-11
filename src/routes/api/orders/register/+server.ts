import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/db/repo';
import {
	PROVIDER_SERVICE_IDS,
	getProviderProfile,
	setProviderProfile
} from '$lib/server/orders';

/**
 * Body: { name, services: string[] } — registers this installation as an
 * order-management provider. Registration is asynchronous: the profile is
 * stored with confirmationPending=true and only listed in the lab directory
 * after /api/orders/confirm (simulated email confirmation).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => ({}))) as { name?: unknown; services?: unknown };
	const name = String(body.name ?? '').trim();
	if (!name) error(400, 'Provider name is required');

	const services: string[] = Array.isArray(body.services)
		? body.services.map((s) => String(s))
		: [];
	if (!services.length) error(400, 'Select at least one offered service');
	for (const s of services) {
		if (!PROVIDER_SERVICE_IDS.includes(s)) error(400, `Unknown service: ${s}`);
	}

	if (getProviderProfile()?.registered) error(409, 'Provider is already registered');

	const profile = {
		registered: false,
		name,
		services: Array.from(new Set(services), (s) => String(s)),
		confirmationPending: true
	};
	setProviderProfile(profile);
	logAudit(locals.user, 'orders.register', 'provider_profile', name);
	return json({ profile });
};
