import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createContact, listContacts } from '$lib/server/collab';
import { logAudit } from '$lib/server/db/repo';

export const GET: RequestHandler = async () => {
	return json({ contacts: listContacts() });
};

/** Body: { name, email?, kind? 'clinician'|'lab' } — generates a unique 7-digit pairing code. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const name = String(body.name ?? '').trim();
	if (!name) error(400, 'Contact name is required');
	const kind = body.kind === 'lab' ? 'lab' : 'clinician';
	const contact = createContact({ name, email: String(body.email ?? '').trim(), kind });
	logAudit(locals.user, 'contact.create', `contact:${contact.id}`, name);
	return json({ contact });
};
