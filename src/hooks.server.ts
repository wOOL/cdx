import { error, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, getSessionUser } from '$lib/server/auth';

const PUBLIC_ROUTES = new Set(['/login', '/register']);

export const handle: Handle = async ({ event, resolve }) => {
	const user = getSessionUser(event.cookies.get(SESSION_COOKIE));
	event.locals.user = user;

	const path = event.url.pathname;
	const isPublic = PUBLIC_ROUTES.has(path) || path.startsWith('/favicon');

	if (!user && !isPublic) {
		if (path.startsWith('/api/')) {
			error(401, 'Not authenticated');
		}
		redirect(303, `/login?next=${encodeURIComponent(path)}`);
	}

	return resolve(event);
};
