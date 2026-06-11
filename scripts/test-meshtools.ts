/**
 * Mesh tools test suite (repair / detect / cut / replace / order-package import).
 *   bun run scripts/test-meshtools.ts   (exit 0 = all pass)
 *
 * Part 1: pure unit checks of src/lib/server/meshTools.ts on synthetic soups.
 * Part 2: HTTP round trip against the live dev server using a scratch
 *         patient/case (created via direct DB, removed in `finally`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { cutMeshZ, detectMeshIssues, repairMesh } from '../src/lib/server/meshTools';
import { meshToStlBinary, parseStl } from '../src/lib/server/stl';

const BASE = process.env.CDX_BASE ?? 'http://localhost:5173';
process.env.CDX_DATA_DIR ??= join(import.meta.dir, '..', 'data');
const DATA_DIR = process.env.CDX_DATA_DIR ?? join(import.meta.dir, '..', 'data');

// import AFTER CDX_DATA_DIR is pinned so the test opens the same database
// as the dev server regardless of cwd
const repo = await import('../src/lib/server/db/repo');
const { db } = await import('../src/lib/server/db');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

/* ================= Part 1: unit checks ================= */

type V3 = [number, number, number];
function soup(tris: V3[][]): Float32Array {
	return Float32Array.from(tris.flat(2));
}
function triNormalDot(tri: V3[], centroid: V3): number {
	const [a, b, c] = tri;
	const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
	const f = [
		(a[0] + b[0] + c[0]) / 3 - centroid[0],
		(a[1] + b[1] + c[1]) / 3 - centroid[1],
		(a[2] + b[2] + c[2]) / 3 - centroid[2]
	];
	return n[0] * f[0] + n[1] * f[1] + n[2] * f[2];
}
/** orient a face so its normal points away from the centroid */
function outward(tri: V3[], centroid: V3 = [0, 0, 0]): V3[] {
	return triNormalDot(tri, centroid) >= 0 ? tri : [tri[0], tri[2], tri[1]];
}

// regular tetrahedron, all faces wound outward
const A: V3 = [1, 1, 1];
const B: V3 = [1, -1, -1];
const C: V3 = [-1, 1, -1];
const D: V3 = [-1, -1, 1];
const tetra: V3[][] = [
	outward([A, B, C]),
	outward([A, B, D]),
	outward([A, C, D]),
	outward([B, C, D])
];

// planted soup: tetra with face 1 flipped + 2 degenerates + 1 duplicate
const flipped: V3[] = [tetra[1][0], tetra[1][2], tetra[1][1]];
const degenCollapsed: V3[] = [
	[3, 3, 3],
	[3, 3, 3],
	[3, 3, 3]
];
const degenCollinear: V3[] = [
	[0, 0, 0],
	[1, 0, 0],
	[2, 0, 0]
];
const duplicate: V3[] = [tetra[0][1], tetra[0][2], tetra[0][0]]; // same vertex set, rotated
const planted = soup([tetra[0], flipped, tetra[2], tetra[3], degenCollapsed, degenCollinear, duplicate]);

const rep = repairMesh(planted);
check('repair removes 2 planted degenerates', rep.report.removedDegenerate === 2, `${rep.report.removedDegenerate}`);
check('repair removes 1 planted duplicate', rep.report.removedDuplicate === 1, `${rep.report.removedDuplicate}`);
check('repair flips 1 minority-wound face', rep.report.flippedNormals === 1, `${rep.report.flippedNormals}`);
check('repair keeps the 4 valid faces', rep.positions.length === 4 * 9, `${rep.positions.length / 9} triangles`);
{
	let allOut = rep.positions.length > 0;
	for (let i = 0; i < rep.positions.length; i += 9) {
		const t: V3[] = [
			[rep.positions[i], rep.positions[i + 1], rep.positions[i + 2]],
			[rep.positions[i + 3], rep.positions[i + 4], rep.positions[i + 5]],
			[rep.positions[i + 6], rep.positions[i + 7], rep.positions[i + 8]]
		];
		if (triNormalDot(t, [0, 0, 0]) <= 0) allOut = false;
	}
	check('all repaired faces wound outward', allOut);
}
const repAgain = repairMesh(rep.positions);
check(
	'repair is idempotent',
	repAgain.report.removedDegenerate === 0 &&
		repAgain.report.removedDuplicate === 0 &&
		repAgain.report.flippedNormals === 0
);

const plantedIssues = detectMeshIssues(planted);
check('detect counts planted degenerates', plantedIssues.degenerate === 2, `${plantedIssues.degenerate}`);
check('detect counts planted duplicates', plantedIssues.duplicates === 1, `${plantedIssues.duplicates}`);
check('detect: repaired tetra is closed (0 open edges)', detectMeshIssues(rep.positions).openEdges === 0);

// quad strip: N quads in the z=0 plane → 2N+2 open boundary edges
const NQ = 4;
const stripTris: V3[][] = [];
for (let i = 0; i < NQ; i++) {
	const a: V3 = [i, 0, 0];
	const b: V3 = [i + 1, 0, 0];
	const c: V3 = [i + 1, 1, 0];
	const d: V3 = [i, 1, 0];
	stripTris.push([a, b, c], [a, c, d]);
}
const strip = soup(stripTris);
const stripIssues = detectMeshIssues(strip);
check(
	`detect: quad strip has ${2 * NQ + 2} open edges`,
	stripIssues.openEdges === 2 * NQ + 2,
	`${stripIssues.openEdges}`
);
check('detect: quad strip is otherwise clean', stripIssues.degenerate === 0 && stripIssues.duplicates === 0);

// z-stack: one triangle per z level 0..9 + a straddler crossing z=5
const stackTris: V3[][] = [];
for (let z = 0; z < 10; z++) {
	stackTris.push([
		[0, 0, z],
		[1, 0, z],
		[0, 1, z]
	]);
}
stackTris.push([
	[0, 0, 4.5],
	[1, 0, 4.5],
	[0, 1, 5.5]
]);
const stack = soup(stackTris);
const cut = cutMeshZ(stack, 2, 5);
check('cutZ keeps the 4 fully-inside triangles', cut.length === 4 * 9, `${cut.length / 9} triangles`);
{
	let inRange = true;
	for (let i = 2; i < cut.length; i += 3) {
		if (cut[i] < 2 || cut[i] > 5) inRange = false;
	}
	check('cutZ output z within [2, 5] (straddler dropped)', inRange);
}
check('cutZ with covering range keeps everything', cutMeshZ(stack, -1, 100).length === stack.length);

/* ================= Part 2: HTTP round trip ================= */

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
	const m = (r.headers.get('set-cookie') ?? '').match(/cdx_session=([^;]+)/);
	if (!m) return false;
	cookie = `cdx_session=${m[1]}`;
	return true;
}
async function postJson(path: string, body: unknown): Promise<Response> {
	return api(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}
const stlFile = (positions: Float32Array, name: string): File =>
	new File([meshToStlBinary(positions, name) as BlobPart], name);

const RUN = `mt${Date.now().toString(36)}`;
const auditStart = (db.query('SELECT COALESCE(MAX(id), 0) AS m FROM audit').get() as { m: number }).m;
let patientId = 0;
let caseId = 0;
const scratchModelIds: number[] = [];

try {
	check('login as admin', await login());
	if (!cookie) throw new Error('no session — dev server not reachable?');

	const patient = repo.createPatient({ first_name: 'Scratch', last_name: `MeshTools ${RUN}` });
	patientId = patient.id;
	const scratch = repo.createCase(patient.id, `meshtools scratch ${RUN}`);
	caseId = scratch.id;
	const master = repo.getMasterPlan(caseId);

	/* ---- upload the planted soup as a model ---- */
	const upForm = new FormData();
	upForm.append('file', stlFile(planted, 'planted.stl'));
	upForm.append('kind', 'scan');
	upForm.append('name', 'Planted');
	const upRes = await api(`/api/cases/${caseId}/models`, { method: 'POST', body: upForm });
	const upBody = await upRes.json();
	check('upload planted model', upRes.ok && !!upBody.model?.id, JSON.stringify(upBody));
	const modelId: number = upBody.model.id;
	const origPath: string = upBody.model.file_path;

	/* ---- detect ---- */
	const detRes = await postJson(`/api/models/${modelId}/repair`, { mode: 'detect' });
	const detBody = await detRes.json();
	check(
		'POST repair mode=detect finds planted issues',
		detRes.ok && detBody.issues?.degenerate === 2 && detBody.issues?.duplicates === 1,
		JSON.stringify(detBody)
	);

	/* ---- repair ---- */
	const fixRes = await postJson(`/api/models/${modelId}/repair`, { mode: 'repair' });
	const fixBody = await fixRes.json();
	check(
		'POST repair mode=repair reports 2 degenerate + 1 duplicate + 1 flipped',
		fixRes.ok &&
			fixBody.report?.removedDegenerate === 2 &&
			fixBody.report?.removedDuplicate === 1 &&
			fixBody.report?.flippedNormals === 1,
		JSON.stringify(fixBody)
	);
	const backupAbs = join(DATA_DIR, `${origPath}.orig`);
	check('repair backs up original as <file>.orig', existsSync(backupAbs));
	const backupParsed = existsSync(backupAbs) ? parseStl(readFileSync(backupAbs)) : null;
	check('backup holds the pristine 7-triangle upload', backupParsed?.positions.length === 7 * 9);

	const fileRes = await api(`/api/models/${modelId}/file`);
	const fileParsed = parseStl(new Uint8Array(await fileRes.arrayBuffer()));
	check('repaired model file now has 4 triangles', fileParsed?.positions.length === 4 * 9);

	const fix2 = await (await postJson(`/api/models/${modelId}/repair`, { mode: 'repair' })).json();
	check(
		'second repair is a no-op and keeps the first backup',
		fix2.report?.removedDegenerate === 0 &&
			fix2.report?.removedDuplicate === 0 &&
			parseStl(readFileSync(backupAbs))?.positions.length === 7 * 9
	);

	/* ---- cut ---- */
	const stForm = new FormData();
	stForm.append('file', stlFile(stack, 'stack.stl'));
	stForm.append('kind', 'scan');
	stForm.append('name', 'Stack');
	const stBody = await (await api(`/api/cases/${caseId}/models`, { method: 'POST', body: stForm })).json();
	const stackId: number = stBody.model.id;
	const cutRes = await postJson(`/api/models/${stackId}/repair`, { mode: 'cut', zMin: 2, zMax: 5 });
	const cutBody = await cutRes.json();
	check(
		"cut creates a new '<name> (cut)' model row",
		cutRes.ok && cutBody.model?.name === 'Stack (cut)' && cutBody.model?.id !== stackId,
		JSON.stringify(cutBody)
	);
	const cutFile = await api(`/api/models/${cutBody.model.id}/file`);
	const cutParsed = parseStl(new Uint8Array(await cutFile.arrayBuffer()));
	check('cut model file has the 4 kept triangles', cutParsed?.positions.length === 4 * 9);
	check('source model row untouched by cut', repo.listModels(caseId).some((m) => m.id === stackId));

	/* ---- replace ---- */
	const TRANSFORM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
	await api(`/api/models/${modelId}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ transform: TRANSFORM })
	});
	const beforeReplace = repo.listModels(caseId).find((m) => m.id === modelId)!;
	const repForm = new FormData();
	repForm.append('file', stlFile(strip, 'strip.stl'));
	const repRes = await api(`/api/models/${modelId}/replace`, { method: 'POST', body: repForm });
	const repBody = await repRes.json();
	check(
		'replace keeps row id/kind/transform, swaps file_path',
		repRes.ok &&
			repBody.model?.id === modelId &&
			repBody.model?.kind === 'scan' &&
			repBody.model?.file_path !== beforeReplace.file_path &&
			JSON.parse(repBody.model?.transform ?? '[]')[12] === 5,
		JSON.stringify(repBody)
	);
	check(
		'replace removed the old file and its .orig backup',
		!existsSync(join(DATA_DIR, beforeReplace.file_path)) && !existsSync(`${join(DATA_DIR, beforeReplace.file_path)}.orig`)
	);
	const newFile = parseStl(new Uint8Array(await (await api(`/api/models/${modelId}/file`)).arrayBuffer()));
	check('replaced geometry round-trips (8 strip triangles)', newFile?.positions.length === 8 * 9);

	/* ---- replace blocked while a plan is locked ---- */
	await api(`/api/plans/${master.id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ locked: true })
	});
	const lockedRes = await api(`/api/models/${modelId}/replace`, {
		method: 'POST',
		body: (() => {
			const f = new FormData();
			f.append('file', stlFile(strip, 'strip.stl'));
			return f;
		})()
	});
	check('replace → 409 while a case plan is locked', lockedRes.status === 409);
	await api(`/api/plans/${master.id}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ locked: false })
	});

	/* ---- order-package import ---- */
	const proposals = {
		implants: [
			{ tooth: '36', manufacturer: 'Straumann', line: 'BLX', diameter: 4.0, length: 10, x: 1, y: 2, z: 3, ax: 0, ay: 0, az: -1 },
			{ tooth: '46', manufacturer: 'Acme', line: 'Mystery', diameter: 4.0, length: 10, x: 4, y: 5, z: 6, ax: 0, ay: 0, az: -1 }
		]
	};
	const zip = zipSync({
		'scan.stl': meshToStlBinary(soup(tetra), 'scan'),
		'restoration.stl': meshToStlBinary(strip, 'restoration'),
		'proposals.json': strToU8(JSON.stringify(proposals))
	});
	const pkgFile = new File([zip as BlobPart], 'package.zip');

	const stub = await (await api(`/api/cases/${caseId}/import-package`)).json();
	check('GET import-package → { sources: [] } stub', Array.isArray(stub.sources) && stub.sources.length === 0);

	const modelsBefore = repo.listModels(caseId).length;
	const pvForm = new FormData();
	pvForm.append('file', pkgFile);
	pvForm.append('preview', 'true');
	const pvRes = await api(`/api/cases/${caseId}/import-package`, { method: 'POST', body: pvForm });
	const pv = await pvRes.json();
	check(
		'preview returns full manifest',
		pvRes.ok &&
			pv.manifest?.scan?.present === true &&
			pv.manifest?.scan?.triangles === 4 &&
			pv.manifest?.restoration?.present === true &&
			pv.manifest?.proposals?.length === 2,
		JSON.stringify(pv)
	);
	check(
		'manifest validates proposals against IMPLANT_LIBRARY',
		pv.manifest?.proposals?.[0]?.known === true && pv.manifest?.proposals?.[1]?.known === false
	);
	check(
		'preview writes nothing',
		repo.listModels(caseId).length === modelsBefore && repo.listImplants(master.id).length === 0
	);

	const imForm = new FormData();
	imForm.append('file', pkgFile);
	imForm.append('acceptProposals', 'true');
	const imRes = await api(`/api/cases/${caseId}/import-package`, { method: 'POST', body: imForm });
	const im = await imRes.json();
	check(
		'import creates scan + restoration models',
		imRes.ok &&
			im.models?.length === 2 &&
			im.models?.[0]?.name === 'Scan' &&
			im.models?.[0]?.kind === 'scan' &&
			im.models?.[1]?.name === 'Restoration' &&
			im.models?.[1]?.kind === 'waxup',
		JSON.stringify(im)
	);
	check('model files written to disk', im.models?.every((m: { file_path: string }) => existsSync(join(DATA_DIR, m.file_path))));
	const planted36 = await (await api(`/api/plans/${master.id}/implants`)).json();
	check(
		'proposals added to the master plan',
		im.implantsAdded === 2 &&
			planted36.implants?.length === 2 &&
			planted36.implants?.some(
				(i: { tooth: string; manufacturer: string; line: string; article: string }) =>
					i.tooth === '36' && i.manufacturer === 'Straumann' && i.line === 'BLX' && i.article === 'STM-BLX'
			),
		JSON.stringify(planted36)
	);

	const im2Form = new FormData();
	im2Form.append('file', pkgFile);
	const im2 = await (await api(`/api/cases/${caseId}/import-package`, { method: 'POST', body: im2Form })).json();
	check(
		"re-import suffixes colliding names with ' (2)'",
		im2.models?.[0]?.name === 'Scan (2)' && im2.models?.[1]?.name === 'Restoration (2)',
		JSON.stringify(im2.models?.map((m: { name: string }) => m.name))
	);
	check(
		'implants NOT added without acceptProposals',
		im2.implantsAdded === 0 && repo.listImplants(master.id).length === 2
	);
} catch (e) {
	check(`unexpected error: ${e}`, false);
} finally {
	// scratch cleanup: rows + files via the cascade helpers, plus the audit
	// entries this run generated for scratch targets
	if (caseId) {
		try {
			scratchModelIds.push(...repo.listModels(caseId).map((m) => m.id));
		} catch {
			// listing is best-effort; audit cleanup below still covers the case target
		}
	}
	if (patientId) {
		try {
			repo.deletePatient(patientId);
		} catch (e) {
			check(`cleanup failed: ${e}`, false);
		}
	}
	if (caseId) {
		const targets = [`case:${caseId}`, ...scratchModelIds.map((id) => `model:${id}`)];
		const marks = targets.map((_, i) => `?${i + 2}`).join(',');
		db.query(`DELETE FROM audit WHERE id > ?1 AND target IN (${marks})`).run(
			auditStart,
			...targets
		);
	}
	check('scratch patient/case removed', !repo.getPatient(patientId) && !repo.getCase(caseId));
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll meshtools checks passed');
