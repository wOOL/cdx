/**
 * AI tooth-operations test suite — pure server-side, no dev server needed:
 *   bun scripts/test-toothops.ts   (exit 0 = all pass)
 *
 * Covers $lib/server/toothOps:
 *  - planRenumber: contiguous-run shifting within an arch (incl. the video's
 *    24→23 example with 23..17 present and midline crossing), collision /
 *    off-arch rejections, opposite-arch single relabel, input validation,
 *  - renameToothModel: vendor-pattern preservation, cross-checked against
 *    classifyAiModel,
 *  - extractToothMesh: the three extraction modes against analytic cube
 *    geometry (triangle counts, hole counts, signed volume, transforms).
 */
import {
	extractToothMesh,
	planRenumber,
	renameToothModel,
	type RenumberChange
} from '../src/lib/server/toothOps';
import { listHoles, type MeshEditContext } from '../src/lib/server/meshEdit';
import { classifyAiModel } from '../src/lib/aiReviewMap';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}

/* ================= synthetic meshes (same builder as test-meshsubtract) ================= */

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

/** triangle key (vertex coords, order-sensitive) for membership checks */
function triKey(p: Float32Array, t: number): string {
	return Array.from(p.subarray(t * 9, t * 9 + 9)).join(',');
}

function ctxFor(
	models: Record<number, { positions: Float32Array; transform: number[] | null }>,
	selfTransform: number[] | null = null
): MeshEditContext {
	return { selfTransform, loadModel: (id) => models[id] ?? null };
}

const translate = (x: number, y: number, z: number): number[] => [
	1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1
];

function changeMap(changes: RenumberChange[]): Map<number, number> {
	return new Map(changes.map((c) => [c.oldFdi, c.newFdi]));
}

/* ================= geometry under test =================
 * Scan = cube [0,4]³ (sub=4, faces of 16 cells) WITHOUT its -z face → 160
 * tris, one natural opening of 16 boundary edges (an "intraoral scan").
 * Tooth = cube [1,3]×[1,3]×[3,5] (sub=2, 48 tris) poking through the +z face.
 * Analytically: 8 scan triangles (the 2×2-cell patch x,y ∈ (1,3) of the +z
 * face) lie inside the tooth; 24 tooth triangles lie inside the scan (its -z
 * face, 8, plus the lower z∈[3,4] row of all four side faces, 4×4). The cut
 * rim is one 8-edge loop, scan ∩ tooth = 2×2×1 = 4 mm³. */

const allScanTris = cubeTris([0, 0, 0], 4, 4); // faces in order +z, -z, +x, -x, +y, -y
const scanOpen = soup([...allScanTris.slice(0, 32), ...allScanTris.slice(64)]); // drop -z → 160 tris
const scanClosed = soup(allScanTris); // 192 tris
const tooth = soup(cubeTris([1, 1, 3], 2, 2)); // 48 tris

console.log('--- extraction: cut ---');
{
	const res = extractToothMesh(scanOpen, 5, 'cut', ctxFor({ 5: { positions: tooth, transform: null } }));
	check('cut removes the 8 scan triangles inside the tooth', res.removedTriangles === 8, `${res.removedTriangles}`);
	check('cut adds nothing', res.addedTriangles === 0, `${res.addedTriangles}`);
	check('cut result has 160 − 8 triangles', res.positions.length / 9 === 152, `${res.positions.length / 9}`);

	const scanKeys = new Set<string>();
	for (let t = 0; t < scanOpen.length / 9; t++) scanKeys.add(triKey(scanOpen, t));
	let allFromScan = true;
	for (let t = 0; t < res.positions.length / 9; t++) {
		if (!scanKeys.has(triKey(res.positions, t))) allFromScan = false;
	}
	check('every cut triangle is an unmodified scan triangle', allFromScan);

	const { holes, openEdges } = listHoles(res.positions);
	check('cut leaves 2 open boundaries (natural rim + cut rim)', holes.length === 2, `${holes.length}`);
	check(
		'natural opening (16 edges) is the largest, cut rim has 8 edges',
		holes[0]?.edges === 16 && holes[1]?.edges === 8,
		holes.map((h) => h.edges).join('/')
	);
	check('open edges total 24', openEdges === 24, `${openEdges}`);
}

console.log('--- extraction: cut-close ---');
{
	const res = extractToothMesh(scanOpen, 5, 'cut-close', ctxFor({ 5: { positions: tooth, transform: null } }));
	check('cut-close removes the same 8 triangles', res.removedTriangles === 8, `${res.removedTriangles}`);
	check('cut-close closes exactly the cut opening', res.holesFilled === 1, `${res.holesFilled}`);
	check('cut-close adds the 8-triangle centroid fan', res.addedTriangles === 8, `${res.addedTriangles}`);
	check('cut-close result has 152 + 8 triangles', res.positions.length / 9 === 160, `${res.positions.length / 9}`);
	const { holes } = listHoles(res.positions);
	check(
		'the scan\'s natural (largest) opening stays untouched',
		holes.length === 1 && holes[0].edges === 16,
		holes.map((h) => h.edges).join('/')
	);
}

console.log('--- extraction: alveolus ---');
{
	const res = extractToothMesh(scanClosed, 5, 'alveolus', ctxFor({ 5: { positions: tooth, transform: null } }));
	check('alveolus removes the 8 scan triangles inside the tooth', res.removedTriangles === 8, `${res.removedTriangles}`);
	check('alveolus adds the 24 socket-wall triangles', res.addedTriangles === 24, `${res.addedTriangles}`);
	check('alveolus result has 192 − 8 + 24 triangles', res.positions.length / 9 === 208, `${res.positions.length / 9}`);
	const { holes, openEdges } = listHoles(res.positions);
	check('alveolus result is watertight (socket walls close the cut)', holes.length === 0 && openEdges === 0, `${holes.length} holes, ${openEdges} open edges`);
	const vol = signedVolume(res.positions);
	check('alveolus volume = 64 − 4 (the socket is carved out)', Math.abs(vol - 60) < 1e-3, `${vol}`);
}

console.log('--- extraction: transforms ---');
{
	// tooth geometry stored at the origin, placed at [1,3]²×[3,5] by its transform
	const toothLocal = soup(cubeTris([0, 0, 0], 2, 2));
	const a = extractToothMesh(scanClosed, 7, 'alveolus', ctxFor({ 7: { positions: toothLocal, transform: translate(1, 1, 3) } }));
	check('tooth transform is honored (same counts as the untransformed run)', a.removedTriangles === 8 && a.addedTriangles === 24, `${a.removedTriangles}/${a.addedTriangles}`);

	// scan transform too: both shells shifted +10x in world → identical scan-local result
	const plain = extractToothMesh(scanOpen, 5, 'cut', ctxFor({ 5: { positions: tooth, transform: null } }));
	const moved = extractToothMesh(
		scanOpen,
		7,
		'cut',
		ctxFor({ 7: { positions: toothLocal, transform: translate(11, 1, 3) } }, translate(10, 0, 0))
	);
	check(
		'inv(scanT)·toothT mapping matches the identity-frame cut byte-identically',
		moved.positions.length === plain.positions.length &&
			moved.positions.every((v, i) => v === plain.positions[i]),
		`${moved.positions.length / 9} vs ${plain.positions.length / 9}`
	);
}

console.log('--- extraction: degenerate input ---');
{
	// a tooth that engulfs the scan consumes everything → must throw, not return junk
	const tinyScan = soup(cubeTris([1.5, 1.5, 1.5], 1, 1));
	const hugeTooth = soup(cubeTris([0, 0, 0], 4, 1));
	let threw = '';
	try {
		extractToothMesh(tinyScan, 5, 'cut', ctxFor({ 5: { positions: hugeTooth, transform: null } }));
	} catch (e) {
		threw = e instanceof Error ? e.message : String(e);
	}
	check('engulfing tooth throws instead of emptying the scan', threw.length > 0, threw);

	// non-intersecting tooth → a no-op cut (the endpoint turns this into a 400)
	const farTooth = soup(cubeTris([20, 20, 20], 2, 1));
	const noop = extractToothMesh(scanOpen, 5, 'cut', ctxFor({ 5: { positions: farTooth, transform: null } }));
	check(
		'non-intersecting tooth removes nothing',
		noop.removedTriangles === 0 && noop.positions.length === scanOpen.length,
		`${noop.removedTriangles}`
	);
}

console.log('--- renumber: contiguous-run shift (the video example) ---');
{
	// teeth 17..23 (chart-contiguous across the midline) + 24 exist; 24 → 23
	const existing = [17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24];
	const p = planRenumber(existing, 24, 23);
	check('24→23 with 23..17 present is allowed', p.ok);
	if (p.ok) {
		const map = changeMap(p.changes);
		check('the whole 11-tooth run shifts', p.changes.length === 11, `${p.changes.length}`);
		check('clicked tooth 24 → 23', map.get(24) === 23);
		check('neighbor 23 → 22', map.get(23) === 22);
		check('midline crossing 21 → 11', map.get(21) === 11);
		check('midline crossing 11 → 12', map.get(11) === 12);
		check('run end 17 → 18', map.get(17) === 18);
	}
}

console.log('--- renumber: runs, gaps and collisions ---');
{
	const single = planRenumber([24], 24, 23);
	check('lone tooth renumbers alone', single.ok && single.changes.length === 1 && single.changes[0].newFdi === 23);

	const gap = planRenumber([24, 23, 21], 24, 23);
	check('a gap (22 missing) ends the run — 21 stays', gap.ok && gap.changes.length === 2);
	if (gap.ok) {
		const map = changeMap(gap.changes);
		check('gap run shifts 24→23 and 23→22', map.get(24) === 23 && map.get(23) === 22 && !map.has(21));
	}

	const multi = planRenumber([24, 25, 26], 24, 26);
	check('delta 2 shifts the whole run by 2', multi.ok && multi.changes.length === 3);
	if (multi.ok) {
		const map = changeMap(multi.changes);
		check('24→26, 25→27, 26→28', map.get(24) === 26 && map.get(25) === 27 && map.get(26) === 28);
	}

	const cross = planRenumber([11, 21], 21, 11);
	check('midline shift moves both central incisors', cross.ok && cross.changes.length === 2);
	if (cross.ok) {
		const map = changeMap(cross.changes);
		check('21→11 pushes 11→12', map.get(21) === 11 && map.get(11) === 12);
	}

	const collide = planRenumber([24, 22], 24, 22);
	check('collision with a tooth outside the run is rejected (409)', !collide.ok && collide.status === 409, collide.ok ? '' : collide.error);

	const offArch = planRenumber([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], 24, 25);
	check('shift off the arch end is rejected (409)', !offArch.ok && offArch.status === 409, offArch.ok ? '' : offArch.error);
}

console.log('--- renumber: opposite arch + validation ---');
{
	const opp = planRenumber([24, 35], 24, 34);
	check('opposite-arch target relabels only the clicked tooth', opp.ok && opp.changes.length === 1 && opp.changes[0].oldFdi === 24 && opp.changes[0].newFdi === 34);

	const oppTaken = planRenumber([24, 34], 24, 34);
	check('opposite-arch collision is rejected (409)', !oppTaken.ok && oppTaken.status === 409, oppTaken.ok ? '' : oppTaken.error);

	const same = planRenumber([24], 24, 24);
	check('renumbering to the same number is rejected (400)', !same.ok && same.status === 400);

	const invalid = planRenumber([24], 24, 49);
	check('invalid FDI 49 is rejected (400)', !invalid.ok && invalid.status === 400);

	const invalid2 = planRenumber([24], 24, 19);
	check('invalid FDI 19 is rejected (400)', !invalid2.ok && invalid2.status === 400);
}

console.log('--- renumber: model renaming keeps classifyAiModel resolving ---');
{
	check("'AI — Tooth 24' → 'AI — Tooth 23'", renameToothModel('AI — Tooth 24', 23) === 'AI — Tooth 23', renameToothModel('AI — Tooth 24', 23));
	check("parenthesized 'Tooth (24) copy' keeps its shape", renameToothModel('Tooth (24) copy', 18) === 'Tooth (18) copy', renameToothModel('Tooth (24) copy', 18));
	check('pattern-free names fall back to the vendor pattern', renameToothModel('Molar segment', 36) === 'AI — Tooth 36', renameToothModel('Molar segment', 36));

	const fromName = classifyAiModel(renameToothModel('AI — Tooth 24', 23));
	check('renamed row resolves by name alone', fromName.kind === 'tooth' && fromName.fdi === 23);
	const fromParams = classifyAiModel('AI — Tooth 23', { class: 'tooth_23', fdi: 23 });
	check("updated params { class: 'tooth_23', fdi } resolve too", fromParams.kind === 'tooth' && fromParams.fdi === 23 && fromParams.arch === 'upper');
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nAll toothops checks passed');
