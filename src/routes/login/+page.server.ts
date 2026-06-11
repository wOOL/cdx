import { fail, redirect, type Cookies } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	SESSION_COOKIE,
	clearLoginFailures,
	consumeMfaPending,
	createMfaPending,
	createSession,
	getTotpSecret,
	loginBlocked,
	peekMfaPending,
	recordLoginFailure,
	recordMfaFailure,
	userCount,
	verifyUser
} from '$lib/server/auth';
import { verifyCode } from '$lib/server/totp';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { hasUsers: userCount() > 0 };
};

/** one shape for every action result — keeps ActionData a single, fully-optional type */
interface LoginForm {
	error?: string;
	email?: string;
	mfa?: boolean;
	pending?: string;
}

function finishLogin(userId: number, cookies: Cookies, url: URL): never {
	const session = createSession(userId);
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

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();

		// ---- step 2: a pending MFA login coming back with a TOTP code ----
		const pending = String(form.get('pending') ?? '');
		if (pending) {
			const userId = peekMfaPending(pending);
			if (!userId) {
				return fail<LoginForm>(400, { error: 'Sign-in expired — enter your password again' });
			}
			const code = String(form.get('code') ?? '');
			const secret = getTotpSecret(userId);
			if (!secret || !verifyCode(secret, code)) {
				recordMfaFailure(pending);
				return fail<LoginForm>(400, { mfa: true, pending, error: 'Invalid authenticator code' });
			}
			consumeMfaPending(pending);
			finishLogin(userId, cookies, url);
		}

		// ---- step 1: email + password ----
		const email = String(form.get('email') ?? '');
		const password = String(form.get('password') ?? '');

		const rateKey = `${getClientAddress()}|${email.trim().toLowerCase()}`;
		if (loginBlocked(rateKey)) {
			return fail<LoginForm>(429, { error: 'Too many attempts — try again in a few minutes', email });
		}

		const user = await verifyUser(email, password);
		if (!user) {
			recordLoginFailure(rateKey);
			return fail<LoginForm>(400, { error: 'Invalid email or password', email });
		}
		clearLoginFailures(rateKey);

		// MFA enabled: hold the session back until a valid TOTP code arrives
		if (getTotpSecret(user.id)) {
			const step: LoginForm = { mfa: true, pending: createMfaPending(user.id) };
			return step;
		}

		finishLogin(user.id, cookies, url);
	}
};
