/**
 * Generates a synthetic CBCT mandible phantom as a DICOM series (explicit VR little endian)
 * for end-to-end testing of the import pipeline and viewers.
 *
 *   bun run scripts/make-synthetic-dicom.ts
 *
 * Output: testdata/synthetic-cbct/slice_###.dcm + testdata/synthetic-cbct.zip
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';

// usage: bun run scripts/make-synthetic-dicom.ts [cols rows slices spacing outdir]
const argv = process.argv.slice(2);
const COLS = Number(argv[0]) || 256;
const ROWS = Number(argv[1]) || 256;
const SLICES = Number(argv[2]) || 160;
const SPACING = Number(argv[3]) || 0.4; // mm, isotropic
const OUT_DIR = argv[4] || 'testdata/synthetic-cbct';

// ---------------- DICOM writer (explicit VR LE) ----------------

const enc = new TextEncoder();

function padEven(s: string, padChar: string): string {
	return s.length % 2 === 0 ? s : s + padChar;
}

function strEl(group: number, elem: number, vr: string, value: string): Uint8Array {
	const v = enc.encode(padEven(value, vr === 'UI' ? '\0' : ' '));
	const out = new Uint8Array(8 + v.length);
	const dv = new DataView(out.buffer);
	dv.setUint16(0, group, true);
	dv.setUint16(2, elem, true);
	out[4] = vr.charCodeAt(0);
	out[5] = vr.charCodeAt(1);
	dv.setUint16(6, v.length, true);
	out.set(v, 8);
	return out;
}

function usEl(group: number, elem: number, value: number): Uint8Array {
	const out = new Uint8Array(10);
	const dv = new DataView(out.buffer);
	dv.setUint16(0, group, true);
	dv.setUint16(2, elem, true);
	out[4] = 0x55; // U
	out[5] = 0x53; // S
	dv.setUint16(6, 2, true);
	dv.setUint16(8, value, true);
	return out;
}

function ulEl(group: number, elem: number, value: number): Uint8Array {
	const out = new Uint8Array(12);
	const dv = new DataView(out.buffer);
	dv.setUint16(0, group, true);
	dv.setUint16(2, elem, true);
	out[4] = 0x55; // U
	out[5] = 0x4c; // L
	dv.setUint16(6, 4, true);
	dv.setUint32(8, value, true);
	return out;
}

function bigEl(group: number, elem: number, vr: string, value: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + value.length);
	const dv = new DataView(out.buffer);
	dv.setUint16(0, group, true);
	dv.setUint16(2, elem, true);
	out[4] = vr.charCodeAt(0);
	out[5] = vr.charCodeAt(1);
	dv.setUint16(6, 0, true); // reserved
	dv.setUint32(8, value.length, true);
	out.set(value, 12);
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((a, p) => a + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

const UID_ROOT = '1.2.826.0.1.3680043.9.7433'; // arbitrary org root for the phantom
const STUDY_UID = `${UID_ROOT}.1.1`;
const SERIES_UID = `${UID_ROOT}.1.2`;
const CT_SOP_CLASS = '1.2.840.10008.5.1.4.1.1.2';

function dicomFile(sliceIndex: number, pixels: Int16Array): Uint8Array {
	const sopUid = `${UID_ROOT}.1.3.${sliceIndex + 1}`;
	const zPos = (sliceIndex * SPACING).toFixed(2);

	const meta = concat([
		bigEl(0x0002, 0x0001, 'OB', new Uint8Array([0, 1])),
		strEl(0x0002, 0x0002, 'UI', CT_SOP_CLASS),
		strEl(0x0002, 0x0003, 'UI', sopUid),
		strEl(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
		strEl(0x0002, 0x0012, 'UI', `${UID_ROOT}.0.1`)
	]);

	const pixelBytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
	const dataset = concat([
		strEl(0x0008, 0x0016, 'UI', CT_SOP_CLASS),
		strEl(0x0008, 0x0018, 'UI', sopUid),
		strEl(0x0008, 0x0020, 'DA', '20260611'),
		strEl(0x0008, 0x0060, 'CS', 'CT'),
		strEl(0x0008, 0x103e, 'LO', 'Synthetic CBCT mandible phantom'),
		strEl(0x0010, 0x0010, 'PN', 'Phantom^Synthetic'),
		strEl(0x0010, 0x0020, 'LO', 'SYN-001'),
		strEl(0x0018, 0x0050, 'DS', String(SPACING)),
		strEl(0x0018, 0x0088, 'DS', String(SPACING)),
		strEl(0x0020, 0x000d, 'UI', STUDY_UID),
		strEl(0x0020, 0x000e, 'UI', SERIES_UID),
		strEl(0x0020, 0x0013, 'IS', String(sliceIndex + 1)),
		strEl(0x0020, 0x0032, 'DS', `${(-COLS * SPACING) / 2}\\${(-ROWS * SPACING) / 2}\\${zPos}`),
		strEl(0x0020, 0x0037, 'DS', '1\\0\\0\\0\\1\\0'),
		usEl(0x0028, 0x0002, 1),
		strEl(0x0028, 0x0004, 'CS', 'MONOCHROME2'),
		usEl(0x0028, 0x0010, ROWS),
		usEl(0x0028, 0x0011, COLS),
		strEl(0x0028, 0x0030, 'DS', `${SPACING}\\${SPACING}`),
		usEl(0x0028, 0x0100, 16),
		usEl(0x0028, 0x0101, 16),
		usEl(0x0028, 0x0102, 15),
		usEl(0x0028, 0x0103, 1),
		strEl(0x0028, 0x1050, 'DS', '400'),
		strEl(0x0028, 0x1051, 'DS', '1800'),
		strEl(0x0028, 0x1052, 'DS', '0'),
		strEl(0x0028, 0x1053, 'DS', '1'),
		bigEl(0x7fe0, 0x0010, 'OW', pixelBytes)
	]);

	const preamble = new Uint8Array(132);
	preamble.set(enc.encode('DICM'), 128);
	return concat([preamble, ulEl(0x0002, 0x0000, meta.length), meta, dataset]);
}

// ---------------- phantom geometry ----------------
// Coordinates: x,y in mm centered on volume; z = slice * SPACING (0..64mm).

interface Pt {
	x: number;
	y: number;
	t: number;
}

// mandibular arch centerline (horseshoe opening posteriorly), t in [-1, 1]
function archPoint(t: number): { x: number; y: number } {
	const a = t * 1.25; // rad
	return { x: 42 * Math.sin(a), y: 30 * Math.cos(a) - 6 };
}

const ARCH: Pt[] = [];
for (let i = 0; i <= 128; i++) {
	const t = -1 + (2 * i) / 128;
	const p = archPoint(t);
	ARCH.push({ x: p.x, y: p.y, t });
}

// teeth along the arch: 14 positions, two gaps (idx 3 ~ tooth 36 region, idx 10 ~ tooth 46 region)
const TOOTH_T: number[] = [];
for (let i = 0; i < 14; i++) {
	TOOTH_T.push(-0.88 + (1.76 * i) / 13);
}
const MISSING = new Set([3, 10]);
const TEETH = TOOTH_T.map((t, i) => ({ ...archPoint(t), missing: MISSING.has(i) }));

// Precompute, per pixel: distance to arch (2D), nearest t, distance to nearest tooth.
const distArch = new Float32Array(COLS * ROWS);
const nearT = new Float32Array(COLS * ROWS);
const distTooth = new Float32Array(COLS * ROWS).fill(1e9);

for (let r = 0; r < ROWS; r++) {
	const y = (r - ROWS / 2 + 0.5) * SPACING;
	for (let cI = 0; cI < COLS; cI++) {
		const x = (cI - COLS / 2 + 0.5) * SPACING;
		const idx = r * COLS + cI;
		let best = 1e9;
		let bt = 0;
		for (const p of ARCH) {
			const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
			if (d < best) {
				best = d;
				bt = p.t;
			}
		}
		distArch[idx] = Math.sqrt(best);
		nearT[idx] = bt;
		let dtBest = 1e9;
		for (const tooth of TEETH) {
			if (tooth.missing) continue;
			const d = Math.hypot(tooth.x - x, tooth.y - y);
			if (d < dtBest) dtBest = d;
		}
		distTooth[idx] = dtBest;
	}
}

// soft-tissue boundary ellipse
function inSoft(x: number, y: number): boolean {
	const dx = x / 47;
	const dy = (y - 2) / 42;
	return dx * dx + dy * dy < 1;
}

function huAt(cI: number, r: number, z: number): number {
	const x = (cI - COLS / 2 + 0.5) * SPACING;
	const y = (r - ROWS / 2 + 0.5) * SPACING;
	const idx = r * COLS + cI;
	const d = distArch[idx];
	const t = nearT[idx];

	if (z < 3 || z > 61 || !inSoft(x, y)) return -1000;

	let hu = 40; // soft tissue

	// mandible body: z 8..36, ridge narrows toward crest
	const crest = 36;
	const bottom = 8;
	if (z >= bottom && z <= crest) {
		const halfWidth = z > 30 ? 5.5 - (z - 30) * 0.25 : 5.5;
		if (d < halfWidth) {
			const cortical = halfWidth - d < 1.6 || z - bottom < 1.6 || crest - z < 1.2;
			hu = cortical ? 1400 : 350;

			// inferior alveolar nerve canal: tube inside bone, both sides, rises posteriorly
			const at = Math.abs(t);
			if (at > 0.18) {
				const zc = 14 + 8 * at;
				if (d < 1.3 && Math.abs(z - zc) < 1.3) hu = 60;
			}
		}
	}

	// teeth: crowns above crest (36..45), roots inside bone (26..36)
	const dt = distTooth[idx];
	if (dt < 3.2 && z > 26 && z < 45) {
		if (z >= crest) {
			if (dt < 3.2) hu = 2200; // crown
		} else {
			const taper = 1.9 * ((z - 26) / 10); // root narrows apically
			if (dt < Math.max(0.7, taper)) hu = 2400; // root + canal-dense dentine
		}
	}

	return hu;
}

// ---------------- generate ----------------

mkdirSync(OUT_DIR, { recursive: true });
const zipEntries: Record<string, Uint8Array> = {};

for (let k = 0; k < SLICES; k++) {
	const z = k * SPACING;
	const pixels = new Int16Array(COLS * ROWS);
	for (let r = 0; r < ROWS; r++) {
		for (let cI = 0; cI < COLS; cI++) {
			// mild noise for realism
			const noise = ((k * 73 + r * 31 + cI * 17) % 7) - 3;
			pixels[r * COLS + cI] = huAt(cI, r, z) + noise;
		}
	}
	const file = dicomFile(k, pixels);
	const name = `slice_${String(k + 1).padStart(3, '0')}.dcm`;
	await Bun.write(join(OUT_DIR, name), file);
	zipEntries[name] = file;
}

const zipped = zipSync(zipEntries, { level: 6 });
await Bun.write(`${OUT_DIR}.zip`, zipped);
console.log(
	`Wrote ${SLICES} slices (${COLS}×${ROWS}, ${SPACING}mm) to ${OUT_DIR} and testdata/synthetic-cbct.zip (${(zipped.length / 1e6).toFixed(1)} MB)`
);
