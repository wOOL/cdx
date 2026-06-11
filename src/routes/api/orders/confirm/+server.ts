import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/db/repo';
import { getProviderProfile, setProviderProfile } from '$lib/server/orders';

/**
 * Completes provider registration (simulates following the confirmation link
 * in the registration email): confirmationPending → registered.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const profile = getProviderProfile();
	if (!profile || !profile.confirmationPending) {
		error(409, 'No registration is awaiting confirmation');
	}
	const confirmed = { ...profile, registered: true, confirmationPending: false };
	setProviderProfile(confirmed);
	logAudit(locals.user, 'orders.confirm', 'provider_profile', confirmed.name);
	return json({ profile: confirmed });
};
