/**
 * Catalog/favorites test suite.
 *   bun scripts/test-catalogs.ts   (exit 0 = all pass)
 *
 * Part 1: pure unit checks of filterLines / lineKey / mergeCatalog.
 * Part 2: HTTP round trip against the live dev server (login → favorites
 *         PUT/GET → catalog POST/active-merge/PATCH/DELETE). Cleans up after
 *         itself and restores favorites in `finally`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	IMPLANT_LIBRARY,
	filterLines,
	lineKey,
	mergeCatalog,
	DENSITY_DOC_LINKS,
	REGIONS,
	type ImplantLine
} from '../src/lib/implantLibrary';

const BASE = process.env.CDX_BASE ?? 'http://localhost:5173';
const DATA_DIR = process.env.CDX_DATA_DIR ?? join(import.meta.dir, '..', 'data');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

// ---------------- Part 1: filterLines / lineKey / mergeCatalog ----------------

check('library still exports the original 7 implant lines',
	IMPLANT_LIBRARY.filter((l) => (l.kind ?? 'implant') === 'implant').length >= 7);
check('REGIONS list', REGIONS.includes('global') && REGIONS.includes('EU') && REGIONS.includes('US'));
check('lineKey shape', lineKey(IMPLANT_LIBRARY[2]) === 'Straumann/BLT (Bone Level Tapered)');

const qHits = filterLines({ q: 'blx' });
check('q matches line substring (blx)', qHits.length === 1 && qHits[0].line === 'BLX');
check('q matches manufacturer substring', filterLines({ q: 'nobel' }).length === 1);
check('q matches article substring', filterLines({ q: 'gen-endo' }).length === 1);
check('q no match → empty', filterLines({ q: 'zzz-nothing' }).length === 0);

const pins = filterLines({ kind: 'pin' });
check('kind=pin → 2 fixation-pin lines', pins.length === 2 && pins.every((l) => l.kind === 'pin'));
check('kind=endoDrill → 1 line', filterLines({ kind: 'endoDrill' }).length === 1);
check(
	'kind=implant excludes pins/drills',
	filterLines({ kind: 'implant' }).every((l) => (l.kind ?? 'implant') === 'implant')
);

const eu = filterLines({ region: 'EU' });
check(
	'region=EU keeps global + EU, drops US',
	eu.some((l) => l.line === 'Astra Tech EV') &&
		!eu.some((l) => l.line === 'TSV') &&
		eu.some((l) => l.line === 'BLX')
);
check('region=US drops EU-only', !filterLines({ region: 'US' }).some((l) => l.line === 'Astra Tech EV'));

const favKey = lineKey(IMPLANT_LIBRARY[3]); // Straumann/BLX
const favs = filterLines({ favoritesOnly: true, favorites: [favKey] });
check('favoritesOnly filters to favorite keys', favs.length === 1 && lineKey(favs[0]) === favKey);
check('favoritesOnly with empty favorites → empty', filterLines({ favoritesOnly: true, favorites: [] }).length === 0);

// unique per run so leftover rows from other sessions can never collide
const RUN = `tc${Date.now().toString(36)}`;
const customLines: ImplantLine[] = [
	{ manufacturer: 'Custom', line: `Test Line A ${RUN}`, diameters: [3.5], lengths: [10], taper: 0.2, outdated: true },
	{ manufacturer: 'Custom', line: `Test Line B ${RUN}`, diameters: [4.0], lengths: [12], taper: 0 }
];
const isMine = (l: ImplantLine): boolean => l.line.endsWith(RUN);
const merged = mergeCatalog(customLines);
check('mergeCatalog appends custom lines', merged.length === IMPLANT_LIBRARY.length + 2);
check('mergeCatalog marks custom: true', merged.filter((l) => l.custom).length === 2);
check(
	'mergeCatalog replaces same-key built-in',
	mergeCatalog([{ manufacturer: 'Straumann', line: 'BLX', diameters: [4], lengths: [10], taper: 0 }]).length ===
		IMPLANT_LIBRARY.length
);
check('outdated default excludes flagged lines', !filterLines({ lines: merged }).some((l) => l.outdated));
check('outdated default keeps all built-ins', filterLines({}).length === IMPLANT_LIBRARY.length);
check('outdated=include keeps flagged lines', filterLines({ lines: merged, outdated: 'include' }).length === merged.length);
const only = filterLines({ lines: merged, outdated: 'only' });
check('outdated=only → just flagged lines', only.length === 1 && only[0].line === customLines[0].line);
check('diameter+length combine (AND)', filterLines({ diameter: 4.1, length: 16 }).length >= 1);
check('DENSITY_DOC_LINKS populated', DENSITY_DOC_LINKS.length >= 3 && DENSITY_DOC_LINKS.every((d) => d.url.startsWith('https://')));

// ---------------- Part 2: HTTP round trip ----------------

let cookie = '';
async function api(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${BASE}${path}`, {
		...init,
		redirect: 'manual',
		headers: { origin: BASE, cookie, ...(init.headers ?? {}) }
	});
}

async function login(): Promise<boolean> {
	const r = await api('/login', {
		method: 'POST',
		headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ email: 'cdx@surrey.ac', password: 'devpassword1' }).toString()
	});
	const setCookie = r.headers.get('set-cookie') ?? '';
	const m = setCookie.match(/cdx_session=([^;]+)/);
	if (!m) return false;
	cookie = `cdx_session=${m[1]}`;
	return true;
}

const createdIds: number[] = [];
let prevFavorites: string[] | null = null;

try {
	check('login as admin', await login());
	if (!cookie) throw new Error('no session — skipping HTTP checks');

	// ---- favorites round trip ----
	const f0 = await api('/api/favorites');
	const f0body = await f0.json();
	check('GET /api/favorites shape', f0.ok && Array.isArray(f0body.favorites));
	prevFavorites = f0body.favorites;

	const put = await api('/api/favorites', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ favorites: ['Straumann/BLX', 'coDiagnostiX/Fixation Pin'] })
	});
	check('PUT /api/favorites ok', put.ok);
	const f1 = await (await api('/api/favorites')).json();
	check(
		'favorites round trip',
		Array.isArray(f1.favorites) &&
			f1.favorites.length === 2 &&
			f1.favorites.includes('Straumann/BLX') &&
			f1.favorites.includes('coDiagnostiX/Fixation Pin')
	);
	const badPut = await api('/api/favorites', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ favorites: [1, 2] })
	});
	check('PUT rejects non-string favorites', badPut.status === 400);

	// ---- catalog upload ----
	const post = await api('/api/catalogs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Test Catalog', version: 'test-1', lines: customLines })
	});
	const postBody = await post.json();
	check('POST /api/catalogs → 201', post.status === 201, JSON.stringify(postBody));
	const catId: number | undefined = postBody?.catalog?.id;
	if (catId) createdIds.push(catId);
	check(
		'created catalog summary shape',
		!!postBody?.catalog &&
			postBody.catalog.name === 'Test Catalog' &&
			postBody.catalog.version === 'test-1' &&
			postBody.catalog.count === 2 &&
			postBody.catalog.active === true &&
			postBody.catalog.outdated === false &&
			typeof postBody.catalog.file === 'string'
	);
	const catFile = join(DATA_DIR, postBody?.catalog?.file ?? 'missing');
	check('catalog file written under DATA_DIR', existsSync(catFile));

	const badPost = await api('/api/catalogs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'Bad', version: '1', lines: [{ manufacturer: 'X' }] })
	});
	check('POST rejects malformed lines → 400', badPost.status === 400);

	// ---- list + active merge ----
	const list = await (await api('/api/catalogs')).json();
	check('GET /api/catalogs lists the new version', list.catalogs?.some((c: { id: number }) => c.id === catId));

	let active = await (await api('/api/catalogs/active')).json();
	let mine = (active.lines as ImplantLine[]).filter(isMine);
	check(
		'GET /api/catalogs/active returns custom-marked lines',
		mine.length === 2 && mine.every((l) => l.custom === true)
	);
	check(
		'active merge produces valid library via mergeCatalog',
		mergeCatalog(active.lines).length >= IMPLANT_LIBRARY.length
	);

	// ---- outdated flag ----
	const patchOut = await api(`/api/catalogs/${catId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ outdated: true })
	});
	check('PATCH { outdated: true } ok', patchOut.ok);
	active = await (await api('/api/catalogs/active')).json();
	mine = (active.lines as ImplantLine[]).filter(isMine);
	check('all catalog lines now flagged outdated', mine.length === 2 && mine.every((l) => l.outdated === true));
	const visible = filterLines({ lines: mergeCatalog(active.lines) });
	check('default filter hides outdated catalog lines, keeps built-ins',
		!visible.some(isMine) && visible.filter((l) => !l.custom).length >= IMPLANT_LIBRARY.length - 2);
	check(
		"outdated 'only' surfaces them",
		filterLines({ lines: mergeCatalog(active.lines), outdated: 'only' }).filter(isMine).length === 2
	);

	// ---- deactivate ----
	const patchOff = await api(`/api/catalogs/${catId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ active: false })
	});
	const patchOffBody = await patchOff.json();
	check('PATCH { active: false } ok', patchOff.ok && patchOffBody.catalog.active === false);
	active = await (await api('/api/catalogs/active')).json();
	check(
		'inactive catalog excluded from /active',
		!(active.lines as ImplantLine[]).some(isMine)
	);

	// ---- delete ----
	const del = await api(`/api/catalogs/${catId}`, { method: 'DELETE' });
	check('DELETE /api/catalogs/[id] ok', del.ok);
	if (del.ok && catId) createdIds.splice(createdIds.indexOf(catId), 1);
	check('catalog file removed on delete', !existsSync(catFile));
	const after = await (await api('/api/catalogs')).json();
	check('row gone from list', !after.catalogs?.some((c: { id: number }) => c.id === catId));
	check('GET deleted id → 404', (await api(`/api/catalogs/${catId}`)).status === 404);
} catch (e) {
	check(`unexpected error: ${e}`, false);
} finally {
	// cleanup: any catalogs we created but did not delete, and restore favorites
	for (const id of createdIds) {
		await api(`/api/catalogs/${id}`, { method: 'DELETE' }).catch(() => {});
	}
	if (cookie && prevFavorites) {
		const restore = await api('/api/favorites', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ favorites: prevFavorites })
		}).catch(() => null);
		const f = restore?.ok ? await (await api('/api/favorites')).json() : { favorites: null };
		check('favorites restored to previous value', JSON.stringify(f.favorites) === JSON.stringify(prevFavorites));
	}
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll catalog checks passed');
