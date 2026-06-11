import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getPlan, logAudit } from '$lib/server/db/repo';
import {
	buildPlanPayload,
	createTransfer,
	getContact,
	uniqueTransferDigits,
	writeTransferPayload
} from '$lib/server/collab';

/**
 * Body: { contactId, comment?, service? } — sends a plan to a contact.
 * Loopback model: creates the outgoing transfer AND a mirrored incoming one so
 * the inbox is fully exercisable within a single installation.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const plan = getPlan(Number(params.id));
	if (!plan) error(409, 'Plan missing');

	const body = await request.json().catch(() => ({}));
	const contact = getContact(Number(body.contactId));
	if (!contact) error(404, 'Contact not found');
	const comment = String(body.comment ?? '');
	const service = String(body.service ?? '');

	const payloadPath = writeTransferPayload(buildPlanPayload(plan));
	const digits = uniqueTransferDigits();

	const out = createTransfer({
		number: `T-${digits}`,
		plan_id: plan.id,
		contact_id: contact.id,
		direction: 'out',
		state: 'uploaded',
		service,
		comment,
		payload_path: payloadPath
	});
	const incoming = createTransfer({
		number: `R-${digits}`,
		plan_id: plan.id,
		contact_id: contact.id,
		direction: 'in',
		state: 'uploaded',
		service,
		comment,
		payload_path: payloadPath,
		unread: 1
	});

	// sent plans are write-protected
	db.query(
		`UPDATE plans SET sent = 1, locked = 1, updated_at = datetime('now') WHERE id = ?1`
	).run(plan.id);
	logAudit(locals.user, 'plan.send', `plan:${plan.id}`, contact.name);

	return json({ out, in: incoming });
};
