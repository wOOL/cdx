/**
 * Advanced DICOM import ("advanced transfer mode"): header-only preflight
 * analysis plus a configurable import pipeline — slice range/step, crop,
 * gap filling, gantry-tilt correction, gray window and alias anonymization.
 *
 * Two-request design: the client sends the SAME FileList twice, first to the
 * preflight endpoint and then to the import endpoint. Browser File objects
 * are stable, disk-backed handles onto the user's picked files, so they can
 * be uploaded again reliably even for huge sets — nothing has to be cached
 * server-side between the two requests.
 */
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import {
	createDataset,
	getCase,
	getDataset,
	getPatient,
	updateCase,
	updatePatient
} from '$lib/server/db/repo';
import { grayPng } from '$lib/server/png';
import type {
	AdvancedImportOptions,
	PreflightExtra,
	PreflightGap,
	PreflightResult,
	PreflightSlice,
	PreflightThumb
} from '$lib/dicomImportTypes';
import type { Dataset } from '$lib/types';
import { buildPreview, parseDicomFile, type ParsedSlice, type VolumeResult } from './import';

// ---------- series analysis (shared by preflight + import) ----------

export interface SeriesAnalysis {
	/** main (largest) series, sorted by projected z position */
	main: ParsedSlice[];
	/** projected position per main slice (mm), same order as `main` */
	zPos: number[];
	/** unit slice normal (rowDir × colDir of the first slice) */
	normal: [number, number, number];
	/** parseable images that are not usable as part of the main series */
	extras: { slice: ParsedSlice; reason: string }[];
	unreadable: number;
	zSpacingMedian: number;
	gaps: PreflightGap[];
	/** angle between the slice normal and the z axis (degrees) */
	tiltDeg: number;
	warnings: string[];
}

function cross(
	a: [number, number, number],
	b: [number, number, number]
): [number, number, number] {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function analyzeSeries(buffers: Uint8Array[]): SeriesAnalysis {
	const bySeries = new Map<string, ParsedSlice[]>();
	let unreadable = 0;
	let hardError: Error | null = null;
	for (const buf of buffers) {
		let s: ParsedSlice | null = null;
		try {
			s = parseDicomFile(buf);
		} catch (e) {
			unreadable++;
			hardError ??= e instanceof Error ? e : new Error(String(e));
			continue;
		}
		if (!s) {
			unreadable++;
			continue;
		}
		const list = bySeries.get(s.seriesUid) ?? [];
		list.push(s);
		bySeries.set(s.seriesUid, list);
	}

	let largest: ParsedSlice[] | undefined;
	for (const list of bySeries.values()) {
		if (!largest || list.length > largest.length) largest = list;
	}
	if (!largest || largest.length === 0) {
		if (buffers.length === 1 && hardError) throw hardError;
		throw new Error(
			`No readable DICOM image slices found${unreadable ? ` (${unreadable} files failed to parse)` : ''}`
		);
	}

	const extras: { slice: ParsedSlice; reason: string }[] = [];
	for (const list of bySeries.values()) {
		if (list === largest) continue;
		for (const s of list) extras.push({ slice: s, reason: 'not part of main series' });
	}

	// keep only the dominant matrix size within the main series
	const dimCount = new Map<string, number>();
	for (const s of largest) {
		const k = `${s.rows}x${s.cols}`;
		dimCount.set(k, (dimCount.get(k) ?? 0) + 1);
	}
	let bestDim = '';
	let bestN = 0;
	for (const [k, n] of dimCount) {
		if (n > bestN) {
			bestN = n;
			bestDim = k;
		}
	}
	const main: ParsedSlice[] = [];
	for (const s of largest) {
		if (`${s.rows}x${s.cols}` === bestDim) main.push(s);
		else extras.push({ slice: s, reason: 'dimension mismatch with main series' });
	}

	const first = main[0];
	const nRaw = cross(first.rowDir, first.colDir);
	const nLen = Math.hypot(nRaw[0], nRaw[1], nRaw[2]) || 1;
	const normal: [number, number, number] = [nRaw[0] / nLen, nRaw[1] / nLen, nRaw[2] / nLen];

	const havePositions = main.every((s) => s.position);
	const proj = (s: ParsedSlice) =>
		s.position
			? s.position[0] * normal[0] + s.position[1] * normal[1] + s.position[2] * normal[2]
			: 0;
	if (havePositions) main.sort((a, b) => proj(a) - proj(b));
	else main.sort((a, b) => a.instanceNumber - b.instanceNumber);

	const tagSpacing = first.spacingBetweenSlices || first.sliceThickness || 1;
	const zPos = main.map((s, i) => (havePositions ? proj(s) : i * tagSpacing));

	const allGaps: number[] = [];
	for (let i = 1; i < zPos.length; i++) allGaps.push(zPos[i] - zPos[i - 1]);
	const sorted = [...allGaps].sort((a, b) => a - b);
	let zSpacingMedian = sorted.length ? sorted[Math.floor(sorted.length / 2)] : tagSpacing;
	if (!(zSpacingMedian > 0.001)) zSpacingMedian = tagSpacing;

	// gaps: consecutive z gaps deviating >25% from the median
	const gaps: PreflightGap[] = [];
	for (let i = 1; i < zPos.length; i++) {
		const g = zPos[i] - zPos[i - 1];
		if (Math.abs(g - zSpacingMedian) > 0.25 * zSpacingMedian) {
			gaps.push({ index: i, zPos: (zPos[i - 1] + zPos[i]) / 2, gap: g });
		}
	}

	const tiltDeg = (Math.acos(Math.min(1, Math.abs(normal[2]))) * 180) / Math.PI;

	const orientOk = main.every(
		(s) =>
			s.rowDir.every((v, i) => Math.abs(v - first.rowDir[i]) < 1e-3) &&
			s.colDir.every((v, i) => Math.abs(v - first.colDir[i]) < 1e-3)
	);

	const warnings: string[] = [];
	if (first.cols < 512 || first.rows < 512) {
		warnings.push(`Low resolution: ${first.cols}×${first.rows} is below the recommended 512×512`);
	}
	if (zSpacingMedian > 1) {
		warnings.push(`Slice spacing ${zSpacingMedian.toFixed(2)} mm exceeds 1 mm`);
	}
	if (gaps.length) {
		warnings.push(`${gaps.length} irregular slice gap(s) detected — possible missing slices`);
	}
	if (!orientOk) warnings.push('Inconsistent slice orientation within the series');
	if (tiltDeg > 0.5) warnings.push(`Gantry tilt of ${tiltDeg.toFixed(1)}° detected`);
	if (unreadable) warnings.push(`${unreadable} file(s) could not be read as DICOM images`);

	return { main, zPos, normal, extras, unreadable, zSpacingMedian, gaps, tiltDeg, warnings };
}

// ---------- preflight ----------

/** Nearest-neighbor downsample of one slice to a windowed grayscale image. */
function sliceToGray(
	s: ParsedSlice,
	targetW: number,
	lo: number,
	hi: number
): { w: number; h: number; gray: Uint8Array } {
	const w = Math.max(1, Math.min(targetW, s.cols));
	const h = Math.max(1, Math.round((s.rows * w) / s.cols));
	const gray = new Uint8Array(w * h);
	const range = hi - lo || 1;
	for (let y = 0; y < h; y++) {
		const sy = Math.min(s.rows - 1, Math.round((y * s.rows) / h));
		for (let x = 0; x < w; x++) {
			const sx = Math.min(s.cols - 1, Math.round((x * s.cols) / w));
			let v = (s.pixels[sy * s.cols + sx] * s.rescaleSlope + s.rescaleIntercept - lo) / range;
			if (v < 0) v = 0;
			else if (v > 1) v = 1;
			gray[y * w + x] = (v * 255) | 0;
		}
	}
	return { w, h, gray };
}

function toB64Png(g: { w: number; h: number; gray: Uint8Array }): string {
	return Buffer.from(grayPng(g.w, g.h, g.gray)).toString('base64');
}

/** Parse headers + pixel stats WITHOUT building the volume. */
export function preflightDicom(buffers: Uint8Array[]): PreflightResult {
	const a = analyzeSeries(buffers);
	const first = a.main[0];

	const slices: PreflightSlice[] = a.main.map((s, i) => ({
		index: i,
		instanceNumber: s.instanceNumber,
		rows: s.rows,
		cols: s.cols,
		spacingRow: s.pixelSpacing[0],
		spacingCol: s.pixelSpacing[1],
		zPos: a.zPos[i],
		valid: true
	}));
	a.extras.forEach((e, k) => {
		const p = e.slice.position;
		slices.push({
			index: a.main.length + k,
			instanceNumber: e.slice.instanceNumber,
			rows: e.slice.rows,
			cols: e.slice.cols,
			spacingRow: e.slice.pixelSpacing[0],
			spacingCol: e.slice.pixelSpacing[1],
			zPos: p ? p[0] * a.normal[0] + p[1] * a.normal[1] + p[2] * a.normal[2] : 0,
			valid: false,
			reason: e.reason
		});
	});

	// histogram: 64 bins over [-1000, 3000], sampled from ≤20 evenly spaced slices
	const HLO = -1000;
	const HHI = 3000;
	const BINS = 64;
	const bins = new Array<number>(BINS).fill(0);
	const nh = Math.min(20, a.main.length);
	for (let j = 0; j < nh; j++) {
		const s = a.main[Math.floor((j * a.main.length) / nh)];
		const { pixels, rescaleSlope: m, rescaleIntercept: b } = s;
		const stride = Math.max(1, Math.floor(pixels.length / 65536));
		for (let i = 0; i < pixels.length; i += stride) {
			let bi = Math.floor(((pixels[i] * m + b - HLO) * BINS) / (HHI - HLO));
			if (bi < 0) bi = 0;
			else if (bi >= BINS) bi = BINS - 1;
			bins[bi]++;
		}
	}

	// thumbnail strip: ≤12 evenly spaced 80px-wide slices, windowed with the
	// series' default window
	const wLo = first.windowCenter - first.windowWidth / 2;
	const wHi = first.windowCenter + first.windowWidth / 2;
	const thumbs: PreflightThumb[] = [];
	const nt = Math.min(12, a.main.length);
	for (let j = 0; j < nt; j++) {
		const si = Math.floor((j * a.main.length) / nt);
		const g = sliceToGray(a.main[si], 80, wLo, wHi);
		thumbs.push({ index: si, width: g.w, height: g.h, png: toB64Png(g) });
	}

	// embedded 2D images (secondary captures / single-slice series)
	const extras: PreflightExtra[] = [];
	a.extras.forEach((e, k) => {
		if (e.reason !== 'not part of main series') return;
		const s = e.slice;
		const g = sliceToGray(s, 512, s.windowCenter - s.windowWidth / 2, s.windowCenter + s.windowWidth / 2);
		extras.push({
			index: a.main.length + k,
			description: s.seriesDescription || `${s.modality || 'DICOM'} image`,
			width: g.w,
			height: g.h,
			png: toB64Png(g)
		});
	});

	return {
		slices,
		series: {
			count: a.main.length,
			rows: first.rows,
			cols: first.cols,
			spacing: [first.pixelSpacing[0], first.pixelSpacing[1]],
			zSpacingMedian: a.zSpacingMedian,
			gaps: a.gaps,
			tiltDeg: a.tiltDeg,
			patientName: first.patientName,
			modality: first.modality,
			seriesDescription: first.seriesDescription
		},
		warnings: a.warnings,
		histogram: { lo: HLO, hi: HHI, bins },
		thumbs,
		extras
	};
}

// ---------- advanced import ----------

/** Rescale a slice's stored pixels to clamped HU. */
function toHu(s: ParsedSlice): Int16Array {
	const { pixels, rescaleSlope: m, rescaleIntercept: b } = s;
	const out = new Int16Array(pixels.length);
	if (m === 1 && b === 0 && pixels instanceof Int16Array) {
		out.set(pixels);
		return out;
	}
	for (let i = 0; i < pixels.length; i++) {
		let v = pixels[i] * m + b;
		if (v < -32768) v = -32768;
		else if (v > 32767) v = 32767;
		out[i] = v;
	}
	return out;
}

/** Shift all rows of a slice by a (fractional) pixel offset along y, fill -1000. */
function shearRows(src: Int16Array, cols: number, rows: number, shift: number): Int16Array {
	const out = new Int16Array(src.length).fill(-1000);
	for (let y = 0; y < rows; y++) {
		const sy = y + shift;
		const y0 = Math.floor(sy);
		const f = sy - y0;
		if (y0 < -1 || y0 >= rows) continue;
		for (let x = 0; x < cols; x++) {
			const a = y0 >= 0 ? src[y0 * cols + x] : -1000;
			const b = y0 + 1 < rows ? src[(y0 + 1) * cols + x] : -1000;
			out[y * cols + x] = Math.round(a + (b - a) * f);
		}
	}
	return out;
}

/**
 * Configurable import: slice range/step, gap filling, gantry correction,
 * crop, gray window, alias anonymization. Writes the volume + preview files,
 * creates the dataset row and stores warnings/gray window on it.
 */
export async function importDicomToCaseAdvanced(
	caseId: number,
	buffers: Uint8Array[],
	opts: AdvancedImportOptions = {},
	signal?: AbortSignal
): Promise<{ dataset: Dataset; warnings: string[] }> {
	// nothing is persisted until createDataset at the end, so bailing at the
	// phase boundaries leaves no partial state behind
	const bail = (): void => {
		if (signal?.aborted) throw new Error('Import cancelled');
	};
	const a = analyzeSeries(buffers);
	bail();
	const warnings = [...a.warnings];
	const first = a.main[0];
	let cols = first.cols;
	let rows = first.rows;

	// 1 — slice range (inclusive indices into the z-sorted series)
	const last = a.main.length - 1;
	const from = Math.max(0, Math.min(Math.floor(opts.sliceFrom ?? 0), last));
	const to = Math.max(from, Math.min(Math.floor(opts.sliceTo ?? last), last));
	let planes: { z: number; data: Int16Array }[] = [];
	for (let i = from; i <= to; i++) planes.push({ z: a.zPos[i], data: toHu(a.main[i]) });

	bail();
	// 2 — fill missing slices: a gap of ~k× the median gets k−1 synthetic planes
	if (opts.fillMissing && planes.length > 1) {
		const filled: typeof planes = [planes[0]];
		let inserted = 0;
		for (let i = 1; i < planes.length; i++) {
			const gap = planes[i].z - planes[i - 1].z;
			const k = Math.round(gap / a.zSpacingMedian);
			if (k >= 2 && gap > 1.5 * a.zSpacingMedian) {
				for (let j = 1; j < k; j++) {
					const t = j / k;
					const data = new Int16Array(cols * rows);
					if (opts.fillMissing === 'black') {
						data.fill(-1000);
					} else {
						const A = planes[i - 1].data;
						const B = planes[i].data;
						for (let p = 0; p < data.length; p++) data[p] = Math.round(A[p] + (B[p] - A[p]) * t);
					}
					filled.push({ z: planes[i - 1].z + gap * t, data });
					inserted++;
				}
			}
			filled.push(planes[i]);
		}
		planes = filled;
		if (inserted) {
			warnings.push(`Inserted ${inserted} synthetic slice(s) to fill gaps (${opts.fillMissing})`);
		}
	}

	// 3 — optimized 1:n — keep every nth slice of the selection
	const step = Math.max(1, Math.floor(opts.sliceStep ?? 1));
	if (step > 1) planes = planes.filter((_, i) => i % step === 0);
	if (planes.length === 0) throw new Error('Slice selection is empty');

	// 4 — gantry tilt correction (approximation): the y-z component of the
	// slice normal is removed by shifting each slice along y by
	// (z − z0) · n_y/n_z pixels (linear interpolation, exposed rows = −1000).
	// Any x-z tilt component and the in-plane cos(θ) scaling are ignored.
	if (opts.gantryCorrect && a.tiltDeg > 0.5 && a.normal[2] !== 0) {
		const shear = a.normal[1] / a.normal[2]; // mm of y drift per mm of z
		const rowSp = first.pixelSpacing[0] || 1;
		const z0 = planes[0].z;
		for (const pl of planes) {
			const shiftPx = ((pl.z - z0) * shear) / rowSp;
			if (Math.abs(shiftPx) > 0.01) pl.data = shearRows(pl.data, cols, rows, shiftPx);
		}
		warnings.push(
			`Gantry tilt correction applied (${a.tiltDeg.toFixed(1)}°, y-shear approximation)`
		);
	}

	// 5 — crop (region restriction, full-resolution pixel coordinates)
	if (opts.crop) {
		const x0 = Math.max(0, Math.min(Math.round(opts.crop.x0), cols - 1));
		const y0 = Math.max(0, Math.min(Math.round(opts.crop.y0), rows - 1));
		const x1 = Math.max(x0 + 1, Math.min(Math.round(opts.crop.x1), cols));
		const y1 = Math.max(y0 + 1, Math.min(Math.round(opts.crop.y1), rows));
		const nc = x1 - x0;
		const nr = y1 - y0;
		for (const pl of planes) {
			const out = new Int16Array(nc * nr);
			for (let y = 0; y < nr; y++) {
				const src = (y + y0) * cols + x0;
				out.set(pl.data.subarray(src, src + nc), y * nc);
			}
			pl.data = out;
		}
		cols = nc;
		rows = nr;
	}

	// 6 — z spacing: median gap of the final stack, manual override wins
	let zSpacing = first.spacingBetweenSlices || first.sliceThickness || 1;
	if (planes.length > 1) {
		const gs: number[] = [];
		for (let i = 1; i < planes.length; i++) gs.push(planes[i].z - planes[i - 1].z);
		gs.sort((x, y) => x - y);
		const med = gs[Math.floor(gs.length / 2)];
		if (med > 0.01) zSpacing = med;
	}
	if (opts.zSpacingOverride && opts.zSpacingOverride > 0) zSpacing = opts.zSpacingOverride;

	bail();
	// 7 — assemble volume + preview
	const nSlices = planes.length;
	const volume = new Int16Array(cols * rows * nSlices);
	planes.forEach((pl, k) => volume.set(pl.data, k * cols * rows));

	let grayLo = Math.round(opts.grayLo ?? -1000);
	let grayHi = Math.round(opts.grayHi ?? 3000);
	if (grayHi <= grayLo) {
		grayLo = -1000;
		grayHi = 3000;
	}

	const alias = opts.alias?.trim() ?? '';
	const vol: VolumeResult = {
		volume,
		cols,
		rows,
		slices: nSlices,
		spacing: [first.pixelSpacing[1], first.pixelSpacing[0], zSpacing],
		windowCenter: first.windowCenter,
		windowWidth: first.windowWidth,
		patientName: alias || first.patientName,
		patientBirthDate: first.patientBirthDate,
		patientSex: first.patientSex,
		studyDate: first.studyDate,
		modality: first.modality,
		seriesDescription: first.seriesDescription
	};
	const preview = buildPreview(vol, 256, grayLo, grayHi);

	bail();
	const rel = caseRel(caseId);
	const stamp = crypto.randomUUID().slice(0, 8);
	const volPath = join(rel, `vol_${stamp}.i16`);
	const prevPath = join(rel, `vol_${stamp}_preview.u8`);
	await Bun.write(resolveData(volPath), new Uint8Array(volume.buffer, 0, volume.byteLength));
	await Bun.write(resolveData(prevPath), preview.data);

	const created = createDataset({
		case_id: caseId,
		kind: 'ct',
		description: `${vol.modality} ${cols}×${rows}×${nSlices}`,
		cols,
		rows,
		slices: nSlices,
		spacing_x: vol.spacing[0],
		spacing_y: vol.spacing[1],
		spacing_z: vol.spacing[2],
		window_center: vol.windowCenter,
		window_width: vol.windowWidth,
		patient_name: vol.patientName,
		study_date: vol.studyDate,
		modality: vol.modality,
		series_description: vol.seriesDescription,
		volume_path: volPath,
		preview_path: prevPath,
		preview_cols: preview.cols,
		preview_rows: preview.rows,
		preview_slices: preview.slices
	});
	db.query(
		`UPDATE datasets SET import_warnings = ?2, gray_lo = ?3, gray_hi = ?4 WHERE id = ?1`
	).run(created.id, JSON.stringify(warnings), grayLo, grayHi);

	const c = getCase(caseId);
	if (c && c.status === 'new') updateCase(caseId, { status: 'planning' });

	// prefill empty patient identity from DICOM tags — skipped when an alias
	// anonymizes the import
	if (c && !alias) {
		const patient = getPatient(c.patient_id);
		if (patient && !patient.first_name && !patient.last_name && first.patientName) {
			const [lastName = '', firstName = ''] = first.patientName.split('^');
			const dob = /^\d{8}$/.test(first.patientBirthDate)
				? `${first.patientBirthDate.slice(0, 4)}-${first.patientBirthDate.slice(4, 6)}-${first.patientBirthDate.slice(6, 8)}`
				: patient.date_of_birth;
			updatePatient(patient.id, {
				...patient,
				last_name: lastName.trim(),
				first_name: firstName.trim(),
				date_of_birth: dob,
				sex: patient.sex || first.patientSex.trim().charAt(0)
			});
		}
	}

	return { dataset: getDataset(created.id) ?? created, warnings };
}
