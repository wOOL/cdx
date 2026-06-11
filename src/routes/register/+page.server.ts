import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SESSION_COOKIE, createSession, createUser, userCount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { firstUser: userCount() === 0 };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		// open self-registration only for the very first account; afterwards an
		// existing user must create accounts (single-practice trust model)
		if (userCount() > 0) {
			return fail(403, {
				error: 'Registration is closed — ask an existing user to create your account from Settings',
				email: '',
				name: ''
			});
		}
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
			return fail(400, { error: 'Enter a valid email address', email, name });
		}
		if (password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters', email, name });
		}

		const user = await createUser(email, password, name);
		if (!user) return fail(400, { error: 'An account with this email already exists', email, name });

		const session = createSession(user.id);
		cookies.set(SESSION_COOKIE, session.token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			expires: session.expires
		});
		redirect(303, '/');
	}
};
