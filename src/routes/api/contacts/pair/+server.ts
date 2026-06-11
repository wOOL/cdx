import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createContact, getContactByCode } from '$lib/server/collab';
import { logAudit } from '$lib/server/db/repo';

/**
 * Body: { code, name? } — "pairs" with a remote practice by its pairing code.
 * Loopback simulation: simply registers a contact carrying that code.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const code = String(body.code ?? '').trim();
	if (!/^\d{7}$/.test(code)) error(400, 'Pairing code must be 7 digits');
	if (getContactByCode(code)) error(409, 'Already paired with this code');
	const name = String(body.name ?? '').trim() || `Practice ${code}`;
	const contact = createContact({ name, kind: 'clinician', code });
	logAudit(locals.user, 'contact.pair', `contact:${contact.id}`, `${name} (${code})`);
	return json({ contact });
};
