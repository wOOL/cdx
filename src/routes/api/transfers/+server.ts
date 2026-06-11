import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import {
	createTransfer,
	getContact,
	listTransfers,
	uniqueTransferDigits,
	unlinkPayloadIfOrphan
} from '$lib/server/collab';

/** List transfers (?direction=&state=&q=) with contact name joined. */
export const GET: RequestHandler = async ({ url }) => {
	return json({
		transfers: listTransfers({
			direction: url.searchParams.get('direction') ?? undefined,
			state: url.searchParams.get('state') ?? undefined,
			q: url.searchParams.get('q') ?? undefined
		})
	});
};

/**
 * Body: { contactId, service, comment } — plan-less service request
 * (transfers row with plan_id NULL; mirrored in/out pair like a plan send).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => ({}));
	const contact = getContact(Number(body.contactId));
	if (!contact) error(404, 'Contact not found');
	const service = String(body.service ?? '').trim();
	if (!service) error(400, 'Service type is required');
	const comment = String(body.comment ?? '');

	const digits = uniqueTransferDigits();
	const out = createTransfer({
		number: `T-${digits}`,
		plan_id: null,
		contact_id: contact.id,
		direction: 'out',
		service,
		comment
	});
	const incoming = createTransfer({
		number: `R-${digits}`,
		plan_id: null,
		contact_id: contact.id,
		direction: 'in',
		service,
		comment,
		unread: 1
	});
	logAudit(locals.user, 'service.request', `transfer:${out.id}`, `${service} → ${contact.name}`);
	return json({ out, in: incoming });
};

/** Bulk: mark all unread incoming transfers as read (inbox open). */
export const PATCH: RequestHandler = async () => {
	const res = db
		.query(`UPDATE transfers SET unread = 0 WHERE direction = 'in' AND unread = 1`)
		.run();
	return json({ updated: res.changes });
};

/** Tidy up: remove finished/rejected transfers older than 30 days. */
export const DELETE: RequestHandler = async ({ locals }) => {
	const old = db
		.query(
			`SELECT id, payload_path FROM transfers
			 WHERE state IN ('finished', 'rejected') AND updated_at < datetime('now', '-30 days')`
		)
		.all() as { id: number; payload_path: string }[];
	for (const t of old) {
		db.query('DELETE FROM transfers WHERE id = ?1').run(t.id);
		unlinkPayloadIfOrphan(t.payload_path);
	}
	if (old.length) logAudit(locals.user, 'transfer.tidy', 'transfers', `${old.length} removed`);
	return json({ removed: old.length });
};
