/**
 * Combine/subtract test suite — pure server-side, no dev server needed:
 *   bun scripts/test-meshsubtract.ts   (exit 0 = all pass)
 *
 * Unit checks of the 'combine' op's subtract mode in
 * src/lib/server/meshEdit.ts (approximate CSG difference A − B):
 *   - triangles of A whose centroid lies inside B are removed
 *   - B's triangles inside A are added with flipped winding (socket walls)
 *   - merge mode (the default) keeps the old concatenate behavior
 *   - the sibling transform (inv(selfT)·otherT) is respected
 *   - degenerate ray hits (edge grazes) fall back to the jittered retry
 *   - replay determinism + a performance smoke test on ~200k triangles
 */
import {
	applyMeshEdit,
	applyMeshEditOps,
	type MeshEditContext,
	type MeshEditOp
} from '../src/lib/server/meshEdit';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

/* ================= synthetic meshes ================= */

type V3 = [number, number, number];

/** Axis-aligned cube [o, o+s]^3, each face a sub×sub grid, wound outward. */
function cubeTris(o: V3, s: number, sub = 1): V3[][] {
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
	add([x, y, z + s], [s, 0, 0], [0, s, 0]); // +z
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

function centroidOf(p: Float32Array, t: number): V3 {
	const i = t * 9;
	return [
		(p[i] + p[i + 3] + p[i + 6]) / 3,
		(p[i + 1] + p[i + 4] + p[i + 7]) / 3,
		(p[i + 2] + p[i + 5] + p[i + 8]) / 3
	];
}

function strictlyInsideBox(c: V3, lo: number, hi: number, m = 1e-6): boolean {
	return c.every((v) => v > lo + m && v < hi - m);
}

/** triangle key (vertex coords, order-sensitive) for membership checks */
function triKey(p: Float32Array, t: number): string {
	return Array.from(p.subarray(t * 9, t * 9 + 9)).join(',');
}

/** Combine resolver over an in-memory model map (mirrors the endpoint's ctx). */
function ctxFor(
	models: Record<number, { positions: Float32Array; transform: number[] | null }>,
	selfTransform: number[] | null = null
): MeshEditContext {
	return { selfTransform, loadModel: (id) => models[id] ?? null };
}

const translate = (x: number, y: number, z: number): number[] => [
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1
];

/* ================= geometry under test =================
 * A = [0,4]³ (sub=4, 192 tris), B = [2,6]³ (sub=4, 192 tris), overlap [2,4]³.
 * Analytically: A loses the y,z ∈ (2,4) patches of its +x/+y/+z faces
 * (3 × 2×2 cells × 2 tris = 24), gains B's −x/−y/−z patches inside A
 * (24, inverted), and the result is the closed boundary of [0,4]³ ∖ [2,4]³
 * with volume 64 − 8 = 56. */

const A = soup(cubeTris([0, 0, 0], 4, 4)); // 192 tris
const B = soup(cubeTris([2, 2, 2], 4, 4)); // 192 tris

/* ---- (i)+(ii) subtract: removal, inverted walls, closed result ---- */
{
	const ctx = ctxFor({ 2: { positions: B, transform: null } });
	const res = applyMeshEdit(A, { op: 'combine', modelId: 2, mode: 'subtract' }, ctx);
	check(
		'subtract removes the 24 A-triangles inside B',
		res.report.removedTriangles === 24,
		JSON.stringify(res.report)
	);
	check(
		'subtract adds the 24 B-triangles inside A (socket walls)',
		res.report.addedTriangles === 24 && res.report.mode === 'subtract' && res.report.sourceModel === 2,
		JSON.stringify(res.report)
	);
	const n = res.positions.length / 9;
	check('result triangle count = 192 − 24 + 24', n === 192, `${n}`);

	let insideB = 0;
	for (let t = 0; t < n; t++) {
		if (strictlyInsideBox(centroidOf(res.positions, t), 2, 6)) insideB++;
	}
	check('no surviving centroid lies strictly inside B', insideB === 0, `${insideB}`);

	// the kept prefix must be original A triangles; the added suffix must be
	// inverted B triangles whose normals point toward B's center (= into B,
	// i.e. out of the carved socket) and whose centroids lie inside A
	const aKeys = new Set<string>();
	for (let t = 0; t < 192; t++) aKeys.add(triKey(A, t));
	let keptOk = true;
	for (let t = 0; t < 168; t++) if (!aKeys.has(triKey(res.positions, t))) keptOk = false;
	check('kept triangles are unmodified A triangles', keptOk);

	let flippedOk = true;
	let insideAOk = true;
	for (let t = 168; t < 192; t++) {
		const i = t * 9;
		const p = res.positions;
		const ux = p[i + 3] - p[i];
		const uy = p[i + 4] - p[i + 1];
		const uz = p[i + 5] - p[i + 2];
		const vx = p[i + 6] - p[i];
		const vy = p[i + 7] - p[i + 1];
		const vz = p[i + 8] - p[i + 2];
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		const c = centroidOf(p, t);
		// vector to B's center (4,4,4): an inverted (inward-wound) B facet must face it
		if (nx * (4 - c[0]) + ny * (4 - c[1]) + nz * (4 - c[2]) <= 0) flippedOk = false;
		if (!strictlyInsideBox(c, 0, 4)) insideAOk = false;
	}
	check('added wall triangles are inverted (face into B)', flippedOk);
	check('added wall centroids lie strictly inside A', insideAOk);

	const vol = signedVolume(res.positions);
	check('result is the closed A ∖ B shell (volume 56)', Math.abs(vol - 56) < 1e-3, `${vol}`);
}

/* ---- (iii) merge mode unchanged (default and explicit) ---- */
{
	const ctx = ctxFor({ 2: { positions: B, transform: null } });
	const def = applyMeshEdit(A, { op: 'combine', modelId: 2 }, ctx);
	check(
		'merge (default) concatenates both soups',
		def.positions.length === A.length + B.length && def.report.addedTriangles === 192,
		JSON.stringify(def.report)
	);
	const headOk = A.every((v, i) => def.positions[i] === v);
	const tailOk = B.every((v, i) => def.positions[A.length + i] === v);
	check('merge keeps A then appends (identity-transformed) B byte-identically', headOk && tailOk);
	const exp = applyMeshEdit(A, { op: 'combine', modelId: 2, mode: 'merge' }, ctx);
	check(
		"explicit mode 'merge' is byte-identical to the default",
		exp.positions.length === def.positions.length && exp.positions.every((v, i) => v === def.positions[i])
	);
}

/* ---- (iv) transforms respected: otherT and inv(selfT)·otherT ---- */
{
	// B's geometry at the origin, shifted to [2,6]³ by its stored transform
	const bLocal = soup(cubeTris([0, 0, 0], 4, 4));
	const ctx = ctxFor({ 7: { positions: bLocal, transform: translate(2, 2, 2) } });
	const res = applyMeshEdit(A, { op: 'combine', modelId: 7, mode: 'subtract' }, ctx);
	check(
		'subtract honors the sibling transform (counts match the untransformed run)',
		res.report.removedTriangles === 24 && res.report.addedTriangles === 24,
		JSON.stringify(res.report)
	);
	let coordsOk = true;
	for (let i = 168 * 9; i < res.positions.length; i++) {
		if (res.positions[i] < 2 - 1e-4 || res.positions[i] > 4 + 1e-4) coordsOk = false;
	}
	check('added walls sit at the transformed overlap [2,4]³', coordsOk);
	const vol = signedVolume(res.positions);
	check('transformed subtract still closes at volume 56', Math.abs(vol - 56) < 1e-3, `${vol}`);

	// self transform too: A lives at world +10x, B's transform lands it at the
	// same A-local [2,6]³ → byte-identical result to the untransformed run
	const ctxSelf = ctxFor(
		{ 7: { positions: bLocal, transform: translate(12, 2, 2) } },
		translate(10, 0, 0)
	);
	const res2 = applyMeshEdit(A, { op: 'combine', modelId: 7, mode: 'subtract' }, ctxSelf);
	const plain = applyMeshEdit(
		A,
		{ op: 'combine', modelId: 2, mode: 'subtract' },
		ctxFor({ 2: { positions: B, transform: null } })
	);
	check(
		'inv(selfT)·otherT mapping matches the identity-frame result byte-identically',
		res2.positions.length === plain.positions.length &&
			res2.positions.every((v, i) => v === plain.positions[i]),
		`${res2.positions.length / 9} vs ${plain.positions.length / 9}`
	);
}

/* ---- degenerate ray (exact edge hit) falls back to the jittered retry ---- */
{
	// centroid (4,3,3): its +X parity ray hits B's +x face exactly on the
	// face-diagonal edge y = z → the strict pass flags it, the jittered retry
	// must still classify it as inside. The second triangle is far outside.
	const tricky = soup([
		[[4, 2, 2], [4, 4, 2], [4, 3, 5]],
		[[-10, 0, 0], [-9, 0, 0], [-9.5, 1, 0]]
	]);
	const bigB = soup(cubeTris([2, 2, 2], 4, 1));
	const ctx = ctxFor({ 3: { positions: bigB, transform: null } });
	const res = applyMeshEdit(tricky, { op: 'combine', modelId: 3, mode: 'subtract' }, ctx);
	check(
		'edge-grazing centroid is classified inside via the jittered retry',
		res.report.removedTriangles === 1 && res.report.addedTriangles === 0,
		JSON.stringify(res.report)
	);
	check('the far triangle survives', res.positions.length === 9 && res.positions[0] === -10);
}

/* ---- subtract that consumes everything throws (empty-mesh guard) ---- */
{
	const tiny = soup(cubeTris([1, 1, 1], 1, 1));
	const huge = soup(cubeTris([0, 0, 0], 4, 1));
	const ctx = ctxFor({ 4: { positions: huge, transform: null } });
	let threw = '';
	try {
		applyMeshEdit(tiny, { op: 'combine', modelId: 4, mode: 'subtract' }, ctx);
	} catch (e) {
		threw = e instanceof Error ? e.message : String(e);
	}
	check('subtracting an engulfing shell throws instead of emptying', /entire mesh/.test(threw), threw);
}

/* ---- replay determinism through applyMeshEditOps ---- */
{
	const ctx = ctxFor({ 2: { positions: B, transform: null } });
	const ops: MeshEditOp[] = [{ op: 'combine', modelId: 2, mode: 'subtract' }];
	const r1 = applyMeshEditOps(A, ops, ctx);
	const r2 = applyMeshEditOps(A, ops, ctx);
	check(
		'subtract replay is deterministic (byte-identical output)',
		r1.positions.length === r2.positions.length && r1.positions.every((v, i) => v === r2.positions[i]),
		`${r1.positions.length} vs ${r2.positions.length}`
	);
	check('replay reports the subtract entry', r1.reports[0]?.mode === 'subtract');
}

/* ---- performance smoke: ~120k − 77k tris must stay well under 5 s ---- */
{
	const bigA = soup(cubeTris([0, 0, 0], 40, 100)); // 120 000 tris
	const bigB = soup(cubeTris([20, 20, 20], 40, 80)); // 76 800 tris, overlap [20,40]³
	const ctx = ctxFor({ 9: { positions: bigB, transform: null } });
	const t0 = performance.now();
	const res = applyMeshEdit(bigA, { op: 'combine', modelId: 9, mode: 'subtract' }, ctx);
	const ms = performance.now() - t0;
	const removed = Number(res.report.removedTriangles);
	const added = Number(res.report.addedTriangles);
	check(
		'large subtract removes/adds plausible counts',
		removed > 1000 && added > 1000 && res.positions.length / 9 === 120000 - removed + added,
		JSON.stringify(res.report)
	);
	const vol = signedVolume(res.positions);
	check('large subtract closes at volume 64000 − 8000', Math.abs(vol - 56000) < 1, `${vol}`);
	check(`large subtract finishes in < 5 s (${ms.toFixed(0)} ms)`, ms < 5000, `${ms.toFixed(0)} ms`);
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll meshsubtract checks passed');
