import dicomParser from 'dicom-parser';
import { join } from 'node:path';
import { caseDir } from '$lib/server/db';
import { createDataset, getCase, getPatient, updateCase, updatePatient } from '$lib/server/db/repo';
import type { Dataset } from '$lib/types';

export interface ParsedSlice {
	seriesUid: string;
	instanceNumber: number;
	position: [number, number, number] | null;
	rowDir: [number, number, number];
	colDir: [number, number, number];
	rows: number;
	cols: number;
	pixelSpacing: [number, number]; // [row, col] mm
	sliceThickness: number;
	spacingBetweenSlices: number;
	rescaleSlope: number;
	rescaleIntercept: number;
	windowCenter: number;
	windowWidth: number;
	bitsAllocated: number;
	pixelRepresentation: number;
	patientName: string;
	patientBirthDate: string;
	patientSex: string;
	studyDate: string;
	modality: string;
	seriesDescription: string;
	pixels: Int16Array | Uint16Array | Uint8Array;
}

export interface VolumeResult {
	volume: Int16Array; // HU values, x fastest, then y, then z (z = increasing slice position)
	cols: number;
	rows: number;
	slices: number;
	spacing: [number, number, number]; // mm per voxel in x (col), y (row), z
	windowCenter: number;
	windowWidth: number;
	patientName: string;
	patientBirthDate: string;
	patientSex: string;
	studyDate: string;
	modality: string;
	seriesDescription: string;
}

const SUPPORTED_TS = new Set([
	'1.2.840.10008.1.2', // implicit VR LE
	'1.2.840.10008.1.2.1', // explicit VR LE
	'' // missing meta header — assume implicit LE
]);

function floats(ds: dicomParser.DataSet, tag: string): number[] {
	const s = ds.string(tag);
	if (!s) return [];
	return s.split('\\').map((v) => parseFloat(v)).filter((v) => !isNaN(v));
}

export function parseDicomFile(bytes: Uint8Array): ParsedSlice | null {
	let ds: dicomParser.DataSet;
	try {
		ds = dicomParser.parseDicom(bytes);
	} catch {
		return null; // not a DICOM file
	}
	const ts = ds.string('x00020010') ?? '';
	if (!SUPPORTED_TS.has(ts)) {
		throw new Error(
			`Unsupported DICOM transfer syntax ${ts} (compressed DICOM is not supported yet — export as uncompressed)`
		);
	}
	const pixelElement = ds.elements.x7fe00010;
	if (!pixelElement) return null; // no image (e.g. DICOMDIR)
	const rows = ds.uint16('x00280010') ?? 0;
	const cols = ds.uint16('x00280011') ?? 0;
	if (!rows || !cols) return null;
	const frames = ds.intString('x00280008') ?? 1;
	if (frames > 1) {
		throw new Error('Multi-frame DICOM is not supported yet — export as single-frame series');
	}

	const bitsAllocated = ds.uint16('x00280100') ?? 16;
	const pixelRepresentation = ds.uint16('x00280103') ?? 0;
	const count = rows * cols;

	// align: copy if offset is odd (rare)
	const off = pixelElement.dataOffset;
	const buf = bytes.buffer as ArrayBuffer;
	const base = bytes.byteOffset + off;
	let pixels: Int16Array | Uint16Array | Uint8Array;
	if (bitsAllocated === 8) {
		pixels = new Uint8Array(buf, base, count);
	} else if (bitsAllocated === 16) {
		const aligned = base % 2 === 0 ? buf : bytes.slice(off, off + count * 2).buffer;
		const alignedOff = base % 2 === 0 ? base : 0;
		pixels =
			pixelRepresentation === 1
				? new Int16Array(aligned as ArrayBuffer, alignedOff, count)
				: new Uint16Array(aligned as ArrayBuffer, alignedOff, count);
	} else {
		throw new Error(`Unsupported bits allocated: ${bitsAllocated}`);
	}

	const ipp = floats(ds, 'x00200032');
	const iop = floats(ds, 'x00200037');
	const ps = floats(ds, 'x00280030');
	const wc = floats(ds, 'x00281050');
	const ww = floats(ds, 'x00281051');

	return {
		seriesUid: ds.string('x0020000e') ?? 'unknown',
		instanceNumber: ds.intString('x00200013') ?? 0,
		position: ipp.length === 3 ? [ipp[0], ipp[1], ipp[2]] : null,
		rowDir: iop.length === 6 ? [iop[0], iop[1], iop[2]] : [1, 0, 0],
		colDir: iop.length === 6 ? [iop[3], iop[4], iop[5]] : [0, 1, 0],
		rows,
		cols,
		pixelSpacing: ps.length === 2 ? [ps[0], ps[1]] : [1, 1],
		sliceThickness: ds.floatString('x00180050') ?? 1,
		spacingBetweenSlices: ds.floatString('x00180088') ?? 0,
		rescaleSlope: ds.floatString('x00281053') ?? 1,
		rescaleIntercept: ds.floatString('x00281052') ?? 0,
		windowCenter: wc[0] ?? 400,
		windowWidth: ww[0] ?? 1800,
		bitsAllocated,
		pixelRepresentation,
		patientName: ds.string('x00100010') ?? '',
		patientBirthDate: ds.string('x00100030') ?? '',
		patientSex: ds.string('x00100040') ?? '',
		studyDate: ds.string('x00080020') ?? '',
		modality: ds.string('x00080060') ?? '',
		seriesDescription: ds.string('x0008103e') ?? '',
		pixels
	};
}

/** Build a single HU volume from a pile of DICOM file buffers. Picks the largest series. */
export function buildVolume(files: Uint8Array[]): VolumeResult {
	const bySeries = new Map<string, ParsedSlice[]>();
	let parseErrors = 0;
	for (const f of files) {
		let slice: ParsedSlice | null = null;
		try {
			slice = parseDicomFile(f);
		} catch (e) {
			// surface hard errors (unsupported format) only if nothing else parses
			parseErrors++;
			if (files.length === 1) throw e;
			continue;
		}
		if (!slice) continue;
		const list = bySeries.get(slice.seriesUid) ?? [];
		list.push(slice);
		bySeries.set(slice.seriesUid, list);
	}

	let slicesArr: ParsedSlice[] | undefined;
	for (const list of bySeries.values()) {
		if (!slicesArr || list.length > slicesArr.length) slicesArr = list;
	}
	if (!slicesArr || slicesArr.length === 0) {
		throw new Error(
			`No readable DICOM image slices found${parseErrors ? ` (${parseErrors} files failed to parse)` : ''}`
		);
	}

	const first = slicesArr[0];
	const { rows, cols } = first;
	if (slicesArr.some((s) => s.rows !== rows || s.cols !== cols)) {
		throw new Error('Inconsistent slice dimensions within series');
	}

	// slice normal = rowDir × colDir
	const n: [number, number, number] = [
		first.rowDir[1] * first.colDir[2] - first.rowDir[2] * first.colDir[1],
		first.rowDir[2] * first.colDir[0] - first.rowDir[0] * first.colDir[2],
		first.rowDir[0] * first.colDir[1] - first.rowDir[1] * first.colDir[0]
	];

	const havePositions = slicesArr.every((s) => s.position);
	if (havePositions) {
		const proj = (s: ParsedSlice) =>
			s.position![0] * n[0] + s.position![1] * n[1] + s.position![2] * n[2];
		slicesArr.sort((a, b) => proj(a) - proj(b));
	} else {
		slicesArr.sort((a, b) => a.instanceNumber - b.instanceNumber);
	}

	// z spacing: median gap between consecutive positions, fallback to tags
	let zSpacing = first.spacingBetweenSlices || first.sliceThickness || 1;
	if (havePositions && slicesArr.length > 1) {
		const gaps: number[] = [];
		for (let i = 1; i < slicesArr.length; i++) {
			const a = slicesArr[i - 1].position!;
			const b = slicesArr[i].position!;
			gaps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
		}
		gaps.sort((x, y) => x - y);
		const median = gaps[Math.floor(gaps.length / 2)];
		if (median > 0.01) zSpacing = median;
	}

	const nSlices = slicesArr.length;
	const volume = new Int16Array(cols * rows * nSlices);
	for (let k = 0; k < nSlices; k++) {
		const s = slicesArr[k];
		const { pixels, rescaleSlope: m, rescaleIntercept: b } = s;
		const dst = k * cols * rows;
		if (m === 1 && b === 0 && pixels instanceof Int16Array) {
			volume.set(pixels, dst);
		} else {
			for (let i = 0; i < pixels.length; i++) {
				let v = pixels[i] * m + b;
				if (v < -32768) v = -32768;
				else if (v > 32767) v = 32767;
				volume[dst + i] = v;
			}
		}
	}

	return {
		volume,
		cols,
		rows,
		slices: nSlices,
		spacing: [first.pixelSpacing[1], first.pixelSpacing[0], zSpacing],
		windowCenter: first.windowCenter,
		windowWidth: first.windowWidth,
		patientName: first.patientName,
		patientBirthDate: first.patientBirthDate,
		patientSex: first.patientSex,
		studyDate: first.studyDate,
		modality: first.modality,
		seriesDescription: first.seriesDescription
	};
}

/** Full import: build volume + preview from DICOM buffers, write files, create the dataset row. */
export async function importDicomToCase(caseId: number, buffers: Uint8Array[]): Promise<Dataset> {
	const vol = buildVolume(buffers);
	const preview = buildPreview(vol);

	const dir = caseDir(caseId);
	const stamp = crypto.randomUUID().slice(0, 8);
	const volPath = join(dir, `vol_${stamp}.i16`);
	const prevPath = join(dir, `vol_${stamp}_preview.u8`);
	await Bun.write(volPath, new Uint8Array(vol.volume.buffer, 0, vol.volume.byteLength));
	await Bun.write(prevPath, preview.data);

	const dataset = createDataset({
		case_id: caseId,
		kind: 'ct',
		description: `${vol.modality} ${vol.cols}×${vol.rows}×${vol.slices}`,
		cols: vol.cols,
		rows: vol.rows,
		slices: vol.slices,
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

	const c = getCase(caseId);
	if (c && c.status === 'new') updateCase(caseId, { status: 'planning' });

	// prefill empty patient identity from DICOM tags ("Last^First", YYYYMMDD)
	if (c) {
		const patient = getPatient(c.patient_id);
		if (patient && !patient.first_name && !patient.last_name && vol.patientName) {
			const [last = '', firstName = ''] = vol.patientName.split('^');
			const dob = /^\d{8}$/.test(vol.patientBirthDate)
				? `${vol.patientBirthDate.slice(0, 4)}-${vol.patientBirthDate.slice(4, 6)}-${vol.patientBirthDate.slice(6, 8)}`
				: patient.date_of_birth;
			updatePatient(patient.id, {
				...patient,
				last_name: last.trim(),
				first_name: firstName.trim(),
				date_of_birth: dob,
				sex: patient.sex || vol.patientSex.trim().charAt(0)
			});
		}
	}
	return dataset;
}

/**
 * Downsample an HU volume to a uint8 volume (linear window [-1000, 3000])
 * whose largest dimension is maxDim — used as a 3D texture for volume rendering.
 */
export function buildPreview(
	vol: VolumeResult,
	maxDim = 256
): { data: Uint8Array; cols: number; rows: number; slices: number } {
	const scale = Math.min(1, maxDim / Math.max(vol.cols, vol.rows, vol.slices));
	const pc = Math.max(1, Math.round(vol.cols * scale));
	const pr = Math.max(1, Math.round(vol.rows * scale));
	const psl = Math.max(1, Math.round(vol.slices * scale));
	const out = new Uint8Array(pc * pr * psl);
	const LO = -1000;
	const HI = 3000;
	const range = HI - LO;
	for (let z = 0; z < psl; z++) {
		const sz = Math.min(vol.slices - 1, Math.round((z * vol.slices) / psl));
		const srcZ = sz * vol.cols * vol.rows;
		for (let y = 0; y < pr; y++) {
			const sy = Math.min(vol.rows - 1, Math.round((y * vol.rows) / pr));
			const srcY = srcZ + sy * vol.cols;
			const dstY = z * pc * pr + y * pc;
			for (let x = 0; x < pc; x++) {
				const sx = Math.min(vol.cols - 1, Math.round((x * vol.cols) / pc));
				let v = (vol.volume[srcY + sx] - LO) / range;
				if (v < 0) v = 0;
				else if (v > 1) v = 1;
				out[dstY + x] = (v * 255) | 0;
			}
		}
	}
	return { data: out, cols: pc, rows: pr, slices: psl };
}
