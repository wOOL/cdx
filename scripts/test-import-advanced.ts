/**
 * Advanced DICOM import library test (no HTTP, no dev server).
 * Builds a tiny 32×32×12 explicit-VR LE series in memory and exercises
 * preflightDicom + importDicomToCaseAdvanced against a throwaway case.
 *   bun run scripts/test-import-advanced.ts
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db, resolveData } from '../src/lib/server/db';
import { importDicomToCaseAdvanced, preflightDicom } from '../src/lib/server/dicom/importAdvanced';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---------------- minimal explicit-VR LE DICOM writer ----------------

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
	const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

const UID_ROOT = '1.2.826.0.1.3680043.9.9999';
const COLS = 32;
const ROWS = 32;
const SLICES = 12;
const SP = 0.5; // mm

function dicomFile(opts: {
	index: number;
	pixels: Int16Array;
	zPos: number;
	seriesUid?: string;
	iop?: string;
}): Uint8Array {
	const sopUid = `${UID_ROOT}.1.3.${opts.index + 1}`;
	const meta = concat([
		bigEl(0x0002, 0x0001, 'OB', new Uint8Array([0, 1])),
		strEl(0x0002, 0x0002, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
		strEl(0x0002, 0x0003, 'UI', sopUid),
		strEl(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
		strEl(0x0002, 0x0012, 'UI', `${UID_ROOT}.0.1`)
	]);
	const pixelBytes = new Uint8Array(opts.pixels.buffer, opts.pixels.byteOffset, opts.pixels.byteLength);
	const dataset = concat([
		strEl(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2'),
		strEl(0x0008, 0x0018, 'UI', sopUid),
		strEl(0x0008, 0x0020, 'DA', '20260611'),
		strEl(0x0008, 0x0060, 'CS', 'CT'),
		strEl(0x0008, 0x103e, 'LO', 'Advanced import test series'),
		strEl(0x0010, 0x0010, 'PN', 'Phantom^Adv'),
		strEl(0x0018, 0x0050, 'DS', String(SP)),
		strEl(0x0018, 0x0088, 'DS', String(SP)),
		strEl(0x0020, 0x000d, 'UI', `${UID_ROOT}.1.1`),
		strEl(0x0020, 0x000e, 'UI', opts.seriesUid ?? `${UID_ROOT}.1.2`),
		strEl(0x0020, 0x0013, 'IS', String(opts.index + 1)),
		strEl(0x0020, 0x0032, 'DS', `-8\\-8\\${opts.zPos.toFixed(2)}`),
		strEl(0x0020, 0x0037, 'DS', opts.iop ?? '1\\0\\0\\0\\1\\0'),
		usEl(0x0028, 0x0002, 1),
		strEl(0x0028, 0x0004, 'CS', 'MONOCHROME2'),
		usEl(0x0028, 0x0010, ROWS),
		usEl(0x0028, 0x0011, COLS),
		strEl(0x0028, 0x0030, 'DS', `${SP}\\${SP}`),
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

function pixelsFor(k: number): Int16Array {
	const px = new Int16Array(COLS * ROWS);
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) px[r * COLS + c] = -500 + c * 20 + r * 10 + k * 5;
	}
	return px;
}

function makeSeries(skip = -1, iop?: string): Uint8Array[] {
	const out: Uint8Array[] = [];
	for (let k = 0; k < SLICES; k++) {
		if (k === skip) continue;
		out.push(dicomFile({ index: k, pixels: pixelsFor(k), zPos: k * SP, iop }));
	}
	return out;
}

// ---------------- throwaway patient + case ----------------

const CASE_ID = 9998;

function cleanup(): void {
	db.query('DELETE FROM cases WHERE id = ?1').run(CASE_ID);
	db.query('DELETE FROM patients WHERE id = ?1').run(CASE_ID);
	rmSync(join(DATA_DIR, 'cases', String(CASE_ID)), { recursive: true, force: true });
}

cleanup(); // clear leftovers from earlier runs
db.query('INSERT INTO patients (id) VALUES (?1)').run(CASE_ID);
db.query(`INSERT INTO cases (id, patient_id, title) VALUES (?1, ?1, 'Advanced import test')`).run(CASE_ID);

try {
	// ---- (a) preflight ----
	{
		const pf = preflightDicom(makeSeries());
		check('preflight: series count/dims', pf.series.count === 12 && pf.series.rows === 32 && pf.series.cols === 32, `count=${pf.series.count} ${pf.series.cols}×${pf.series.rows}`);
		check('preflight: zSpacingMedian ≈ 0.5', Math.abs(pf.series.zSpacingMedian - 0.5) < 0.01, `${pf.series.zSpacingMedian}`);
		check('preflight: all 12 slices valid', pf.slices.length === 12 && pf.slices.every((s) => s.valid));
		check('preflight: histogram has 64 bins with data', pf.histogram.bins.length === 64 && pf.histogram.bins.some((b) => b > 0));
		check('preflight: 12 thumbnails, base64 PNG', pf.thumbs.length === 12 && pf.thumbs.every((t) => atob(t.png).startsWith('\x89PNG')));
		check('preflight: low-resolution warning', pf.warnings.some((w) => w.includes('512')), pf.warnings.join(' | '));
		check('preflight: no gaps, no tilt', pf.series.gaps.length === 0 && pf.series.tiltDeg < 0.1);
	}
	{
		const pf = preflightDicom(makeSeries(6));
		check('preflight: removed slice → 1 gap + missing-slices warning', pf.series.gaps.length === 1 && pf.warnings.some((w) => w.toLowerCase().includes('missing')), `gaps=${JSON.stringify(pf.series.gaps)}`);
	}
	{
		// ~5° gantry tilt in the column direction
		const pf = preflightDicom(makeSeries(-1, '1\\0\\0\\0\\0.9962\\0.0872'));
		check('preflight: tilt angle ≈ 5°', Math.abs(pf.series.tiltDeg - 5) < 0.3, `${pf.series.tiltDeg.toFixed(2)}°`);
	}
	{
		// extra single-slice secondary series → invalid, 'not part of main series'
		const extra = dicomFile({ index: 99, pixels: pixelsFor(0), zPos: 0, seriesUid: `${UID_ROOT}.7.7` });
		const pf = preflightDicom([...makeSeries(), extra]);
		const inv = pf.slices.filter((s) => !s.valid);
		check('preflight: secondary capture flagged + offered as extra', inv.length === 1 && inv[0].reason === 'not part of main series' && pf.extras.length === 1, inv[0]?.reason);
	}

	// ---- (e) alias (run first so the empty patient is not prefilled) ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(), { alias: 'ANON' });
		check('alias: dataset.patient_name = ANON', dataset.patient_name === 'ANON', dataset.patient_name);
		const p = db.query('SELECT first_name, last_name FROM patients WHERE id = ?1').get(CASE_ID) as { first_name: string; last_name: string };
		check('alias: patient identity NOT prefilled', p.first_name === '' && p.last_name === '', `${p.last_name}^${p.first_name}`);
	}

	// ---- (b) slice range ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(), { sliceFrom: 2, sliceTo: 9 });
		check('range: sliceFrom=2, sliceTo=9 → 8 slices', dataset.slices === 8, `slices=${dataset.slices}`);
	}

	// ---- (c) crop ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(), { crop: { x0: 8, y0: 8, x1: 24, y1: 24 } });
		check('crop: {8,8,24,24} → 16×16', dataset.cols === 16 && dataset.rows === 16, `${dataset.cols}×${dataset.rows}`);
	}

	// ---- (d) fillMissing 'black' ----
	{
		const { dataset, warnings } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(6), { fillMissing: 'black' });
		check('fillMissing: slice count restored to 12', dataset.slices === 12, `slices=${dataset.slices}`);
		const vol = new Int16Array(await Bun.file(resolveData(dataset.volume_path)).arrayBuffer());
		const plane = vol.subarray(6 * dataset.cols * dataset.rows, 7 * dataset.cols * dataset.rows);
		let sum = 0;
		for (const v of plane) sum += v;
		const mean = sum / plane.length;
		check('fillMissing: inserted slice ≈ -1000', Math.abs(mean + 1000) < 1, `mean=${mean.toFixed(1)}`);
		const next = vol.subarray(7 * dataset.cols * dataset.rows, 8 * dataset.cols * dataset.rows);
		check('fillMissing: neighbor slice kept real data', next.some((v) => v > -400));
		check('fillMissing: warning recorded', warnings.some((w) => w.includes('synthetic')), warnings.join(' | '));
	}

	// ---- fillMissing 'interpolate' ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(6), { fillMissing: 'interpolate' });
		const vol = new Int16Array(await Bun.file(resolveData(dataset.volume_path)).arrayBuffer());
		const plane = vol.subarray(6 * dataset.cols * dataset.rows, 7 * dataset.cols * dataset.rows);
		// neighbors differ by 5 HU per slice step → midpoint = slice5 + 5
		const expect = pixelsFor(5)[0] + 5;
		check('fillMissing interpolate: midpoint of neighbors', Math.abs(plane[0] - expect) <= 1, `got ${plane[0]}, expected ≈${expect}`);
	}

	// ---- sliceStep (optimized 1:2) ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(), { sliceStep: 2 });
		check('sliceStep 2: 6 slices, spacing_z ≈ 1.0', dataset.slices === 6 && Math.abs(dataset.spacing_z - 1.0) < 0.01, `slices=${dataset.slices} z=${dataset.spacing_z}`);
	}

	// ---- manual z spacing override ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(), { zSpacingOverride: 2.5 });
		check('zSpacingOverride: spacing_z = 2.5', dataset.spacing_z === 2.5, `z=${dataset.spacing_z}`);
	}

	// ---- gray window + stored warnings ----
	{
		const { dataset } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(), { grayLo: -500, grayHi: 1500 });
		const row = db.query('SELECT gray_lo, gray_hi, import_warnings FROM datasets WHERE id = ?1').get(dataset.id) as { gray_lo: number; gray_hi: number; import_warnings: string };
		check('gray window stored on dataset', row.gray_lo === -500 && row.gray_hi === 1500, `${row.gray_lo}..${row.gray_hi}`);
		const parsed = JSON.parse(row.import_warnings) as string[];
		check('import_warnings stored as JSON array', Array.isArray(parsed) && parsed.length > 0, `${parsed.length} warning(s)`);
	}

	// ---- gantry correction on a tilted series ----
	{
		const { dataset, warnings } = await importDicomToCaseAdvanced(CASE_ID, makeSeries(-1, '1\\0\\0\\0\\0.9962\\0.0872'), { gantryCorrect: true });
		check('gantryCorrect: dims preserved + warning noted', dataset.cols === 32 && dataset.rows === 32 && dataset.slices === 12 && warnings.some((w) => w.includes('Gantry tilt correction')), warnings.join(' | '));
	}
} finally {
	cleanup();
}

process.exit(failures ? 1 : 0);
