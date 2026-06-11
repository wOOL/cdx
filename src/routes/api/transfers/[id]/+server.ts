import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import {
	TRANSFER_STATES,
	getTransfer,
	unlinkPayloadIfOrphan,
	type Transfer,
	type TransferState
} from '$lib/server/collab';

// loose forward-only ordering; 'rejected' is reachable from any non-terminal state
const RANK: Record<TransferState, number> = {
	uploaded: 0,
	downloaded: 1,
	imported: 2,
	finished: 3,
	rejected: 3
};

/** Body: { state } — advance a transfer's state. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const transfer = getTransfer(Number(params.id));
	if (!transfer) error(404, 'Transfer not found');

	const body = await request.json().catch(() => ({}));
	const state = String(body.state ?? '') as TransferState;
	if (!TRANSFER_STATES.includes(state)) error(400, 'Unknown state');
	if (state !== transfer.state) {
		if (transfer.state === 'finished' || transfer.state === 'rejected') {
			error(409, `Transfer is already ${transfer.state}`);
		}
		if (RANK[state] < RANK[transfer.state]) {
			error(409, `Cannot move a ${transfer.state} transfer back to ${state}`);
		}
	}

	const updated = db
		.query(
			`UPDATE transfers SET state = ?2,
				unread = CASE WHEN ?2 = 'downloaded' THEN 0 ELSE unread END,
				updated_at = datetime('now')
			 WHERE id = ?1 RETURNING *`
		)
		.get(transfer.id, state) as Transfer;
	return json({ transfer: updated });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const transfer = getTransfer(Number(params.id));
	if (!transfer) error(404, 'Transfer not found');
	db.query('DELETE FROM transfers WHERE id = ?1').run(transfer.id);
	unlinkPayloadIfOrphan(transfer.payload_path);
	return json({ ok: true });
};
