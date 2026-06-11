import { error, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, getSessionUser } from '$lib/server/auth';

const PUBLIC_ROUTES = new Set(['/login', '/register']);

export const handle: Handle = async ({ event, resolve }) => {
	const user = getSessionUser(event.cookies.get(SESSION_COOKIE));
	event.locals.user = user;

	const path = event.url.pathname;
	const isPublic =
		PUBLIC_ROUTES.has(path) || path.startsWith('/favicon') || path.startsWith('/share/');

	if (!user && !isPublic) {
		if (path.startsWith('/api/')) {
			error(401, 'Not authenticated');
		}
		redirect(303, `/login?next=${encodeURIComponent(path)}`);
	}

	// viewer accounts are read-only: every mutating API call is rejected server-side.
	// (/logout is a POST but lives outside /api/, so signing out keeps working.)
	if (user?.tier === 'viewer') {
		const method = event.request.method;
		if (method !== 'GET' && method !== 'HEAD' && path.startsWith('/api/')) {
			error(403, 'Viewer accounts are read-only');
		}
	}

	return resolve(event);
};
