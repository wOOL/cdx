/**
 * Segmentation mask smoke test: threshold init, disc painting, 2D flood
 * fill, and save/load round-trip on a synthetic dataset (no dev server).
 *   bun run scripts/test-mask.ts
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../src/lib/server/db';
import {
	evictMask,
	floodFill2D,
	initFromThreshold,
	loadMask,
	maskRelPath,
	paintDisc,
	saveMask
} from '../src/lib/server/segMask';
import type { Dataset } from '../src/lib/types';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- synthetic dataset: 64x64x8 @ 0.5mm, square of bone on slice 4 ----
const ds: Dataset = {
	id: 9999,
	case_id: 9999,
	kind: 'ct',
	description: 'mask test',
	cols: 64,
	rows: 64,
	slices: 8,
	spacing_x: 0.5,
	spacing_y: 0.5,
	spacing_z: 0.5,
	window_center: 400,
	window_width: 1800,
	patient_name: '',
	study_date: '',
	modality: 'CT',
	series_description: '',
	volume_path: '',
	preview_path: '',
	preview_cols: 0,
	preview_rows: 0,
	preview_slices: 0,
	status: 'ready',
	created_at: ''
};

const C = ds.cols;
const R = ds.rows;
const S = ds.slices;
const CR = C * R;

// volume: -1000 HU everywhere except a 20x20 square of 1000 HU on slice 4
const vol = new Int16Array(C * R * S).fill(-1000);
for (let y = 10; y < 30; y++) {
	for (let x = 10; x < 30; x++) {
		vol[4 * CR + y * C + x] = 1000;
	}
}

function sum(mask: Uint8Array, from = 0, to = mask.length): number {
	let n = 0;
	for (let i = from; i < to; i++) n += mask[i];
	return n;
}

function sliceSum(mask: Uint8Array, k: number): number {
	return sum(mask, k * CR, (k + 1) * CR);
}

/** slice 4 must contain exactly the 20x20 square. */
function squareMatches(mask: Uint8Array): boolean {
	for (let y = 0; y < R; y++) {
		for (let x = 0; x < C; x++) {
			const expected = x >= 10 && x < 30 && y >= 10 && y < 30 ? 1 : 0;
			if (mask[4 * CR + y * C + x] !== expected) return false;
		}
	}
	return true;
}

try {
	// ---- maskRelPath ----
	check(
		'maskRelPath layout',
		maskRelPath(ds) === join('cases', '9999', 'mask_9999.u8'),
		maskRelPath(ds)
	);

	// ---- loadMask with no file → zeros ----
	const empty = await loadMask(ds);
	check('loadMask missing file returns zeros', empty.length === C * R * S && sum(empty) === 0);
	evictMask(ds.id);

	// ---- initFromThreshold ----
	const mask = new Uint8Array(C * R * S);
	const filled = initFromThreshold(vol, mask, 300, 32767);
	check(
		'initFromThreshold(300, 32767) fills 400',
		filled === 400 && sum(mask) === 400 && sliceSum(mask, 4) === 400,
		`${filled} voxels`
	);

	// ---- paintDisc ----
	paintDisc(mask, ds, 'axial', 2, 50, 50, 5, 1);
	const disc = sliceSum(mask, 2);
	check('paintDisc r=5 area ~ pi*25', disc >= 69 && disc <= 90, `${disc} px`);

	// ---- floodFill2D add ----
	const mask2 = new Uint8Array(C * R * S);
	const n1 = floodFill2D(vol, mask2, ds, 4, 15, 15, 300, 32767, 1);
	check('floodFill2D add returns 400', n1 === 400, `${n1} px`);
	check('floodFill2D mask matches square', squareMatches(mask2) && sum(mask2) === 400);
	check(
		'floodFill2D seed outside range returns 0',
		floodFill2D(vol, mask2, ds, 4, 2, 2, 300, 32767, 1) === 0
	);

	// ---- floodFill2D erase ----
	const n2 = floodFill2D(vol, mask2, ds, 4, 15, 15, 300, 32767, 0);
	check('floodFill2D erase returns 400', n2 === 400, `${n2} px`);
	check('slice 4 empty after erase', sliceSum(mask2, 4) === 0);

	// ---- saveMask / loadMask round trip ----
	await saveMask(ds, mask);
	evictMask(ds.id);
	const loaded = await loadMask(ds);
	let equal = loaded.length === mask.length;
	if (equal) {
		for (let i = 0; i < mask.length; i++) {
			if (loaded[i] !== mask[i]) {
				equal = false;
				break;
			}
		}
	}
	check('saveMask/loadMask round trip', equal);
} finally {
	evictMask(ds.id);
	rmSync(join(DATA_DIR, 'cases', '9999'), { recursive: true, force: true });
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All checks passed');
