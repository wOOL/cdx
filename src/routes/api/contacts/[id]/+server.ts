import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteContact, getContact } from '$lib/server/collab';
import { logAudit } from '$lib/server/db/repo';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const contact = getContact(Number(params.id));
	if (!contact) error(404, 'Contact not found');
	deleteContact(contact.id);
	logAudit(locals.user, 'contact.delete', `contact:${contact.id}`, contact.name);
	return json({ ok: true });
};
