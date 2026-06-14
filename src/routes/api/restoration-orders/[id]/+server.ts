import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logAudit } from '$lib/server/db/repo';
import { deleteOrder, getOrder, updateOrder } from '$lib/server/restorationOrders';
import { validateOrderFields } from '$lib/server/restorationOrderValidate';

export const GET: RequestHandler = ({ params }) => {
	const order = getOrder(Number(params.id));
	if (!order) error(404, 'Restoration order not found');
	return json({ order });
};

/** PATCH any subset of status/dentist/material/shade/anatomy_family/units/bridges/notes. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	if (!getOrder(id)) error(404, 'Restoration order not found');

	const body = await request.json().catch(() => null);
	const parsed = validateOrderFields(body, { partial: false });
	if ('error' in parsed) error(400, parsed.error);

	const order = updateOrder(id, parsed.fields);
	if (!order) error(404, 'Restoration order not found');
	logAudit(
		locals.user,
		'restoration-order.update',
		`restoration-order:${id}`,
		`${order.order_number} → ${Object.keys(parsed.fields).join(', ')}`
	);
	return json({ order });
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	const id = Number(params.id);
	const order = getOrder(id);
	if (!order || !deleteOrder(id)) error(404, 'Restoration order not found');
	logAudit(locals.user, 'restoration-order.delete', `restoration-order:${id}`, order.order_number);
	return json({ ok: true });
};
