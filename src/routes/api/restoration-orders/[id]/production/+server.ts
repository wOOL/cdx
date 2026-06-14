import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/db/repo';
import { getContact } from '$lib/server/collab';
import { getOrder } from '$lib/server/restorationOrders';
import { advanceStatus, isProductionStatus, subcontract } from '$lib/server/production';

/**
 * POST /api/restoration-orders/[id]/production
 *   { action: 'advance', status: 'routed'|'in-production'|'produced' }
 *   { action: 'subcontract', contactId: <lab contact id> }
 *
 * Explicit, audited production actions on a single restoration order.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const existing = getOrder(id);
	if (!existing) error(404, 'Restoration order not found');

	const body = (await request.json().catch(() => null)) as {
		action?: string;
		status?: string;
		contactId?: number;
	} | null;
	if (!body || typeof body.action !== 'string') error(400, 'Missing action');

	if (body.action === 'advance') {
		if (!isProductionStatus(body.status))
			error(400, 'status must be one of routed, in-production, produced');
		const order = advanceStatus(id, body.status);
		if (!order) error(404, 'Restoration order not found');
		logAudit(
			locals.user,
			'production.advance',
			`restoration-order:${id}`,
			`${order.order_number} → ${order.status}`
		);
		return json({ order });
	}

	if (body.action === 'subcontract') {
		const contactId = Number(body.contactId);
		if (!contactId) error(400, 'contactId required');
		if (!getContact(contactId)) error(404, 'Contact not found');
		const result = subcontract(id, contactId);
		if (!result) error(404, 'Restoration order or contact not found');
		logAudit(
			locals.user,
			'production.subcontract',
			`restoration-order:${id}`,
			`${result.order.order_number} → contact:${contactId} (transfer:${result.transferId})`
		);
		return json({ order: result.order, transferId: result.transferId });
	}

	error(400, `Unknown action: ${body.action}`);
};
