/**
 * IOS tooth-segmentation tests.
 *
 *   Unit (always runs, NO network):
 *     - decodeIosGlb on a hand-built 3-vertex GLB with known COLOR_0 colors,
 *       asserting the decoded label indices (incl. an unmatched → -1 case).
 *     - labelToFdi spot checks.
 *
 *   Live (guarded): if CDX_AISEG_EMAIL/PASSWORD resolve (demo creds fallback)
 *   AND dwos_guide/ios_test.obj exists, calls runIosSeg and prints
 *   vertexCount / presentFdis / gingivaCount.
 *
 *   bun run scripts/test-ios-seg.ts
 *   CDX_AISEG_EMAIL=demo@becertain.ai CDX_AISEG_PASSWORD='DemoPass123!' bun run scripts/test-ios-seg.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	decodeIosGlb,
	labelToFdi,
	runIosSeg,
	IOS_COLOR_LEGEND,
	FDI_TOOTH_NUMBER_CLASSES
} from '../src/lib/server/iosSeg';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// Build a minimal GLB with N vertices: POSITION (VEC3 float) + COLOR_0
// (VEC4 uint8) in one BIN chunk, two bufferViews, two accessors.
// ---------------------------------------------------------------------------

function buildGlb(colors: [number, number, number][]): Uint8Array {
	const n = colors.length;
	// BIN: positions (n*3 float = 12n bytes), then colors (n*4 uint8 = 4n bytes).
	const posLen = n * 3 * 4;
	const colLen = n * 4;
	// 4-byte align the color view start within BIN.
	const colStart = (posLen + 3) & ~3;
	const binLen = colStart + colLen;
	const bin = new Uint8Array((binLen + 3) & ~3); // pad BIN to 4 bytes
	const binDv = new DataView(bin.buffer);
	for (let i = 0; i < n; i++) {
		binDv.setFloat32(i * 12 + 0, i, true);
		binDv.setFloat32(i * 12 + 4, 0, true);
		binDv.setFloat32(i * 12 + 8, 0, true);
	}
	for (let i = 0; i < n; i++) {
		const [r, g, b] = colors[i];
		bin[colStart + i * 4 + 0] = r;
		bin[colStart + i * 4 + 1] = g;
		bin[colStart + i * 4 + 2] = b;
		bin[colStart + i * 4 + 3] = 255;
	}

	const gltf = {
		asset: { version: '2.0' },
		buffers: [{ byteLength: bin.byteLength }],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: posLen },
			{ buffer: 0, byteOffset: colStart, byteLength: colLen }
		],
		accessors: [
			{ bufferView: 0, byteOffset: 0, componentType: 5126, count: n, type: 'VEC3' },
			{ bufferView: 1, byteOffset: 0, componentType: 5121, normalized: true, count: n, type: 'VEC4' }
		],
		meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }]
	};

	let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
	// pad JSON chunk to 4 bytes with spaces (0x20)
	const jsonPad = (4 - (jsonBytes.length & 3)) & 3;
	if (jsonPad) {
		const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
		padded.set(jsonBytes, 0);
		jsonBytes = padded;
	}

	const total = 12 + 8 + jsonBytes.length + 8 + bin.byteLength;
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true); // 'glTF'
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	let off = 12;
	dv.setUint32(off, jsonBytes.length, true);
	dv.setUint32(off + 4, 0x4e4f534a, true); // 'JSON'
	out.set(jsonBytes, off + 8);
	off += 8 + jsonBytes.length;
	dv.setUint32(off, bin.byteLength, true);
	dv.setUint32(off + 4, 0x004e4942, true); // 'BIN\0'
	out.set(bin, off + 8);
	return out;
}

// ---- decodeIosGlb -----------------------------------------------------------

{
	// vertex 0 = gingiva (label 0), vertex 1 = label 5 ([188,189,34]),
	// vertex 2 = an off-by-one color → no exact match → -1.
	const c0 = IOS_COLOR_LEGEND[0]; // [255,255,255,255]
	const c5 = IOS_COLOR_LEGEND[5]; // [188,189,34,255]
	const colors: [number, number, number][] = [
		[c0[0], c0[1], c0[2]],
		[c5[0], c5[1], c5[2]],
		[c5[0] + 1, c5[1], c5[2]] // not in legend → -1
	];
	const glb = buildGlb(colors);
	const { perVertexLabel, vertexCount } = decodeIosGlb(glb);
	check('decodeIosGlb: vertexCount === 3', vertexCount === 3, `${vertexCount}`);
	check('decodeIosGlb: vertex 0 → label 0 (gingiva)', perVertexLabel[0] === 0, `${perVertexLabel[0]}`);
	check('decodeIosGlb: vertex 1 → label 5', perVertexLabel[1] === 5, `${perVertexLabel[1]}`);
	check('decodeIosGlb: vertex 2 (no match) → -1', perVertexLabel[2] === -1, `${perVertexLabel[2]}`);
}

// ---- labelToFdi -------------------------------------------------------------

{
	check('labelToFdi: 0 (gingiva) → null', labelToFdi(0) === null);
	check('labelToFdi: 1 → 18', labelToFdi(1) === '18', `${labelToFdi(1)}`);
	check('labelToFdi: 8 → 11', labelToFdi(8) === '11', `${labelToFdi(8)}`);
	check('labelToFdi: 9 → 21', labelToFdi(9) === '21', `${labelToFdi(9)}`);
	check('labelToFdi: 32 → 48', labelToFdi(32) === '48', `${labelToFdi(32)}`);
	check('labelToFdi: 33 (other) → null', labelToFdi(33) === null);
	check('labelToFdi: -1 → null', labelToFdi(-1) === null);
	check('labelToFdi: 32 FDI classes', FDI_TOOTH_NUMBER_CLASSES.length === 32);
}

// ---- live call (guarded) ----------------------------------------------------

async function live(): Promise<void> {
	const objPath = join(import.meta.dir, '..', 'dwos_guide', 'ios_test.obj');
	if (!existsSync(objPath)) {
		console.log('SKIP  live: dwos_guide/ios_test.obj not found');
		return;
	}
	// Fall back to demo creds so the live part is runnable without env setup.
	if (!process.env.CDX_AISEG_EMAIL) process.env.CDX_AISEG_EMAIL = 'demo@becertain.ai';
	if (!process.env.CDX_AISEG_PASSWORD) process.env.CDX_AISEG_PASSWORD = 'DemoPass123!';

	console.log(`\nLIVE  POST ios_seg_inference for ${objPath} ...`);
	try {
		const bytes = readFileSync(objPath);
		const r = await runIosSeg(bytes, 'input.obj');
		console.log(`LIVE  vertexCount   = ${r.vertexCount}`);
		console.log(`LIVE  gingivaCount  = ${r.gingivaCount}`);
		console.log(`LIVE  presentLabels = [${r.presentLabels.join(', ')}]`);
		console.log(`LIVE  presentFdis   = [${r.presentFdis.join(', ')}] (${r.presentFdis.length} teeth)`);
	} catch (e) {
		console.log(`SKIP  live call errored (network/auth?): ${e instanceof Error ? e.message : String(e)}`);
	}
}

await live();

if (failures > 0) {
	console.error(`\n${failures} unit check(s) failed`);
	process.exit(1);
}
console.log('\nAll unit checks passed');
