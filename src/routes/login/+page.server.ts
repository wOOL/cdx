import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	SESSION_COOKIE,
	clearLoginFailures,
	createSession,
	loginBlocked,
	recordLoginFailure,
	userCount,
	verifyUser
} from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { hasUsers: userCount() > 0 };
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		const password = String(form.get('password') ?? '');

		const rateKey = `${getClientAddress()}|${email.trim().toLowerCase()}`;
		if (loginBlocked(rateKey)) {
			return fail(429, { error: 'Too many attempts — try again in a few minutes', email });
		}

		const user = await verifyUser(email, password);
		if (!user) {
			recordLoginFailure(rateKey);
			return fail(400, { error: 'Invalid email or password', email });
		}
		clearLoginFailures(rateKey);

		const session = createSession(user.id);
		cookies.set(SESSION_COOKIE, session.token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			expires: session.expires
		});
		// only same-origin paths — prevents open redirects via ?next=
		const next = url.searchParams.get('next') ?? '/';
		redirect(303, next.startsWith('/') && !next.startsWith('//') ? next : '/');
	}
};
