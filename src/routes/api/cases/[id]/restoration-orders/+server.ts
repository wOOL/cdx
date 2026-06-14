import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCase, logAudit } from '$lib/server/db/repo';
import { createOrder, listOrdersForCase } from '$lib/server/restorationOrders';
import { validateOrderFields } from '$lib/server/restorationOrderValidate';

export const GET: RequestHandler = ({ params }) => {
	const caseId = Number(params.id);
	if (!getCase(caseId)) error(404, 'Case not found');
	return json({ orders: listOrdersForCase(caseId) });
};

/** Create a restoration order on the case. Body: optional order fields. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const caseId = Number(params.id);
	if (!getCase(caseId)) error(404, 'Case not found');

	const body = await request.json().catch(() => ({}));
	const parsed = validateOrderFields(body, { partial: true });
	if ('error' in parsed) error(400, parsed.error);

	const order = createOrder(caseId, parsed.fields);
	logAudit(
		locals.user,
		'restoration-order.create',
		`restoration-order:${order.id}`,
		`${order.order_number} on case ${caseId} (${order.units.length} unit(s))`
	);
	return json({ order }, { status: 201 });
};
