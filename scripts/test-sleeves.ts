/**
 * Custom sleeve systems API smoke test (runs against the dev server):
 *   - CRUD roundtrip incl. validation failures (segment count, dim range, height sum)
 *   - in-use guard (scratch patient/case/plan/implant referencing the system -> 409)
 *   - import/export roundtrip with name dedupe
 *   - calibration STL: parses, bbox ~ 60x40x3 mm, printer-scale variant differs
 *
 *   bun run scripts/test-sleeves.ts
 *
 * Requires the dev server at http://localhost:5173 and the dev admin account.
 * Scratch DB rows are created directly (same sqlite file, WAL) and removed in
 * a finally block — DB is left as found.
 */
import { db } from '../src/lib/server/db';
import { parseStl } from '../src/lib/server/stl';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const EMAIL = 'cdx@surrey.ac';
const PASSWORD = 'devpassword1';

db.exec('PRAGMA busy_timeout = 3000');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

let cookie = '';

async function login(): Promise<boolean> {
	const form = new FormData();
	form.set('email', EMAIL);
	form.set('password', PASSWORD);
	const res = await fetch(`${BASE}/login`, { method: 'POST', body: form, redirect: 'manual' });
	for (const c of res.headers.getSetCookie()) {
		const m = c.match(/cdx_session=([^;]+)/);
		if (m) cookie = `cdx_session=${m[1]}`;
	}
	// Bun may transparently follow the 303 even with redirect: 'manual', so the
	// observed status can be 303 (manual honored) or 200 (followed to '/').
	return (res.status === 303 || res.ok) && cookie !== '';
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		...init,
		headers: { cookie, ...(init.headers ?? {}) },
		redirect: 'manual'
	});
}

function jsonApi(path: string, method: string, body: unknown): Promise<Response> {
	return api(path, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function bbox(positions: Float32Array): { ext: [number, number, number] } {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i + 2 < positions.length; i += 3) {
		for (let a = 0; a < 3; a++) {
			const v = positions[i + a];
			if (v < min[a]) min[a] = v;
			if (v > max[a]) max[a] = v;
		}
	}
	return { ext: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function bytesDiffer(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return true;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
	return false;
}

const STAMP = Date.now();
const SYS_NAME = `Test Sleeve ${STAMP}`;
const validSystem = {
	name: SYS_NAME,
	manufacturer: 'TestCo',
	notes: 'created by scripts/test-sleeves.ts',
	segments: [
		{ height: 5, upperDiameter: 5, lowerDiameter: 5, distanceToZeroLevel: 0 },
		{ height: 3, upperDiameter: 7, lowerDiameter: 5, distanceToZeroLevel: 5 },
		{ height: 1, upperDiameter: 8, lowerDiameter: 8, distanceToZeroLevel: 8 }
	],
	drillOffset: 9
};

// cleanup bookkeeping
const sleeveIds: number[] = [];
let scratchPatientId: number | null = null;
// undefined = untouched, null = key was absent, string = previous value
let printersBackup: string | null | undefined;

try {
	/* ---- login ---- */
	check('login (cookie jar)', await login());

	/* ---- create ---- */
	let res = await jsonApi('/api/sleeves', 'POST', validSystem);
	const created = res.ok ? ((await res.json()) as { system: { id: number; name: string } }).system : null;
	if (created) sleeveIds.push(created.id);
	check('POST create -> 201 with id', res.status === 201 && !!created?.id, `status ${res.status}`);
	check('create echoes name', created?.name === SYS_NAME);
	const sysId = created?.id ?? -1;

	/* ---- list ---- */
	res = await api('/api/sleeves');
	const list = (await res.json()) as { systems: { id: number; used: boolean; drillOffset: number }[] };
	const mine = list.systems.find((s) => s.id === sysId);
	check('GET list contains system, used=false', res.ok && !!mine && mine.used === false);

	/* ---- patch ---- */
	res = await jsonApi(`/api/sleeves/${sysId}`, 'PATCH', { name: `${SYS_NAME} renamed`, drillOffset: 10 });
	const patched = res.ok
		? ((await res.json()) as { system: { name: string; drillOffset: number } }).system
		: null;
	check(
		'PATCH updates name + drillOffset',
		res.ok && patched?.name === `${SYS_NAME} renamed` && patched?.drillOffset === 10,
		`status ${res.status}`
	);

	/* ---- validation failures ---- */
	res = await jsonApi('/api/sleeves', 'POST', {
		...validSystem,
		name: `bad-4seg-${STAMP}`,
		segments: [
			...validSystem.segments,
			{ height: 1, upperDiameter: 5, lowerDiameter: 5, distanceToZeroLevel: 9 }
		]
	});
	check('POST 4 segments -> 400', res.status === 400, `status ${res.status}`);

	res = await jsonApi('/api/sleeves', 'POST', {
		...validSystem,
		name: `bad-dim-${STAMP}`,
		segments: [{ height: 5, upperDiameter: 25, lowerDiameter: 5, distanceToZeroLevel: 0 }]
	});
	check('POST dim out of range (upper 25mm) -> 400', res.status === 400, `status ${res.status}`);

	res = await jsonApi('/api/sleeves', 'POST', {
		...validSystem,
		name: `bad-sum-${STAMP}`,
		segments: [{ height: 1, upperDiameter: 5, lowerDiameter: 5, distanceToZeroLevel: 0 }]
	});
	check('POST heights sum 1mm -> 400', res.status === 400, `status ${res.status}`);

	res = await jsonApi('/api/sleeves', 'POST', { ...validSystem, name: '' });
	check('POST empty name -> 400', res.status === 400, `status ${res.status}`);

	/* ---- in-use guard via scratch plan rows (direct DB, cleaned in finally) ---- */
	const patient = db
		.query(
			`INSERT INTO patients (external_id, first_name, last_name) VALUES (?1, 'Scratch', 'SleeveTest') RETURNING id`
		)
		.get(`scratch-sleeves-${STAMP}`) as { id: number };
	scratchPatientId = patient.id;
	const scase = db
		.query(`INSERT INTO cases (patient_id, title) VALUES (?1, 'scratch sleeve test') RETURNING id`)
		.get(patient.id) as { id: number };
	const plan = db
		.query(`INSERT INTO plans (case_id, name) VALUES (?1, 'scratch') RETURNING id`)
		.get(scase.id) as { id: number };
	db.query(`INSERT INTO implants (plan_id, sleeve) VALUES (?1, ?2)`).run(
		plan.id,
		JSON.stringify({ diameter: 5, height: 5, offset: 2, systemId: sysId })
	);

	res = await jsonApi(`/api/sleeves/${sysId}`, 'PATCH', { name: 'should be refused' });
	check('PATCH while in use -> 409', res.status === 409, `status ${res.status}`);
	res = await api(`/api/sleeves/${sysId}`, { method: 'DELETE' });
	check('DELETE while in use -> 409', res.status === 409, `status ${res.status}`);
	res = await api('/api/sleeves');
	const list2 = (await res.json()) as { systems: { id: number; used: boolean }[] };
	check('GET list shows used=true', list2.systems.find((s) => s.id === sysId)?.used === true);

	/* ---- export ---- */
	res = await api('/api/sleeves?export=1');
	const dispo = res.headers.get('content-disposition') ?? '';
	const exported = (await res.json()) as { systems: { name: string }[] };
	check(
		'export: attachment download with systems',
		res.ok && dispo.includes('attachment') && Array.isArray(exported.systems),
		dispo
	);
	check(
		'export contains the test system',
		exported.systems.some((s) => s.name === `${SYS_NAME} renamed`)
	);

	/* ---- import with name dedupe ---- */
	const reimport = exported.systems.find((s) => s.name === `${SYS_NAME} renamed`);
	res = await jsonApi('/api/sleeves', 'POST', { import: [reimport] });
	const imported = res.ok ? ((await res.json()) as { systems: { id: number; name: string }[] }).systems : [];
	for (const s of imported) sleeveIds.push(s.id);
	check(
		`import dedupes name with ' (2)'`,
		res.status === 201 && imported.length === 1 && imported[0].name === `${SYS_NAME} renamed (2)`,
		imported[0]?.name ?? `status ${res.status}`
	);
	check('import assigned a new id', imported.length === 1 && imported[0].id !== sysId);

	/* ---- calibration STL ---- */
	res = await api(`/api/sleeves/${sysId}/calibration?scale=100`);
	const stlDefault = new Uint8Array(await res.arrayBuffer());
	check(
		'calibration: 200 + attachment STL',
		res.ok && (res.headers.get('content-disposition') ?? '').includes('attachment'),
		`status ${res.status}, ${stlDefault.length} bytes`
	);
	const mesh = parseStl(stlDefault);
	check('calibration STL parses, triangles > 0', !!mesh && mesh.positions.length / 9 > 0,
		mesh ? `${mesh.positions.length / 9} triangles` : 'parse failed');
	if (mesh) {
		const { ext } = bbox(mesh.positions);
		const near = (v: number, t: number) => Math.abs(v - t) < 0.3;
		check(
			'calibration bbox ~ 60x40x3 mm',
			near(ext[0], 60) && near(ext[1], 40) && near(ext[2], 3),
			`${ext[0].toFixed(2)} x ${ext[1].toFixed(2)} x ${ext[2].toFixed(2)}`
		);
	}

	/* ---- printer-scale variants ---- */
	const prev = db
		.query('SELECT value FROM settings WHERE key = ?1')
		.get('sleeve_printer_scales') as { value: string } | null;
	printersBackup = prev ? prev.value : null;

	res = await jsonApi('/api/sleeves?printers=1', 'PUT', { printers: { caltest: 1.04 } });
	check('PUT printers -> 200', res.ok, `status ${res.status}`);
	res = await api('/api/sleeves?printers=1');
	const printers = (await res.json()) as { printers: Record<string, number> };
	check('GET printers returns saved scale', res.ok && printers.printers.caltest === 1.04);

	res = await api(`/api/sleeves/${sysId}/calibration?scale=100&printer=caltest`);
	const stlPrinter = new Uint8Array(await res.arrayBuffer());
	check('calibration with printer variant -> 200', res.ok, `status ${res.status}`);
	const meshPrinter = parseStl(stlPrinter);
	check(
		'printer variant changes bore sizes (vertex sets differ)',
		!!meshPrinter && bytesDiffer(stlDefault, stlPrinter),
		`${stlDefault.length} vs ${stlPrinter.length} bytes`
	);
	if (meshPrinter) {
		const { ext } = bbox(meshPrinter.positions);
		check(
			'printer variant keeps plate size',
			Math.abs(ext[0] - 60) < 0.3 && Math.abs(ext[1] - 40) < 0.3 && Math.abs(ext[2] - 3) < 0.3,
			`${ext[0].toFixed(2)} x ${ext[1].toFixed(2)} x ${ext[2].toFixed(2)}`
		);
	}

	res = await api(`/api/sleeves/${sysId}/calibration?printer=nope-${STAMP}`);
	check('unknown printer -> 404', res.status === 404, `status ${res.status}`);

	/* ---- delete works once the scratch implant is gone ---- */
	db.query('DELETE FROM patients WHERE id = ?1').run(scratchPatientId);
	scratchPatientId = null;
	res = await api(`/api/sleeves/${sysId}`, { method: 'DELETE' });
	check('DELETE after use removed -> 200', res.ok, `status ${res.status}`);
	res = await api(`/api/sleeves/${sysId}`);
	check('GET deleted system -> 404', res.status === 404, `status ${res.status}`);
} finally {
	/* ---- leave DB as found ---- */
	try {
		if (scratchPatientId != null) {
			db.query('DELETE FROM patients WHERE id = ?1').run(scratchPatientId);
		}
		for (const id of sleeveIds) {
			db.query('DELETE FROM custom_sleeves WHERE id = ?1').run(id);
		}
		if (printersBackup !== undefined) {
			if (printersBackup === null) {
				db.query('DELETE FROM settings WHERE key = ?1').run('sleeve_printer_scales');
			} else {
				db.query(
					`INSERT INTO settings (key, value) VALUES ('sleeve_printer_scales', ?1)
					 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
				).run(printersBackup);
			}
		}
	} catch (e) {
		console.error('cleanup failed:', e);
		failures++;
	}
}

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks passed');
