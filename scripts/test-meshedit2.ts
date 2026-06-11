/**
 * Mesh Editor v2 test suite — pure server-side, no dev server needed:
 *   bun run scripts/test-meshedit2.ts   (exit 0 = all pass)
 *
 * Part 1: unit checks of the new src/lib/server/meshEdit.ts ops on synthetic
 *         soups (parts / holes variants / reduce / invert / erase / margin
 *         cut / wax knife strengths / combine / replay determinism).
 * Part 2: the /api/models/[id]/edit handlers invoked directly (fabricated
 *         RequestEvents) against a THROWAWAY data dir + database, covering
 *         the op-list replay contract: preview never writes, apply writes +
 *         keeps a one-time .orig, saveAsCopy creates a new model row, and
 *         the inspection GET.
 * Part 3: boundary optimization (boundarySmooth) — rim-only constrained
 *         Laplacian on noisy open borders, loop targeting, determinism.
 */
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// isolate BEFORE importing anything that opens the database
process.env.CDX_DATA_DIR = mkdtempSync(join(tmpdir(), 'cdx-meshedit2-'));
const DATA_DIR = process.env.CDX_DATA_DIR;

import {
	applyMeshEdit,
	applyMeshEditOps,
	listHoles,
	listParts,
	meshStats,
	type MeshEditOp,
	type Vec3
} from '../src/lib/server/meshEdit';
import { meshToStlBinary, parseStl } from '../src/lib/server/stl';

const repo = await import('../src/lib/server/db/repo');
const { db, resolveData, caseRel } = await import('../src/lib/server/db');
const edit = await import('../src/routes/api/models/[id]/edit/+server');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

/* ================= synthetic meshes ================= */

type V3 = [number, number, number];

/** Axis-aligned cube [o, o+s]^3, each face a sub×sub grid, wound outward. */
function cubeTris(o: V3, s: number, sub = 1, skipTopFace = false): V3[][] {
	const tris: V3[][] = [];
	const add = (org: V3, u: V3, v: V3): void => {
		for (let i = 0; i < sub; i++) {
			for (let j = 0; j < sub; j++) {
				const p = (a: number, b: number): V3 => [
					org[0] + (u[0] * a + v[0] * b) / sub,
					org[1] + (u[1] * a + v[1] * b) / sub,
					org[2] + (u[2] * a + v[2] * b) / sub
				];
				tris.push([p(i, j), p(i + 1, j), p(i + 1, j + 1)], [p(i, j), p(i + 1, j + 1), p(i, j + 1)]);
			}
		}
	};
	const [x, y, z] = o;
	if (!skipTopFace) add([x, y, z + s], [s, 0, 0], [0, s, 0]); // +z
	add([x, y, z], [0, s, 0], [s, 0, 0]); // -z
	add([x + s, y, z], [0, s, 0], [0, 0, s]); // +x
	add([x, y, z], [0, 0, s], [0, s, 0]); // -x
	add([x, y + s, z], [0, 0, s], [s, 0, 0]); // +y
	add([x, y, z], [s, 0, 0], [0, 0, s]); // -y
	return tris;
}

function soup(tris: V3[][]): Float32Array {
	return Float32Array.from(tris.flat(2));
}

/** xy plane grid of w×h unit quads at z=0 (2wh triangles). */
function planeSoup(w: number, h: number, z = 0): Float32Array {
	const tris: V3[][] = [];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			tris.push(
				[[x, y, z], [x + 1, y, z], [x + 1, y + 1, z]],
				[[x, y, z], [x + 1, y + 1, z], [x, y + 1, z]]
			);
		}
	}
	return soup(tris);
}

function signedVolume(p: Float32Array): number {
	let v = 0;
	for (let i = 0; i + 8 < p.length; i += 9) {
		const [ax, ay, az] = [p[i], p[i + 1], p[i + 2]];
		const [bx, by, bz] = [p[i + 3], p[i + 4], p[i + 5]];
		const [cx, cy, cz] = [p[i + 6], p[i + 7], p[i + 8]];
		v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
	}
	return v;
}

/* ================= Part 1: unit checks ================= */

/* ---- part detection: small cube (12 tris) + subdivided cube (48 tris) ---- */
const twoCubes = soup([...cubeTris([0, 0, 0], 2), ...cubeTris([10, 0, 0], 4, 2)]);
{
	const lp = listParts(twoCubes);
	check('part detection finds 2 parts', lp.parts.length === 2, `${lp.parts.length}`);
	check(
		'parts sorted largest first (48 then 12 tris)',
		lp.parts[0]?.triangles === 48 && lp.parts[1]?.triangles === 12,
		JSON.stringify(lp.parts)
	);
	const keep = applyMeshEdit(twoCubes, { op: 'parts', action: 'keepLargest' });
	check('delete-all-but-largest leaves 1 part / 48 tris', listParts(keep.positions).parts.length === 1 && keep.positions.length === 48 * 9);
	const del = applyMeshEdit(twoCubes, { op: 'parts', action: 'deleteSelected', part: 1 });
	check('delete selected part removes the 12-tri cube', del.positions.length === 48 * 9, `${del.positions.length / 9}`);
	const only = applyMeshEdit(twoCubes, { op: 'parts', action: 'keepSelected', part: 1 });
	check('keep selected part keeps the 12-tri cube', only.positions.length === 12 * 9, `${only.positions.length / 9}`);
}

/* ---- holes: open box (8-edge top opening) + one missing side triangle (3-edge hole) ---- */
const openBoxTris = cubeTris([0, 0, 0], 4, 2, true);
// drop one BOTTOM-face triangle (all its edges are shared with surviving
// triangles, away from the open top rim) → isolated 3-edge hole
openBoxTris.splice(4, 1);
const openBox = soup(openBoxTris);
{
	const lh = listHoles(openBox);
	check('open box lists 2 holes, largest first', lh.holes.length === 2 && lh.holes[0].edges === 8 && lh.holes[1].edges === 3, JSON.stringify(lh.holes.map((h) => h.edges)));
	check('hole rim polyline returned for highlighting', lh.holes[0].loop.length === 8);

	const exc = applyMeshEdit(openBox, { op: 'fillHoles', maxEdges: 100000, exceptLargest: true });
	const after = listHoles(exc.positions);
	check(
		'close-all-except-largest leaves only the 8-edge opening',
		exc.report.holesFilled === 1 && after.holes.length === 1 && after.holes[0].edges === 8,
		JSON.stringify(after.holes.map((h) => h.edges))
	);

	const all = applyMeshEdit(openBox, { op: 'fillHoles', maxEdges: 100000 });
	check('close-all (incl. largest) makes the box watertight', listHoles(all.positions).holes.length === 0 && all.report.holesFilled === 2);

	const sel = applyMeshEdit(openBox, { op: 'fillHoles', hole: 1 });
	const afterSel = listHoles(sel.positions);
	check('close selected hole (index 1 = 3 edges) keeps the top open', afterSel.holes.length === 1 && afterSel.holes[0].edges === 8);
}

/* ---- reduce ---- */
const bigPlane = planeSoup(30, 30); // 1800 triangles
{
	const red = applyMeshEdit(bigPlane, { op: 'reduce', targetPercent: 50 });
	const n = red.positions.length / 9;
	check('reduce to 50% halves triangles ±20%', n >= 720 && n <= 1080, `${n} of 1800`);
	const red2 = applyMeshEdit(bigPlane, { op: 'reduce', targetPercent: 50 });
	check('reduce is deterministic', red.positions.length === red2.positions.length && red.positions.every((v, i) => v === red2.positions[i]));
	const noop = applyMeshEdit(bigPlane, { op: 'reduce', targetPercent: 100 });
	check('reduce to 100% is a no-op', noop.positions.length === bigPlane.length);
}

/* ---- invert ---- */
const cube = soup(cubeTris([0, 0, 0], 2));
{
	const v0 = signedVolume(cube);
	const inv = applyMeshEdit(cube, { op: 'invert' });
	check('invert flips winding (signed volume negates)', v0 > 0 && Math.abs(signedVolume(inv.positions) + v0) < 1e-6, `${v0} → ${signedVolume(inv.positions)}`);
	const back = applyMeshEdit(inv.positions, { op: 'invert' });
	check('double invert restores the soup', back.positions.every((v, i) => v === cube[i]));
}

/* ---- erase: sphere vs deep cylinder ---- */
{
	const twoPlanes = Float32Array.from([...planeSoup(30, 30, 0), ...planeSoup(30, 30, 6)]);
	const center: Vec3 = { x: 15, y: 15, z: 0 };
	const plain = applyMeshEdit(twoPlanes, { op: 'erase', center, radius: 3 });
	const nPlain = Number(plain.report.removed);
	// circle area π·9 ≈ 28.3 mm² ≈ 56 half-unit triangles on ONE plane
	check('erase (sphere) removes ~expected count from one plane', nPlain >= 40 && nPlain <= 75, `${nPlain}`);
	const deep = applyMeshEdit(twoPlanes, { op: 'erase', center, radius: 3, deep: true, axis: { x: 0, y: 0, z: 1 } });
	const nDeep = Number(deep.report.removed);
	check('deep erase (cylinder) cuts through both planes', nDeep >= 2 * 40 && nDeep <= 2 * 75 && nDeep > nPlain * 1.5, `${nDeep} vs ${nPlain}`);
	check('erase keeps the rest intact', plain.positions.length / 9 === 3600 - nPlain);
}

/* ---- margin cut ---- */
{
	const loop: Vec3[] = [
		{ x: 10, y: 10, z: 0 },
		{ x: 20, y: 10, z: 0 },
		{ x: 20, y: 20, z: 0 },
		{ x: 10, y: 20, z: 0 }
	];
	const inside = applyMeshEdit(bigPlane, { op: 'marginCut', points: loop, keep: 'inside' });
	const nIn = inside.positions.length / 9;
	check('margin cut keep-inside keeps ~the loop area (200 tris ±20%)', nIn >= 160 && nIn <= 240, `${nIn}`);
	const outside = applyMeshEdit(bigPlane, { op: 'marginCut', points: loop, keep: 'outside' });
	check('inside + outside partition the mesh', nIn + outside.positions.length / 9 === 1800);
}

/* ---- wax knife strengths ---- */
{
	const plane = planeSoup(12, 12);
	const add = applyMeshEdit(plane, { op: 'smooth', mode: 'add', strength: 'D', center: { x: 6, y: 6, z: 0 }, radius: 3 });
	let maxZ = -Infinity;
	for (let i = 2; i < add.positions.length; i += 3) maxZ = Math.max(maxZ, add.positions[i]);
	check('wax knife add/D raises the surface ~0.5 mm', maxZ > 0.45 && maxZ < 0.56, `${maxZ.toFixed(3)}`);
	const rem = applyMeshEdit(plane, { op: 'smooth', mode: 'flatten', strength: 'A', center: { x: 6, y: 6, z: 0 }, radius: 3 });
	let minZ = Infinity;
	for (let i = 2; i < rem.positions.length; i += 3) minZ = Math.min(minZ, rem.positions[i]);
	check('wax knife flatten/A removes ~0.1 mm', minZ < -0.09 && minZ > -0.12, `${minZ.toFixed(3)}`);
}

/* ---- replay from baseline is deterministic/idempotent ---- */
{
	const ops: MeshEditOp[] = [
		{ op: 'fillHoles', maxEdges: 100000 },
		{ op: 'reduce', targetPercent: 80 },
		{ op: 'invert' },
		{ op: 'erase', center: { x: 2, y: 2, z: 0 }, radius: 1 }
	];
	const a = applyMeshEditOps(openBox, ops);
	const b = applyMeshEditOps(openBox, ops);
	check(
		'replay-from-baseline is idempotent (byte-identical result)',
		a.positions.length === b.positions.length && a.positions.every((v, i) => v === b.positions[i]),
		`${a.positions.length} vs ${b.positions.length}`
	);
	check('replay reports one entry per op', a.reports.length === ops.length);
	const undo = applyMeshEditOps(openBox, ops.slice(0, -1));
	check('undo = pop + replay changes the result', undo.positions.length !== a.positions.length);
	const stats = meshStats(a.positions);
	check('replay returns live counts', a.triangles === a.positions.length / 9 && a.vertices === stats.vertices);
}

/* ================= Part 2: endpoint round trip (no dev server) ================= */

interface EventInit {
	body?: unknown;
	query?: string;
}
function postEvent(modelId: number, body: unknown) {
	return {
		params: { id: String(modelId) },
		request: new Request('http://test/edit', { method: 'POST', body: JSON.stringify(body) }),
		url: new URL(`http://test/api/models/${modelId}/edit`),
		locals: { user: { email: 'meshedit2@test' } }
	} as unknown as Parameters<typeof edit.POST>[0];
}
function getEvent(modelId: number, query: string) {
	return {
		params: { id: String(modelId) },
		url: new URL(`http://test/api/models/${modelId}/edit${query}`),
		locals: { user: { email: 'meshedit2@test' } }
	} as unknown as Parameters<typeof edit.GET>[0];
}
async function expectError(p: Promise<Response>): Promise<number> {
	try {
		const r = await p;
		return r.status;
	} catch (e) {
		return (e as { status?: number })?.status ?? 0;
	}
}

function createModelRow(caseId: number, name: string, positions: Float32Array, transform: number[] | null): { id: number; file_path: string } {
	const rel = join(caseRel(caseId), `model_${name.replace(/\W+/g, '')}.stl`);
	writeFileSync(resolveData(rel), meshToStlBinary(positions, name));
	const row = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, transform)
			 VALUES (?1, ?2, 'scan', ?3, '#c8b89a', ?4) RETURNING id, file_path`
		)
		.get(caseId, name, rel, transform ? JSON.stringify(transform) : '') as { id: number; file_path: string };
	return row;
}

try {
	const patient = repo.createPatient({ first_name: 'Scratch', last_name: 'MeshEdit2' });
	const scratch = repo.createCase(patient.id, 'meshedit2 scratch');

	const mA = createModelRow(scratch.id, 'TwoCubes', twoCubes, null);
	const mB = createModelRow(scratch.id, 'Shifted', cube, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 0, 0, 1]);
	const fileA = resolveData(mA.file_path);
	const pristine = readFileSync(fileA);

	/* ---- GET inspection ---- */
	{
		const r = await edit.GET(getEvent(mA.id, '?inspect=stats'));
		const b = await r.json();
		check('GET stats returns counts + sibling models', b.triangles === 60 && b.name === 'TwoCubes' && b.models?.some((s: { id: number }) => s.id === mB.id), JSON.stringify(b));
		const rp = await edit.GET(getEvent(mA.id, '?inspect=parts'));
		const bp = await rp.json();
		check('GET inspect=parts finds the 2 cubes', bp.parts?.length === 2, JSON.stringify(bp.parts));
		const ops = encodeURIComponent(JSON.stringify([{ op: 'parts', action: 'keepLargest' }]));
		const rq = await edit.GET(getEvent(mA.id, `?inspect=parts&ops=${ops}`));
		const bq = await rq.json();
		check('GET inspection replays the ops query (1 part left)', bq.parts?.length === 1, JSON.stringify(bq.parts));
		const rPart = await edit.GET(getEvent(mA.id, '?inspect=part&part=1'));
		const partBuf = new Float32Array(await rPart.arrayBuffer());
		check('GET inspect=part returns the part soup (12 tris)', partBuf.length === 12 * 9, `${partBuf.length / 9}`);
	}

	/* ---- preview: replay, binary body, NO write ---- */
	{
		const r = await edit.POST(postEvent(mA.id, { ops: [{ op: 'parts', action: 'keepLargest' }, { op: 'invert' }] }));
		check('preview returns octet-stream + counts', r.headers.get('Content-Type') === 'application/octet-stream' && r.headers.get('X-Triangles') === '48', `${r.headers.get('X-Triangles')}`);
		const body = new Float32Array(await r.arrayBuffer());
		check('preview body is the replayed soup', body.length === 48 * 9);
		const reports = JSON.parse(r.headers.get('X-Reports') ?? '[]');
		check('preview reports one entry per op', reports.length === 2 && reports[1]?.op === 'invert');
		check('preview did NOT write the model file', readFileSync(fileA).equals(pristine));
		check('preview did NOT create a .orig backup', !existsSync(`${fileA}.orig`));
	}

	/* ---- saveAsCopy: new model row, source untouched ---- */
	{
		const before = repo.listModels(scratch.id).length;
		const r = await edit.POST(postEvent(mA.id, { ops: [{ op: 'parts', action: 'keepLargest' }], saveAsCopy: true }));
		const b = await r.json();
		check('saveAsCopy creates a new model row', b.model?.id != null && b.model.id !== mA.id && repo.listModels(scratch.id).length === before + 1, JSON.stringify(b.model?.id));
		check("saveAsCopy default name is '<name> (edited)'", b.model?.name === 'TwoCubes (edited)', b.model?.name);
		const copyParsed = parseStl(readFileSync(resolveData(b.model.file_path)));
		check('copy file holds the replayed mesh (48 tris)', copyParsed?.positions.length === 48 * 9);
		check('saveAsCopy leaves the source file untouched', readFileSync(fileA).equals(pristine) && !existsSync(`${fileA}.orig`));
	}

	/* ---- combine is transform-aware ---- */
	{
		const r = await edit.POST(postEvent(mA.id, { ops: [{ op: 'combine', modelId: mB.id }] }));
		const body = new Float32Array(await r.arrayBuffer());
		check('combine concatenates the sibling soup', body.length === (60 + 12) * 9, `${body.length / 9}`);
		let maxX = -Infinity;
		for (let i = 0; i < body.length; i += 3) maxX = Math.max(maxX, body[i]);
		check('combine applies the sibling transform (+20 mm x)', Math.abs(maxX - 22) < 1e-3, `${maxX}`);
	}

	/* ---- apply: writes + one-time .orig ---- */
	{
		const r = await edit.POST(postEvent(mA.id, { ops: [{ op: 'parts', action: 'keepLargest' }], apply: true }));
		const b = await r.json();
		check('apply returns counts', r.ok && b.triangles === 48, JSON.stringify(b));
		const onDisk = parseStl(readFileSync(fileA));
		check('apply overwrote the model file', onDisk?.positions.length === 48 * 9);
		check('apply created the .orig baseline backup', existsSync(`${fileA}.orig`) && readFileSync(`${fileA}.orig`).equals(pristine));
		// a second apply must not clobber the original backup
		await edit.POST(postEvent(mA.id, { ops: [{ op: 'invert' }], apply: true }));
		check('.orig backup is one-time', readFileSync(`${fileA}.orig`).equals(pristine));
	}

	/* ---- validation ---- */
	{
		check('bogus op → 400', (await expectError(edit.POST(postEvent(mA.id, { ops: [{ op: 'bogus' }] })))) === 400);
		check('erase without center → 400', (await expectError(edit.POST(postEvent(mA.id, { ops: [{ op: 'erase' }] })))) === 400);
		check('erasing everything → 400 (empty mesh guard)', (await expectError(edit.POST(postEvent(mA.id, { ops: [{ op: 'erase', center: { x: 2, y: 2, z: 1 }, radius: 1000 }] })))) === 400);
		check('combine with a foreign model id → 400', (await expectError(edit.POST(postEvent(mA.id, { ops: [{ op: 'combine', modelId: 999999 }] })))) === 400);
		// legacy single-op contract still works
		const r = await edit.POST(postEvent(mB.id, { op: 'fillHoles' }));
		const b = await r.json();
		check('legacy single-op contract still answers', r.ok && b.triangles === 12, JSON.stringify(b));
	}
} catch (e) {
	check(`unexpected error: ${e instanceof Error ? (e.stack ?? e.message) : e}`, false);
} finally {
	db.close();
	rmSync(DATA_DIR, { recursive: true, force: true });
}

/* ================= Part 3: boundary optimization (boundarySmooth) ================= */

/** Open box whose top rim zig-zags: alternate rim vertices displaced ±1 mm in z. */
function zigzagOpenBox(o: V3, s: number, sub: number): Float32Array {
	const zTop = o[2] + s;
	const step = s / sub; // rim vertices sit on a step grid; (x+y)/step alternates parity along the loop
	const tris = cubeTris(o, s, sub, true).map((t) =>
		t.map(([x, y, z]): V3 => (z === zTop ? [x, y, z + (((x + y) / step) % 2 === 0 ? 1 : -1)] : [x, y, z]))
	);
	return soup(tris);
}

/** Σ per-vertex distance from the midpoint of its two loop neighbors (rim raggedness). */
function rimDeviation(positions: Float32Array, holeIndex: number): number {
	const loop = listHoles(positions).holes[holeIndex]?.loop ?? [];
	const n = loop.length;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const p = loop[i];
		const a = loop[(i - 1 + n) % n];
		const b = loop[(i + 1) % n];
		sum += Math.hypot(p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2, p.z - (a.z + b.z) / 2);
	}
	return sum;
}

{
	// 16-vertex noisy rim (rim verts at z = 7 or 9; everything else at z ≤ 6)
	const noisy = zigzagOpenBox([0, 0, 0], 8, 4);
	const before = rimDeviation(noisy, 0);
	const res = applyMeshEdit(noisy, { op: 'boundarySmooth', iterations: 3 });
	const after = rimDeviation(res.positions, 0);
	check('boundarySmooth(3) shrinks rim deviation by >60%', before > 0 && after < 0.4 * before, `${before.toFixed(3)} → ${after.toFixed(3)} mm`);
	check('boundarySmooth reports loops touched + vertices moved', res.report.loops === 1 && res.report.vertices === 16 && res.report.iterations === 3, JSON.stringify(res.report));
	let interiorOk = res.positions.length === noisy.length;
	for (let i = 0; interiorOk && i + 2 < noisy.length; i += 3) {
		if (noisy[i + 2] <= 6 && (res.positions[i] !== noisy[i] || res.positions[i + 1] !== noisy[i + 1] || res.positions[i + 2] !== noisy[i + 2])) {
			interiorOk = false;
		}
	}
	check('boundarySmooth leaves interior vertices byte-identical', interiorOk);

	// loop targeting: two noisy open boxes → 16-edge rim (loop 0) and 8-edge rim (loop 1)
	const two = Float32Array.from([...zigzagOpenBox([0, 0, 0], 8, 4), ...zigzagOpenBox([20, 0, 0], 4, 2)]);
	const dev1 = rimDeviation(two, 1);
	const sel = applyMeshEdit(two, { op: 'boundarySmooth', iterations: 3, loop: 1 });
	check('boundarySmooth loop=1 smooths the chosen rim', rimDeviation(sel.positions, 1) < 0.4 * dev1, `${dev1.toFixed(3)} → ${rimDeviation(sel.positions, 1).toFixed(3)} mm`);
	let otherOk = sel.positions.length === two.length;
	for (let i = 0; otherOk && i + 2 < two.length; i += 3) {
		// the first box lives at x ≤ 8 — none of its vertices may move
		if (two[i] <= 10 && (sel.positions[i] !== two[i] || sel.positions[i + 1] !== two[i + 1] || sel.positions[i + 2] !== two[i + 2])) {
			otherOk = false;
		}
	}
	check('boundarySmooth loop targeting leaves the other loop byte-identical', otherOk);

	// replay determinism
	const ops: MeshEditOp[] = [{ op: 'boundarySmooth', iterations: 3 }];
	const r1 = applyMeshEditOps(noisy, ops);
	const r2 = applyMeshEditOps(noisy, ops);
	check(
		'boundarySmooth replay is deterministic (byte-identical output)',
		r1.positions.length === r2.positions.length && r1.positions.every((v, i) => v === r2.positions[i]),
		`${r1.positions.length} vs ${r2.positions.length}`
	);
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll meshedit2 checks passed');
