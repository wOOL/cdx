/**
 * Production Management station test (IFU 5.1 "Send to production").
 *   bun run scripts/test-production.ts   (exit 0 = all pass)
 *
 * Runs migrations against the real data/codiagnostix.db (verifies migration 18
 * applies and user_version reaches 18), then on a scratch case + restoration
 * order:
 *   - advance routed → in-production → produced (asserts each persists)
 *   - subcontract to a lab contact (asserts status routed, subcontracted_to set,
 *     and an outgoing 'restoration:<order_number>' transfer is recorded)
 *   - asserts the production list reflects each change and supports ?status filter
 * Cleans up the scratch patient (cascade) + contact + transfer in `finally`.
 */
import { db } from '../src/lib/server/db';
import { createCase, createPatient, deletePatient } from '../src/lib/server/db/repo';
import { createContact, deleteContact, getTransfer } from '../src/lib/server/collab';
import { createOrder, getOrder } from '../src/lib/server/restorationOrders';
import {
	advanceStatus,
	listProductionOrders,
	subcontract
} from '../src/lib/server/production';
import { PRODUCTION_STATUSES, ORDER_STATUSES } from '../src/lib/restorationCatalog';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

// ---- migration sanity ----
const ver = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
check('PRAGMA user_version reached 18', ver >= 18, `got ${ver}`);
const cols = db.query(`PRAGMA table_info(restoration_orders)`).all() as { name: string }[];
check('restoration_orders has subcontracted_to column', cols.some((c) => c.name === 'subcontracted_to'));

// ---- catalog sanity ----
check(
	'ORDER_STATUSES includes production states',
	['routed', 'in-production', 'produced'].every((s) => (ORDER_STATUSES as readonly string[]).includes(s))
);
check(
	'PRODUCTION_STATUSES ordered routed→in-production→produced',
	JSON.stringify([...PRODUCTION_STATUSES]) === JSON.stringify(['routed', 'in-production', 'produced'])
);

let patientId = 0;
let contactId = 0;
let transferId = 0;
try {
	const patient = createPatient({ first_name: 'Scratch', last_name: 'Production' });
	patientId = patient.id;
	const kase = createCase(patient.id, 'production test');
	const lab = createContact({ name: 'Scratch Mill Lab', kind: 'lab' });
	contactId = lab.id;

	const order = createOrder(kase.id, {
		dentist: 'Dr. Prod',
		material: 'zirconia',
		shade: 'A2',
		units: [
			{ fdi: 14, role: 'abutment', subtype: 'Crown abutment' },
			{ fdi: 15, role: 'pontic', subtype: 'Full pontic' },
			{ fdi: 16, role: 'abutment', subtype: 'Crown abutment' }
		],
		bridges: [[14, 15, 16]]
	});
	check('order starts in draft', order.status === 'draft');
	check('order starts unsubcontracted', order.subcontracted_to === null);

	// ---- production list surfaces the order with case + patient ----
	const inList = () => listProductionOrders().find((o) => o.id === order.id);
	let row = inList();
	check('order appears in production list', !!row);
	check('list joins patient name', !!row && row.patient_name === 'Production, Scratch');
	check('list joins case title', !!row && row.case_title === 'production test');
	check('list summarizes units', !!row && row.units.length === 3);

	// ---- advance routed → in-production → produced ----
	const a1 = advanceStatus(order.id, 'routed');
	check('advance → routed persists', !!a1 && a1.status === 'routed' && getOrder(order.id)?.status === 'routed');
	const a2 = advanceStatus(order.id, 'in-production');
	check('advance → in-production persists', !!a2 && getOrder(order.id)?.status === 'in-production');
	const a3 = advanceStatus(order.id, 'produced');
	check('advance → produced persists', !!a3 && getOrder(order.id)?.status === 'produced');
	check('advanceStatus advances updated_at', !!a3 && a3.updated_at >= order.updated_at);
	check('advanceStatus on missing order → null', advanceStatus(999999999, 'routed') === null);

	// ---- ?status filter equivalent (repo filter) ----
	check(
		'listProductionOrders(status) filters',
		listProductionOrders({ status: 'produced' }).some((o) => o.id === order.id) &&
			!listProductionOrders({ status: 'routed' }).some((o) => o.id === order.id)
	);

	// ---- subcontract to the lab ----
	const sub = subcontract(order.id, contactId);
	check('subcontract returns result', !!sub);
	if (sub) {
		transferId = sub.transferId;
		check('subcontract sets status routed', sub.order.status === 'routed');
		check('subcontract records subcontracted_to', sub.order.subcontracted_to === contactId);
		check('subcontract persists in DB', getOrder(order.id)?.subcontracted_to === contactId);

		// transfer recorded in the collaboration history, tagged restoration:<order_number>
		const t = getTransfer(sub.transferId);
		check('subcontract created an outgoing transfer', !!t && t.direction === 'out');
		check(
			'transfer tagged restoration:<order_number>',
			!!t && t.service === `restoration:${order.order_number}`
		);
		check('transfer points at the lab contact', !!t && t.contact_id === contactId);
	}

	// list now reflects the subcontractor name
	row = inList();
	check('list surfaces subcontractor name', !!row && row.subcontractor === 'Scratch Mill Lab');
	check('list reflects routed status after subcontract', !!row && row.status === 'routed');

	check('subcontract on missing order → null', subcontract(999999999, contactId) === null);
	check('subcontract to missing contact → null', subcontract(order.id, 999999999) === null);
} catch (e) {
	check(`unexpected error: ${e}`, false);
} finally {
	if (transferId) {
		try {
			db.query('DELETE FROM transfers WHERE id = ?1').run(transferId);
		} catch {
			// best effort
		}
	}
	if (contactId) {
		try {
			deleteContact(contactId);
		} catch {
			// best effort
		}
	}
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
console.log('\nAll production checks passed');
