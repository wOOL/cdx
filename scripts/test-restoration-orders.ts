/**
 * Restoration-orders repo test (DWOS-style orders, migration 17).
 *   bun run scripts/test-restoration-orders.ts   (exit 0 = all pass)
 *
 * Runs migrations against the real data/codiagnostix.db (verifies migration 17
 * applies and user_version reaches 17), then exercises the repo on a scratch
 * case: create with units + a bridge, list, get, update status, delete; asserts
 * units/bridges round-trip as arrays and order_number is unique. Cleans up the
 * scratch patient (cascade) in `finally`.
 */
import { db } from '../src/lib/server/db';
import { createCase, createPatient, deletePatient } from '../src/lib/server/db/repo';
import {
	createOrder,
	deleteOrder,
	getOrder,
	listOrdersForCase,
	updateOrder
} from '../src/lib/server/restorationOrders';
import { nextOrderNumber } from '../src/lib/restorationCatalog';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

// ---- migration sanity ----
const ver = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
check('PRAGMA user_version reached 17', ver >= 17, `got ${ver}`);
const tbl = db
	.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='restoration_orders'`)
	.get();
check('restoration_orders table exists', !!tbl);

// ---- order-number helper ----
const onum = nextOrderNumber(0, new Date(Date.UTC(2026, 5, 14)));
check('nextOrderNumber shape COM-YYDDD-N', /^COM-\d{5}-\d+$/.test(onum), onum);
check('nextOrderNumber increments sequence', nextOrderNumber(4) !== nextOrderNumber(5));

let patientId = 0;
try {
	const patient = createPatient({ first_name: 'Scratch', last_name: 'RestOrders' });
	patientId = patient.id;
	const kase = createCase(patient.id, 'restoration-orders test');

	// ---- create with units + a bridge ----
	const order = createOrder(kase.id, {
		dentist: 'Dr. Test',
		material: 'zirconia',
		shade: 'A2',
		anatomy_family: 'natural',
		notes: 'three-unit bridge 14–16',
		units: [
			{ fdi: 14, role: 'abutment', subtype: 'Crown abutment' },
			{ fdi: 15, role: 'pontic', subtype: 'Full pontic' },
			{ fdi: 16, role: 'abutment', subtype: 'Crown abutment' }
		],
		bridges: [[14, 15, 16]]
	});
	check('createOrder returns an id', order.id > 0);
	check('order_number assigned', /^COM-/.test(order.order_number), order.order_number);
	check('units round-trip as array', Array.isArray(order.units) && order.units.length === 3);
	check('unit fields preserved', order.units[1].fdi === 15 && order.units[1].role === 'pontic');
	check('bridges round-trip as array', Array.isArray(order.bridges) && order.bridges.length === 1);
	check('bridge group preserved', JSON.stringify(order.bridges[0]) === JSON.stringify([14, 15, 16]));
	check('default status draft', order.status === 'draft');
	check('material/shade/anatomy preserved', order.material === 'zirconia' && order.shade === 'A2' && order.anatomy_family === 'natural');

	// ---- a second order: order_number must be unique ----
	const order2 = createOrder(kase.id, { units: [{ fdi: 21, role: 'crown', subtype: 'Full crown' }] });
	check('second order has a different order_number', order2.order_number !== order.order_number);

	// ---- list ----
	const list = listOrdersForCase(kase.id);
	check('listOrdersForCase returns both orders', list.length === 2);
	check('list entries expose parsed arrays', Array.isArray(list[0].units) && Array.isArray(list[0].bridges));

	// ---- get ----
	const got = getOrder(order.id);
	check('getOrder by id', !!got && got.id === order.id);
	check('getOrder units parsed', !!got && got.units.length === 3);

	// ---- update status + a field ----
	const upd = updateOrder(order.id, { status: 'routed', shade: 'A3' });
	check('updateOrder changes status', !!upd && upd.status === 'routed');
	check('updateOrder changes shade', !!upd && upd.shade === 'A3');
	check('updateOrder keeps units when omitted', !!upd && upd.units.length === 3);
	check('updated_at advanced', !!upd && upd.updated_at >= order.updated_at);

	// ---- update units + bridges ----
	const upd2 = updateOrder(order.id, {
		units: [{ fdi: 11, role: 'veneer', subtype: 'Veneer' }],
		bridges: []
	});
	check('updateOrder replaces units', !!upd2 && upd2.units.length === 1 && upd2.units[0].fdi === 11);
	check('updateOrder clears bridges', !!upd2 && upd2.bridges.length === 0);

	// ---- delete ----
	check('deleteOrder true', deleteOrder(order.id) === true);
	check('deleteOrder gone', getOrder(order.id) === null);
	check('deleteOrder again false', deleteOrder(order.id) === false);
	check('list reflects deletion', listOrdersForCase(kase.id).length === 1);

	// ---- cascade: deleting the patient (→ case) removes remaining orders ----
	deletePatient(patientId);
	patientId = 0;
	check('orders cascade-deleted with case', listOrdersForCase(kase.id).length === 0);
} catch (e) {
	check(`unexpected error: ${e}`, false);
} finally {
	if (patientId) {
		try {
			deletePatient(patientId);
		} catch {
			// best effort
		}
	}
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll restoration-order checks passed');
