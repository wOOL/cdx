/**
 * Order Management + Teams test suite.
 *   bun scripts/test-orders-teams.ts   (exit 0 = all pass)
 *
 * Part 1 (HTTP): provider register → confirm flow, lab directory, service-
 *   request transfer → order list, sequence-controlled PATCH actions.
 * Part 2 (HTTP): teams CRUD, last-owner guard, patient ACL round trip.
 * Part 3 (direct import): resolveAccess policy matrix.
 *
 * Touches the live dev DB; every settings key and scratch row is snapshotted
 * and restored/removed in `finally`.
 */
import { join } from 'node:path';

process.env.CDX_DATA_DIR ??= join(import.meta.dir, '..', 'data');
const { db } = await import('../src/lib/server/db');
const { resolveAccess, saveTeams, saveAcl } = await import('../src/lib/server/teams');

const BASE = process.env.CDX_BASE ?? 'http://localhost:5173';
const RUN = `ot${Date.now().toString(36)}`;

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

let cookie = '';
async function api(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		...init,
		redirect: 'manual',
		headers: { origin: BASE, cookie, ...(init.headers ?? {}) }
	});
}

const json = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

async function login(): Promise<boolean> {
	const r = await api('/login', {
		method: 'POST',
		headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ email: 'cdx@surrey.ac', password: 'devpassword1' }).toString()
	});
	const m = (r.headers.get('set-cookie') ?? '').match(/cdx_session=([^;]+)/);
	if (!m) return false;
	cookie = `cdx_session=${m[1]}`;
	return true;
}

// ---------- settings snapshot ----------

const SETTING_KEYS = ['provider_profile', 'teams', 'patient_acl'];
const prevSettings: Record<string, string | null> = {};
for (const key of SETTING_KEYS) {
	const row = db.query('SELECT value FROM settings WHERE key = ?1').get(key) as {
		value: string;
	} | null;
	prevSettings[key] = row?.value ?? null;
}

// ---------- scratch rows tracked for cleanup ----------

const scratchTransferIds: number[] = [];
const scratchUserIds: number[] = [];
let scratchContactId: number | null = null;
let scratchPatientId: number | null = null;

try {
	check('login as admin', await login());
	if (!cookie) throw new Error('no session — aborting');

	// =============== Part 1: Order Management ===============

	// deterministic start: no provider profile
	db.query('DELETE FROM settings WHERE key = ?1').run('provider_profile');

	const badReg = await api('/api/orders/register', json('POST', { name: '', services: [] }));
	check('register without name/services → 400', badReg.status === 400);

	const reg = await api(
		'/api/orders/register',
		json('POST', { name: `Bunside Guide Lab ${RUN}`, services: ['guide-design', 'bone-block'] })
	);
	const regBody = await reg.json();
	check(
		'register → confirmationPending profile',
		reg.ok &&
			regBody.profile?.confirmationPending === true &&
			regBody.profile?.registered === false &&
			regBody.profile?.services?.length === 2
	);

	const dir0 = await (await api('/api/orders/directory')).json();
	check(
		'directory before confirm: 3 demo labs, own lab absent',
		dir0.labs?.length === 3 && !dir0.labs.some((l: { self?: boolean }) => l.self)
	);

	const conf = await api('/api/orders/confirm', { method: 'POST' });
	const confBody = await conf.json();
	check(
		'confirm → registered profile',
		conf.ok && confBody.profile?.registered === true && confBody.profile?.confirmationPending === false
	);
	check('confirm twice → 409', (await api('/api/orders/confirm', { method: 'POST' })).status === 409);
	check(
		'register while registered → 409',
		(await api('/api/orders/register', json('POST', { name: 'X', services: ['custom'] }))).status === 409
	);

	const dir1 = await (await api('/api/orders/directory')).json();
	const own = dir1.labs?.find((l: { self?: boolean }) => l.self);
	check(
		'directory after confirm contains own lab',
		dir1.labs?.length === 4 && own?.name === `Bunside Guide Lab ${RUN}`,
		JSON.stringify(dir1.labs?.map((l: { name: string }) => l.name))
	);

	// ---- a service-request transfer becomes an order ----
	const contactRes = await api(
		'/api/contacts',
		json('POST', { name: `Order Test Clinic ${RUN}`, kind: 'clinician' })
	);
	const contact = (await contactRes.json()).contact;
	check('create scratch contact', contactRes.ok && contact?.id > 0);
	scratchContactId = contact.id;

	// same mechanism the inbox "New service request" uses (mirrored in/out pair)
	const sendRes = await api(
		'/api/transfers',
		json('POST', { contactId: contact.id, service: 'Bone block design', comment: `order ${RUN}` })
	);
	const pair = await sendRes.json();
	check('create service-request transfer pair', sendRes.ok && pair.in?.id > 0 && pair.out?.id > 0);
	scratchTransferIds.push(pair.in.id, pair.out.id);

	const orders0 = (await (await api('/api/orders')).json()).orders as {
		id: number;
		service: string;
		state: string;
		contact: string;
	}[];
	const order = orders0.find((o) => o.id === pair.in.id);
	check(
		'GET /api/orders lists the incoming request as a new order',
		!!order &&
			order.state === 'new' &&
			order.service === 'Bone block design' &&
			order.contact === `Order Test Clinic ${RUN}`,
		JSON.stringify(order)
	);
	check(
		'outgoing mirror is NOT an order (404)',
		(await api(`/api/orders/${pair.out.id}`, json('PATCH', { action: 'process' }))).status === 404
	);

	// ---- sequence control ----
	const act = (id: number, action: string) => api(`/api/orders/${id}`, json('PATCH', { action }));

	check('finish before process → 409', (await act(pair.in.id, 'finish')).status === 409);
	check('remove before finish → 409', (await act(pair.in.id, 'remove')).status === 409);

	const proc = await act(pair.in.id, 'process');
	check(
		'process → processing',
		proc.ok && (await proc.json()).order?.state === 'processing'
	);
	check('process twice → 409', (await act(pair.in.id, 'process')).status === 409);

	const fin = await act(pair.in.id, 'finish');
	check('finish after process → finished', fin.ok && (await fin.json()).order?.state === 'finished');
	check('reject after finish → 409', (await act(pair.in.id, 'reject')).status === 409);

	const rm = await act(pair.in.id, 'remove');
	check('remove finished order → ok', rm.ok && (await rm.json()).removed === true);
	const orders1 = (await (await api('/api/orders')).json()).orders as { id: number }[];
	check('removed order gone from list', !orders1.some((o) => o.id === pair.in.id));

	// ---- reject path on a second pair ----
	const send2 = await api(
		'/api/transfers',
		json('POST', { contactId: contact.id, service: 'Custom', comment: `order2 ${RUN}` })
	);
	const pair2 = await send2.json();
	scratchTransferIds.push(pair2.in.id, pair2.out.id);
	const rej = await act(pair2.in.id, 'reject');
	check('reject new order → rejected', rej.ok && (await rej.json()).order?.state === 'rejected');
	check('remove rejected order → ok', (await act(pair2.in.id, 'remove')).ok);

	// =============== Part 2: Teams ===============

	// deterministic start: no teams / acl
	db.query('DELETE FROM settings WHERE key = ?1').run('teams');
	db.query('DELETE FROM settings WHERE key = ?1').run('patient_acl');

	const adminId = (
		db.query('SELECT id FROM users WHERE email = ?1').get('cdx@surrey.ac') as { id: number }
	).id;
	const u2 = db
		.query(`INSERT INTO users (email, password_hash, name) VALUES (?1, 'x', 'Edda Editor') RETURNING id`)
		.get(`editor.${RUN}@example.com`) as { id: number };
	const u3 = db
		.query(`INSERT INTO users (email, password_hash, name) VALUES (?1, 'x', 'Otto Owner') RETURNING id`)
		.get(`owner.${RUN}@example.com`) as { id: number };
	scratchUserIds.push(u2.id, u3.id);

	check('create team without name → 400', (await api('/api/teams', json('POST', { name: ' ' }))).status === 400);

	const teamRes = await api('/api/teams', json('POST', { name: `QA Team ${RUN}` }));
	const team = (await teamRes.json()).team;
	check(
		'create team → caller is owner',
		teamRes.ok &&
			team?.id > 0 &&
			team.members?.length === 1 &&
			team.members[0].userId === adminId &&
			team.members[0].role === 'owner'
	);

	const list = await (await api('/api/teams')).json();
	check(
		'GET /api/teams lists team + compact users',
		list.teams?.some((t: { id: number }) => t.id === team.id) &&
			list.users?.some((u: { id: number }) => u.id === u2.id) &&
			Object.keys(list.users?.[0] ?? {}).sort().join(',') === 'email,id,name'
	);

	const tpatch = (body: unknown) => api(`/api/teams/${team.id}`, json('PATCH', body));

	const add1 = await tpatch({ addMember: { userId: u2.id, role: 'editor' } });
	check('addMember editor → ok', add1.ok && (await add1.json()).team.members.length === 2);
	check('addMember twice → 409', (await tpatch({ addMember: { userId: u2.id, role: 'reader' } })).status === 409);
	check('addMember unknown user → 404', (await tpatch({ addMember: { userId: 99999999, role: 'reader' } })).status === 404);
	check('addMember bad role → 400', (await tpatch({ addMember: { userId: u3.id, role: 'admin' } })).status === 400);

	const sr = await tpatch({ setRole: { userId: u2.id, role: 'reader' } });
	check(
		'setRole editor → reader',
		sr.ok &&
			(await sr.json()).team.members.find((m: { userId: number }) => m.userId === u2.id)?.role === 'reader'
	);

	check('remove last owner → 409', (await tpatch({ removeMember: adminId })).status === 409);
	check('demote last owner → 409', (await tpatch({ setRole: { userId: adminId, role: 'editor' } })).status === 409);

	const add2 = await tpatch({ addMember: { userId: u3.id, role: 'owner' } });
	check('second owner added', add2.ok);
	check('demote one of two owners → ok', (await tpatch({ setRole: { userId: adminId, role: 'editor' } })).ok);
	check('remove now-last owner → 409', (await tpatch({ removeMember: u3.id })).status === 409);
	check('re-promote admin → ok', (await tpatch({ setRole: { userId: adminId, role: 'owner' } })).ok);

	const ren = await tpatch({ name: `QA Team ${RUN} renamed` });
	check('rename team', ren.ok && (await ren.json()).team.name === `QA Team ${RUN} renamed`);

	// ---- patient ACL round trip ----
	const pat = db
		.query(`INSERT INTO patients (first_name, last_name) VALUES ('Acl', ?1) RETURNING id`)
		.get(`Tester ${RUN}`) as { id: number };
	scratchPatientId = pat.id;

	const plist = await (await api('/api/teams/patients')).json();
	check(
		'GET /api/teams/patients includes scratch patient (id+name)',
		plist.patients?.some((p: { id: number; name: string }) => p.id === pat.id && p.name.includes('Tester'))
	);

	check(
		'PUT acl unknown patient → 404',
		(await api('/api/teams/acl', json('PUT', { patientId: 99999999, teamId: team.id }))).status === 404
	);
	check(
		'PUT acl unknown team → 404',
		(await api('/api/teams/acl', json('PUT', { patientId: pat.id, teamId: 99999999 }))).status === 404
	);
	check(
		'PUT acl bad override level → 400',
		(
			await api(
				'/api/teams/acl',
				json('PUT', { patientId: pat.id, teamId: team.id, overrides: { [u2.id]: 'all' } })
			)
		).status === 400
	);

	const putAcl = await api(
		'/api/teams/acl',
		json('PUT', { patientId: pat.id, teamId: team.id, overrides: { [u2.id]: 'read' } })
	);
	const aclBody = await putAcl.json();
	check(
		'PUT acl stores entry with override',
		putAcl.ok &&
			aclBody.acl?.[String(pat.id)]?.teamId === team.id &&
			aclBody.acl?.[String(pat.id)]?.overrides?.[String(u2.id)] === 'read'
	);
	const aclGet = await (await api('/api/teams/acl')).json();
	check('GET acl round trip', aclGet.acl?.[String(pat.id)]?.teamId === team.id);

	const del = await api(`/api/teams/${team.id}`, { method: 'DELETE' });
	const delBody = await del.json();
	check('DELETE team clears its acl entries', del.ok && delBody.clearedAclEntries === 1);
	const aclAfter = await (await api('/api/teams/acl')).json();
	check('acl entry gone after team delete', !(String(pat.id) in (aclAfter.acl ?? {})));
	check('DELETE missing team → 404', (await api(`/api/teams/${team.id}`, { method: 'DELETE' })).status === 404);

	// =============== Part 3: resolveAccess matrix (direct import) ===============

	saveTeams([
		{
			id: 9001,
			name: 'Matrix',
			members: [
				{ userId: 11, role: 'owner' },
				{ userId: 12, role: 'editor' },
				{ userId: 13, role: 'reader' }
			]
		}
	]);
	saveAcl({
		'501': { teamId: 9001, overrides: { '12': 'read', '13': 'delete' } },
		'502': { teamId: 9001 }
	});

	check("no ACL entry → 'delete' (full default)", resolveAccess(11, 999) === 'delete');
	check("owner → 'delete'", resolveAccess(11, 501) === 'delete');
	check("editor with 'read' override → 'read'", resolveAccess(12, 501) === 'read');
	check(
		"reader with 'delete' override → 'read' (most restrictive wins)",
		resolveAccess(13, 501) === 'read'
	);
	check("non-member → 'read'", resolveAccess(99, 501) === 'read');
	check("editor without override → 'modify'", resolveAccess(12, 502) === 'modify');
	check("reader without override → 'read'", resolveAccess(13, 502) === 'read');
} finally {
	// restore settings keys exactly as found
	for (const key of SETTING_KEYS) {
		if (prevSettings[key] === null) {
			db.query('DELETE FROM settings WHERE key = ?1').run(key);
		} else {
			db.query(
				`INSERT INTO settings (key, value) VALUES (?1, ?2)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
			).run(key, prevSettings[key]);
		}
	}
	// scratch rows (transfers may already be gone via 'remove')
	for (const id of scratchTransferIds) db.query('DELETE FROM transfers WHERE id = ?1').run(id);
	if (scratchContactId) db.query('DELETE FROM contacts WHERE id = ?1').run(scratchContactId);
	if (scratchPatientId) db.query('DELETE FROM patients WHERE id = ?1').run(scratchPatientId);
	for (const id of scratchUserIds) db.query('DELETE FROM users WHERE id = ?1').run(id);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
