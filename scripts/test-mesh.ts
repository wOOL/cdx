/**
 * Mesh pipeline smoke test: marching cubes on a synthetic sphere,
 * STL round-trip, and ASCII STL/PLY parsing.
 *   bun run scripts/test-mesh.ts
 */
import { marchingCubes } from '../src/lib/server/marchingCubes';
import { meshToStlBinary, parseStl, parsePly } from '../src/lib/server/stl';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- build a 64^3 sphere volume ----
const N = 64;
const RADIUS_VOX = 20;
const SPACING: [number, number, number] = [0.5, 0.5, 0.5];
const CENTER_VOX = 32;
const data = new Uint8Array(N * N * N);
for (let z = 0; z < N; z++) {
	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const dx = x - CENTER_VOX;
			const dy = y - CENTER_VOX;
			const dz = z - CENTER_VOX;
			if (dx * dx + dy * dy + dz * dz <= RADIUS_VOX * RADIUS_VOX) {
				data[z * N * N + y * N + x] = 200;
			}
		}
	}
}

const { positions, normals } = marchingCubes(data, [N, N, N], SPACING, 100);

// ---- triangle count ----
const triCount = positions.length / 9;
check('triangle count > 1000', positions.length % 9 === 0 && triCount > 1000, `${triCount} triangles`);
check('normals length matches positions', normals.length === positions.length);

// ---- vertices on the analytic sphere surface (10mm +/- 0.6) ----
const RADIUS_MM = RADIUS_VOX * SPACING[0];
const center = [CENTER_VOX * SPACING[0], CENTER_VOX * SPACING[1], CENTER_VOX * SPACING[2]];
let maxErr = 0;
let offSurface = 0;
const vertCount = positions.length / 3;
for (let i = 0; i < positions.length; i += 3) {
	const r = Math.hypot(
		positions[i] - center[0],
		positions[i + 1] - center[1],
		positions[i + 2] - center[2]
	);
	const err = Math.abs(r - RADIUS_MM);
	if (err > maxErr) maxErr = err;
	if (err > 0.6) offSurface++;
}
check(
	'all vertices within 0.6mm of sphere surface',
	vertCount > 0 && offSurface === 0,
	`max error ${maxErr.toFixed(3)}mm, ${offSurface}/${vertCount} outside tolerance`
);

// ---- normals point outward ----
let outward = 0;
let unitOk = 0;
for (let i = 0; i < positions.length; i += 3) {
	const dot =
		normals[i] * (positions[i] - center[0]) +
		normals[i + 1] * (positions[i + 1] - center[1]) +
		normals[i + 2] * (positions[i + 2] - center[2]);
	if (dot > 0) outward++;
	const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
	if (Math.abs(len - 1) < 1e-3) unitOk++;
}
const outwardFrac = outward / vertCount;
check(
	'normals point outward for >99% of vertices',
	outwardFrac > 0.99,
	`${(outwardFrac * 100).toFixed(2)}% outward`
);
check('normals are unit length', unitOk === vertCount, `${unitOk}/${vertCount} unit`);

// ---- STL binary round-trip ----
const stlBytes = meshToStlBinary(positions, 'sphere');
const roundTrip = parseStl(stlBytes);
check(
	'binary STL round-trip triangle count matches',
	roundTrip !== null && roundTrip.positions.length === positions.length,
	roundTrip ? `${roundTrip.positions.length / 9} triangles` : 'parse returned null'
);
if (roundTrip) {
	let maxDelta = 0;
	for (let i = 0; i < positions.length; i++) {
		const d = Math.abs(roundTrip.positions[i] - positions[i]);
		if (d > maxDelta) maxDelta = d;
	}
	check('binary STL round-trip vertices identical', maxDelta === 0, `max delta ${maxDelta}`);
}

// ---- ASCII STL parsing ----
const asciiStl = [
	'solid tiny',
	'  facet normal 0 0 1',
	'    outer loop',
	'      vertex 0 0 0',
	'      vertex 1 0 0',
	'      vertex 0 1 0',
	'    endloop',
	'  endfacet',
	'  facet normal 0 0 1',
	'    outer loop',
	'      vertex 1 0 0',
	'      vertex 1 1 0',
	'      vertex 0 1 0',
	'    endloop',
	'  endfacet',
	'endsolid tiny',
	''
].join('\n');
const asciiParsed = parseStl(new TextEncoder().encode(asciiStl));
const asciiOk =
	asciiParsed !== null &&
	asciiParsed.positions.length === 18 &&
	asciiParsed.positions[3] === 1 &&
	asciiParsed.positions[7] === 1;
check(
	'ASCII STL parses (2 triangles)',
	asciiOk,
	asciiParsed ? `${asciiParsed.positions.length / 9} triangles` : 'parse returned null'
);

// ---- ASCII PLY parsing (quad fan-triangulated to 2 triangles) ----
const asciiPly = [
	'ply',
	'format ascii 1.0',
	'comment tiny test quad',
	'element vertex 4',
	'property float x',
	'property float y',
	'property float z',
	'property uchar red',
	'element face 1',
	'property list uchar int vertex_indices',
	'end_header',
	'0 0 0 255',
	'2 0 0 255',
	'2 2 0 255',
	'0 2 0 255',
	'4 0 1 2 3',
	''
].join('\n');
const plyParsed = parsePly(new TextEncoder().encode(asciiPly));
const plyOk =
	plyParsed !== null &&
	plyParsed.positions.length === 18 &&
	// fan: (0,1,2) and (0,2,3)
	plyParsed.positions[3] === 2 &&
	plyParsed.positions[9] === 0 &&
	plyParsed.positions[12] === 2 &&
	plyParsed.positions[16] === 2;
check(
	'ASCII PLY parses (quad -> 2 triangles)',
	plyOk,
	plyParsed ? `${plyParsed.positions.length / 9} triangles` : 'parse returned null'
);

// ---- non-mesh bytes rejected ----
check(
	'parseStl/parsePly reject garbage',
	parseStl(new TextEncoder().encode('hello world, not a mesh')) === null &&
		parsePly(new TextEncoder().encode('hello world, not a mesh')) === null
);

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks passed');
