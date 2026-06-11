import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { unlinkPayloadIfOrphan, type Transfer, type TransferState } from '$lib/server/collab';
import {
	ORDER_ACTIONS,
	ORDER_STATE_BY_TRANSFER,
	getOrderTransfer,
	type OrderAction
} from '$lib/server/orders';

function setState(id: number, state: TransferState): Transfer {
	return db
		.query(
			`UPDATE transfers SET state = ?2, unread = 0, updated_at = datetime('now')
			 WHERE id = ?1 RETURNING *`
		)
		.get(id, state) as Transfer;
}

/**
 * Body: { action: 'process'|'finish'|'reject'|'remove' } — provider-side order
 * actions on the underlying incoming transfer. Sequence-controlled:
 *   process: new → processing            (409 otherwise)
 *   finish:  processing → finished       (409 before process / when terminal)
 *   reject:  new|processing → rejected   (409 when terminal)
 *   remove:  finished|rejected → deleted (409 otherwise)
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const order = getOrderTransfer(Number(params.id));
	if (!order) error(404, 'Order not found');

	const body = await request.json().catch(() => ({}));
	const action = String(body.action ?? '') as OrderAction;
	if (!ORDER_ACTIONS.includes(action)) error(400, 'Unknown action');

	const state = ORDER_STATE_BY_TRANSFER[order.state];

	if (action === 'process') {
		if (state !== 'new') error(409, `Order is already ${state} — only new orders can be processed`);
		const t = setState(order.id, 'downloaded');
		logAudit(locals.user, 'order.process', `transfer:${order.id}`, order.service);
		return json({ order: { id: t.id, state: ORDER_STATE_BY_TRANSFER[t.state] } });
	}

	if (action === 'finish') {
		if (state === 'new') error(409, 'Cannot finish before processing — services are sequence-controlled');
		if (state !== 'processing') error(409, `Order is already ${state}`);
		const t = setState(order.id, 'finished');
		logAudit(locals.user, 'order.finish', `transfer:${order.id}`, order.service);
		return json({ order: { id: t.id, state: ORDER_STATE_BY_TRANSFER[t.state] } });
	}

	if (action === 'reject') {
		if (state === 'finished' || state === 'rejected') error(409, `Order is already ${state}`);
		const t = setState(order.id, 'rejected');
		logAudit(locals.user, 'order.reject', `transfer:${order.id}`, order.service);
		return json({ order: { id: t.id, state: ORDER_STATE_BY_TRANSFER[t.state] } });
	}

	// remove
	if (state !== 'finished' && state !== 'rejected') {
		error(409, 'Only finished or rejected orders can be removed');
	}
	db.query('DELETE FROM transfers WHERE id = ?1').run(order.id);
	unlinkPayloadIfOrphan(order.payload_path);
	logAudit(locals.user, 'order.remove', `transfer:${order.id}`, order.service);
	return json({ removed: true });
};
