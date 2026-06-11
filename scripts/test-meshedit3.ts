/**
 * Mesh Editor v3 test suite — pure server-side, no dev server needed:
 *   bun scripts/test-meshedit3.ts   (exit 0 = all pass)
 *
 * Covers the webinar-pass server ops ("Mesh Editor — Opportunities and new
 * tools"):
 *   Part 1: remesh with explicit `maxEdge` (mm) + `iterations` strength —
 *           split-until-compliant, locality, determinism, smoothing strength.
 *   Part 2: smooth with `points` (select-area smoothing: union of spheres,
 *           ONE op = one undo step).
 *   Part 3: partialFill — close only a segment of one hole (two boundary
 *           picks, shorter arc filled, rest of the hole stays open),
 *           winding/orientation sanity via signed volume, error cases.
 *   Part 4: the /api/models/[id]/edit validateOps whitelist for the new
 *           op/params (fabricated RequestEvents against a throwaway DB).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// isolate BEFORE importing anything that opens the database
process.env.CDX_DATA_DIR = mkdtempSync(join(tmpdir(), 'cdx-meshedit3-'));
const DATA_DIR = process.env.CDX_DATA_DIR;

import {
	applyMeshEdit,
	applyMeshEditOps,
	listHoles,
	type MeshEditOp,
	type Vec3
} from '../src/lib/server/meshEdit';
import { meshToStlBinary } from '../src/lib/server/stl';

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

/** longest edge (mm) of any triangle whose centroid passes `filter`. */
function maxEdgeOf(p: Float32Array, filter?: (cx: number, cy: number, cz: number) => boolean): number {
	let worst = 0;
	for (let i = 0; i + 8 < p.length; i += 9) {
		if (filter) {
			const cx = (p[i] + p[i + 3] + p[i + 6]) / 3;
			const cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3;
			const cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
			if (!filter(cx, cy, cz)) continue;
		}
		for (const [a, b] of [
			[0, 3],
			[3, 6],
			[6, 0]
		]) {
			worst = Math.max(
				worst,
				Math.hypot(p[i + a] - p[i + b], p[i + a + 1] - p[i + b + 1], p[i + a + 2] - p[i + b + 2])
			);
		}
	}
	return worst;
}

/** Raise the grid vertex at (x, y) of a plane soup by dz (all soup copies). */
function raiseVertex(p: Float32Array, x: number, y: number, dz: number): Float32Array {
	const out = p.slice();
	for (let i = 0; i + 2 < out.length; i += 3) {
		if (out[i] === x && out[i + 1] === y) out[i + 2] += dz;
	}
	return out;
}

/* ================= Part 1: remesh maxEdge + strength ================= */

{
	// whole-mesh remesh to an explicit edge budget (iterations 0 = no smoothing,
	// so the result is analytically checkable: every edge must comply)
	const plane = planeSoup(6, 6); // unit quads, diagonals ≈ 1.414 mm
	const res = applyMeshEdit(plane, { op: 'remesh', maxEdge: 0.8, iterations: 0 });
	check('remesh maxEdge=0.8 leaves no edge above the limit', maxEdgeOf(res.positions) <= 0.8 + 1e-5, `${maxEdgeOf(res.positions).toFixed(3)} mm`);
	check('remesh maxEdge splits triangles (count grew)', res.positions.length > plane.length, `${plane.length / 9} → ${res.positions.length / 9}`);
	check(
		'remesh maxEdge reports maxEdgeMm/passes/split and 0 smoothing',
		res.report.maxEdgeMm === 0.8 && Number(res.report.passes) >= 2 && Number(res.report.split) > 0 && res.report.iterations === 0,
		JSON.stringify(res.report)
	);

	const res2 = applyMeshEdit(plane, { op: 'remesh', maxEdge: 0.8, iterations: 0 });
	check(
		'remesh maxEdge is deterministic (byte-identical)',
		res.positions.length === res2.positions.length && res.positions.every((v, i) => v === res2.positions[i])
	);

	// locality: with a center, triangles far outside the radius survive untouched
	const center: Vec3 = { x: 1, y: 1, z: 0 };
	const local = applyMeshEdit(plane, { op: 'remesh', center, radius: 1.5, maxEdge: 0.5, iterations: 0 });
	const before = new Set<string>();
	for (let i = 0; i + 8 < plane.length; i += 9) {
		const cx = (plane[i] + plane[i + 3] + plane[i + 6]) / 3;
		const cy = (plane[i + 1] + plane[i + 4] + plane[i + 7]) / 3;
		if (Math.hypot(cx - 1, cy - 1) > 4) before.add(plane.slice(i, i + 9).join(','));
	}
	const after = new Set<string>();
	for (let i = 0; i + 8 < local.positions.length; i += 9) {
		after.add(local.positions.slice(i, i + 9).join(','));
	}
	let farIntact = true;
	for (const t of before) if (!after.has(t)) farIntact = false;
	check('local remesh maxEdge leaves far triangles byte-identical', farIntact);
	check(
		'local remesh maxEdge refines near the center',
		maxEdgeOf(local.positions, (cx, cy) => Math.hypot(cx - 1, cy - 1) < 0.4) <= 0.5 + 1e-5,
		`${maxEdgeOf(local.positions, (cx, cy) => Math.hypot(cx - 1, cy - 1) < 0.4).toFixed(3)} mm near center`
	);
	check('local remesh maxEdge grew only the selected region', local.positions.length > plane.length && local.positions.length < res.positions.length);

	// strength = smoothing iterations: more iterations flatten a bump further
	// (maxEdge far above every edge ⇒ no splits, smoothing isolated)
	const bumped = raiseVertex(planeSoup(12, 12), 6, 6, 1);
	const zMax = (p: Float32Array): number => {
		let m = -Infinity;
		for (let i = 2; i < p.length; i += 3) m = Math.max(m, p[i]);
		return m;
	};
	const s1 = applyMeshEdit(bumped, { op: 'remesh', center: { x: 6, y: 6, z: 0 }, radius: 3, maxEdge: 100, iterations: 1 });
	const s3 = applyMeshEdit(bumped, { op: 'remesh', center: { x: 6, y: 6, z: 0 }, radius: 3, maxEdge: 100, iterations: 3 });
	check('remesh strength: no splits when every edge complies', s1.report.split === 0, JSON.stringify(s1.report));
	check(
		'remesh strength: 3 iterations flatten the bump more than 1',
		zMax(s3.positions) < zMax(s1.positions) && zMax(s1.positions) < 1,
		`1 it → ${zMax(s1.positions).toFixed(3)}, 3 it → ${zMax(s3.positions).toFixed(3)}`
	);

	// legacy contract (no maxEdge): uniform plane has no edge > 2× mean — no splits
	const legacy = applyMeshEdit(plane, { op: 'remesh', radius: 5 });
	check('remesh without maxEdge keeps the legacy heuristic (no splits on a uniform grid)', legacy.report.split === 0 && legacy.report.meanEdgeMm != null, JSON.stringify(legacy.report));
}

/* ================= Part 2: smooth with points (select area) ================= */

{
	let p = planeSoup(20, 20);
	p = raiseVertex(p, 5, 5, 1);
	p = raiseVertex(p, 15, 15, 1);
	p = raiseVertex(p, 10, 10, 1); // control bump — NOT selected
	const zAt = (q: Float32Array, x: number, y: number): number => {
		for (let i = 0; i + 2 < q.length; i += 3) {
			if (q[i] === x && q[i + 1] === y) return q[i + 2];
		}
		return NaN;
	};
	const res = applyMeshEdit(p, {
		op: 'smooth',
		points: [
			{ x: 5, y: 5, z: 0 },
			{ x: 15, y: 15, z: 0 }
		],
		radius: 2
	});
	check('select-area smooth flattens both marked bumps', zAt(res.positions, 5, 5) < 0.5 && zAt(res.positions, 15, 15) < 0.5, `${zAt(res.positions, 5, 5).toFixed(3)} / ${zAt(res.positions, 15, 15).toFixed(3)}`);
	check('select-area smooth leaves the unmarked bump byte-identical', zAt(res.positions, 10, 10) === 1, `${zAt(res.positions, 10, 10)}`);
	check('select-area smooth reports the center count', res.report.centers === 2, JSON.stringify(res.report));
	check('select-area smooth is ONE op (single report entry on replay)', applyMeshEditOps(p, [{ op: 'smooth', points: [{ x: 5, y: 5, z: 0 }, { x: 15, y: 15, z: 0 }], radius: 2 }]).reports.length === 1);
}

/* ================= Part 3: partialFill ================= */

{
	// open box: 8-edge square rim at z=4 (corners + edge midpoints)
	const openBox = soup(cubeTris([0, 0, 0], 4, 2, true));
	const before = listHoles(openBox);
	check('open box has one 8-edge hole', before.holes.length === 1 && before.holes[0].edges === 8, JSON.stringify(before.holes.map((h) => h.edges)));

	// corner-to-corner along one side: shorter arc = 2 edges via the midpoint
	const res = applyMeshEdit(openBox, { op: 'partialFill', a: { x: 0, y: 0, z: 4 }, b: { x: 4, y: 0, z: 4 } });
	check(
		'partialFill closes the 2-edge segment with 1 triangle',
		res.report.trianglesAdded === 1 && res.report.segmentEdges === 2 && res.report.segmentMm === 4,
		JSON.stringify(res.report)
	);
	const after = listHoles(res.positions);
	check(
		'the rest of the hole stays open (7 edges: 6 rim + the new chord)',
		after.holes.length === 1 && after.holes[0].edges === 7 && after.openEdges === 7,
		JSON.stringify(after.holes.map((h) => h.edges))
	);

	// winding sanity: closing the remaining hole must give a watertight box of volume 64
	const closed = applyMeshEdit(res.positions, { op: 'fillHoles', maxEdges: 100000 });
	const vol = signedVolume(closed.positions);
	check('partialFill keeps a consistent orientation (closed volume = 64)', listHoles(closed.positions).holes.length === 0 && Math.abs(vol - 64) < 1e-3, `${vol.toFixed(4)}`);

	// diagonal picks: both arcs are 4 edges (tie) — 3 fan triangles, 5-edge rest
	const diag = applyMeshEdit(openBox, { op: 'partialFill', a: { x: 0, y: 0, z: 4 }, b: { x: 4, y: 4, z: 4 } });
	const afterDiag = listHoles(diag.positions);
	check(
		'partialFill across the diagonal fills 4 edges with 3 triangles',
		diag.report.trianglesAdded === 3 && afterDiag.holes.length === 1 && afterDiag.holes[0].edges === 5,
		`${JSON.stringify(diag.report)} → ${JSON.stringify(afterDiag.holes.map((h) => h.edges))}`
	);

	// picks snap to the nearest boundary vertex even when slightly off the rim
	const snap = applyMeshEdit(openBox, { op: 'partialFill', a: { x: -0.4, y: 0.3, z: 4.2 }, b: { x: 4.3, y: -0.2, z: 3.9 } });
	check('partialFill snaps off-rim picks to boundary vertices', snap.report.trianglesAdded === 1 && snap.report.segmentEdges === 2, JSON.stringify(snap.report));

	// determinism
	const r1 = applyMeshEditOps(openBox, [{ op: 'partialFill', a: { x: 0, y: 0, z: 4 }, b: { x: 4, y: 4, z: 4 } }]);
	const r2 = applyMeshEditOps(openBox, [{ op: 'partialFill', a: { x: 0, y: 0, z: 4 }, b: { x: 4, y: 4, z: 4 } }]);
	check('partialFill replay is deterministic (byte-identical)', r1.positions.length === r2.positions.length && r1.positions.every((v, i) => v === r2.positions[i]));

	// error cases
	const fails = (op: MeshEditOp, what: string): boolean => {
		try {
			applyMeshEdit(openBox, op);
			return false;
		} catch (e) {
			return e instanceof Error && e.message.includes(what);
		}
	};
	check('partialFill rejects adjacent picks (nothing to fill)', fails({ op: 'partialFill', a: { x: 0, y: 0, z: 4 }, b: { x: 2, y: 0, z: 4 } }, 'too short'));
	check(
		'partialFill rejects a watertight mesh (no open boundaries)',
		(() => {
			try {
				applyMeshEdit(soup(cubeTris([0, 0, 0], 2)), { op: 'partialFill', a: { x: 0, y: 0, z: 2 }, b: { x: 2, y: 2, z: 2 } });
				return false;
			} catch (e) {
				return e instanceof Error && e.message.includes('no open boundaries');
			}
		})()
	);
}

/* ================= Part 4: endpoint whitelist (validateOps) ================= */

function postEvent(modelId: number, body: unknown) {
	return {
		params: { id: String(modelId) },
		request: new Request('http://test/edit', { method: 'POST', body: JSON.stringify(body) }),
		url: new URL(`http://test/api/models/${modelId}/edit`),
		locals: { user: { email: 'meshedit3@test' } }
	} as unknown as Parameters<typeof edit.POST>[0];
}
async function expectError(p: Promise<Response>): Promise<number> {
	try {
		const r = await p;
		return r.status;
	} catch (e) {
		return (e as { status?: number })?.status ?? 0;
	}
}

try {
	const patient = repo.createPatient({ first_name: 'Scratch', last_name: 'MeshEdit3' });
	const scratch = repo.createCase(patient.id, 'meshedit3 scratch');
	const openBox = soup(cubeTris([0, 0, 0], 4, 2, true));
	const rel = join(caseRel(scratch.id), 'model_openbox.stl');
	writeFileSync(resolveData(rel), meshToStlBinary(openBox, 'OpenBox'));
	const row = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color)
			 VALUES (?1, 'OpenBox', 'scan', ?2, '#c8b89a') RETURNING id`
		)
		.get(scratch.id, rel) as { id: number };

	{
		const r = await edit.POST(
			postEvent(row.id, { ops: [{ op: 'partialFill', a: { x: 0, y: 0, z: 4 }, b: { x: 4, y: 0, z: 4 } }] })
		);
		check('endpoint accepts partialFill (preview, +1 triangle)', r.ok && r.headers.get('X-Triangles') === String(openBox.length / 9 + 1), `${r.headers.get('X-Triangles')}`);
	}
	{
		const r = await edit.POST(
			postEvent(row.id, { ops: [{ op: 'remesh', radius: 3, maxEdge: 0.8, iterations: 2 }] })
		);
		const reports = JSON.parse(r.headers.get('X-Reports') ?? '[]');
		check('endpoint accepts remesh maxEdge + iterations', r.ok && reports[0]?.maxEdgeMm === 0.8 && reports[0]?.iterations === 2, JSON.stringify(reports));
	}
	{
		const r = await edit.POST(
			postEvent(row.id, {
				ops: [{ op: 'smooth', points: [{ x: 0, y: 0, z: 4 }, { x: 4, y: 0, z: 4 }], radius: 2 }]
			})
		);
		const reports = JSON.parse(r.headers.get('X-Reports') ?? '[]');
		check('endpoint accepts smooth with points (select area)', r.ok && reports[0]?.centers === 2, JSON.stringify(reports));
	}
	check('partialFill without b → 400', (await expectError(edit.POST(postEvent(row.id, { ops: [{ op: 'partialFill', a: { x: 0, y: 0, z: 4 } }] })))) === 400);
	check('remesh iterations 11 → 400', (await expectError(edit.POST(postEvent(row.id, { ops: [{ op: 'remesh', iterations: 11 }] })))) === 400);
	check('remesh maxEdge ≤ 0 → 400', (await expectError(edit.POST(postEvent(row.id, { ops: [{ op: 'remesh', maxEdge: -1 }] })))) === 400);
	check('smooth with a bad point → 400', (await expectError(edit.POST(postEvent(row.id, { ops: [{ op: 'smooth', points: [{ x: 'nope' }] }] })))) === 400);
	check(
		'smooth with too many centers → 400',
		(await expectError(
			edit.POST(postEvent(row.id, { ops: [{ op: 'smooth', points: Array.from({ length: 501 }, () => ({ x: 0, y: 0, z: 0 })) }] }))
		)) === 400
	);
} catch (e) {
	check(`unexpected error: ${e instanceof Error ? (e.stack ?? e.message) : e}`, false);
} finally {
	db.close();
	rmSync(DATA_DIR, { recursive: true, force: true });
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll meshedit3 checks passed');
