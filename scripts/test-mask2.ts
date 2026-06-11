/**
 * Extended segmentation feature tests: boundary polylines (constrained
 * fill/paint, mesh import), slice propagation, undo/redo, volume stats,
 * mask slots (roles/exclude/source), and LOD model building — all against a
 * synthetic scratch dataset (no dev server, no DB rows).
 *   bun run scripts/test-mask2.ts
 */
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db } from '../src/lib/server/db';
import { setSetting } from '../src/lib/server/db/repo';
import {
	countMaskRange,
	evictMask,
	floodFill2D,
	getSliceConstraint,
	listSlotNames,
	loadMask,
	maskRelPath,
	paintDisc,
	propagateMask,
	saveMask,
	setSlotRole
} from '../src/lib/server/segMask';
import {
	boundariesFromMesh,
	evictBoundaries,
	getBarrier,
	loadBoundaries,
	sanitizeBoundaries,
	saveBoundaries
} from '../src/lib/server/segBoundary';
import {
	applyPatch,
	clearHistory,
	diffRuns,
	historyBytes,
	historyState,
	popRedo,
	popUndo,
	recordPatch
} from '../src/lib/server/segHistory';
import {
	buildMaskMesh,
	createLodPreset,
	deleteLodPreset,
	laplacianSmooth,
	listLodPresets,
	removeSmallComponents,
	uniqueVertexCount,
	updateLodPreset
} from '../src/lib/server/segLod';
import type { Dataset } from '../src/lib/types';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// ---- synthetic scratch dataset: 64x64x12 @ 0.5 mm ----
const ds: Dataset = {
	id: 9998,
	case_id: 9998,
	kind: 'ct',
	description: 'mask2 test',
	cols: 64,
	rows: 64,
	slices: 12,
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
const CR = C * R;

// volume: -1000 everywhere; slice 2 fully 1000 HU; bone squares on 4..8
// (4–6: x,y ∈ [10,30) → 400 px; 7–8: x,y ∈ [6,34) → 784 px)
const vol = new Int16Array(C * R * ds.slices).fill(-1000);
for (let p = 0; p < CR; p++) vol[2 * CR + p] = 1000;
for (let k = 4; k <= 8; k++) {
	const lo = k >= 7 ? 6 : 10;
	const hi = k >= 7 ? 34 : 30;
	for (let y = lo; y < hi; y++) {
		for (let x = lo; x < hi; x++) vol[k * CR + y * C + x] = 1000;
	}
}

/** axis-aligned box triangle soup (12 triangles), mm coordinates */
function boxMesh(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
	const c = [
		[x0, y0, z0],
		[x1, y0, z0],
		[x1, y1, z0],
		[x0, y1, z0],
		[x0, y0, z1],
		[x1, y0, z1],
		[x1, y1, z1],
		[x0, y1, z1]
	];
	const quads = [
		[0, 1, 2, 3],
		[4, 5, 6, 7],
		[0, 1, 5, 4],
		[3, 2, 6, 7],
		[0, 3, 7, 4],
		[1, 2, 6, 5]
	];
	const out: number[] = [];
	for (const [a, b, cc, d] of quads) {
		out.push(...c[a], ...c[b], ...c[cc], ...c[a], ...c[cc], ...c[d]);
	}
	return Float32Array.from(out);
}

const settingsBefore = db
	.query("SELECT value FROM settings WHERE key = 'seg_lod_presets'")
	.get() as { value: string } | null;

try {
	// =====================================================================
	// 1. boundary sanitization
	// =====================================================================
	check(
		'sanitize rejects out-of-range slice',
		sanitizeBoundaries({ 999: [[{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }]] }, ds) === null
	);
	check(
		'sanitize rejects 2-point polyline',
		sanitizeBoundaries({ 2: [[{ x: 1, y: 1 }, { x: 2, y: 2 }]] }, ds) === null
	);
	const okSet = sanitizeBoundaries({ 2: [[{ x: 1, y: 1 }, { x: 90, y: 2 }, { x: 3, y: -4 }]] }, ds);
	check(
		'sanitize clamps coordinates',
		!!okSet && okSet[2][0][1].x === 63 && okSet[2][0][2].y === 0
	);

	// =====================================================================
	// 2. boundaries constrain flood fill and paint (slice 2, fully in-range)
	// =====================================================================
	const square = [
		{ x: 20, y: 20 },
		{ x: 40, y: 20 },
		{ x: 40, y: 40 },
		{ x: 20, y: 40 }
	];
	await saveBoundaries(ds, { 2: [square] });
	const loadedB = await loadBoundaries(ds);
	check('boundaries save/load round trip', loadedB[2]?.length === 1 && loadedB[2][0].length === 4);
	check('barrier bitmap exists for slice 2', (await getBarrier(ds, 2)) !== null);
	check('barrier bitmap null for slice 3', (await getBarrier(ds, 3)) === null);

	const mainMask = await loadMask(ds, 'main');
	const c2 = await getSliceConstraint(ds, 'main', 2);

	// without constraint the whole slice floods; with the boundary only the
	// 19x19 interior of the square is reachable from (30,30)
	const free = new Uint8Array(mainMask.length);
	const freeFilled = floodFill2D(vol, free, ds, 2, 30, 30, 300, 32767, 1);
	const filled = floodFill2D(vol, mainMask, ds, 2, 30, 30, 300, 32767, 1, c2);
	check('unconstrained fill floods whole slice', freeFilled === CR, `${freeFilled} px`);
	check('boundary blocks flood fill', filled === 19 * 19, `${filled} px, expected 361`);
	let leaked = 0;
	for (let y = 0; y < R; y++) {
		for (let x = 0; x < C; x++) {
			const inside = x > 20 && x < 40 && y > 20 && y < 40;
			if (!inside && mainMask[2 * CR + y * C + x]) leaked++;
		}
	}
	check('fill does not leak across boundary', leaked === 0, `${leaked} px outside`);

	// brush crossing the boundary: nothing beyond x=20 may be painted
	const brush = new Uint8Array(mainMask.length);
	paintDisc(brush, ds, 'axial', 2, 18, 30, 5, 1, c2);
	let paintedLeft = 0;
	let paintedRight = 0;
	for (let y = 0; y < R; y++) {
		for (let x = 0; x < C; x++) {
			if (!brush[2 * CR + y * C + x]) continue;
			if (x >= 20) paintedRight++;
			else paintedLeft++;
		}
	}
	check('paint stays on the brush side of the boundary', paintedLeft > 20 && paintedRight === 0,
		`${paintedLeft} left / ${paintedRight} right`);

	// =====================================================================
	// 3. slice propagation with per-slice counts + warning rule
	// =====================================================================
	for (let y = 10; y < 30; y++) {
		for (let x = 10; x < 30; x++) mainMask[4 * CR + y * C + x] = 1; // seed slice 4
	}
	const prop = await propagateMask(ds, vol, mainMask, 'main', 4, 8, 300, 32767);
	const got = prop.slices.map((s) => `${s.index}:${s.changed}/${s.voxels}`).join(' ');
	check(
		'propagate grows region per slice',
		prop.slices.length === 4 &&
			prop.slices[0].voxels === 400 &&
			prop.slices[1].voxels === 400 &&
			prop.slices[2].voxels === 784 &&
			prop.slices[3].voxels === 784,
		got
	);
	check(
		'propagate reports changed counts',
		prop.slices[0].changed === 400 && prop.slices[2].changed === 784,
		got
	);
	// replicate the endpoint warning rule (>40% vs previous slice)
	let prevVox = 400;
	const warnings: number[] = [];
	for (const s of prop.slices) {
		if (Math.abs(s.voxels - prevVox) > 0.4 * Math.max(1, prevVox)) warnings.push(s.index);
		prevVox = s.voxels;
	}
	check('propagate flags >40% slice change', warnings.length === 1 && warnings[0] === 7,
		warnings.join(','));
	check('propagate returns undo patches', prop.patches.length === 4);

	// =====================================================================
	// 4. undo/redo: byte-exact restore, 10-step cap
	// =====================================================================
	clearHistory(ds.id);
	const preBytes = mainMask.slice();
	const before2 = mainMask.slice(2 * CR, 3 * CR);
	floodFill2D(vol, mainMask, ds, 2, 5, 5, 300, 32767, 1, c2); // outside boundary square
	const runs2 = diffRuns(before2, mainMask.subarray(2 * CR, 3 * CR));
	check('fill produced a diff', runs2 !== null);
	recordPatch(ds.id, 'main', [{ index: 2, runs: runs2! }]);
	check('history holds bytes', historyBytes() > 0 && historyState(ds.id).undo === 1);
	const postBytes = mainMask.slice();

	const up = popUndo(ds.id);
	check('popUndo returns the patch', up !== null && up!.slot === 'main');
	applyPatch(mainMask, up!, CR);
	check('undo restores exact bytes', bytesEqual(mainMask, preBytes));
	const rp = popRedo(ds.id);
	applyPatch(mainMask, rp!, CR);
	check('redo reapplies exact bytes', bytesEqual(mainMask, postBytes));
	check('history counters after redo', historyState(ds.id).undo === 1 && historyState(ds.id).redo === 0);

	// 10-step cap on a separate scratch id
	for (let i = 0; i < 12; i++) {
		recordPatch(9997, 'main', [{ index: 0, runs: Uint32Array.from([i, 1]) }]);
	}
	check('undo history capped at 10 steps', historyState(9997).undo === 10);
	clearHistory(9997);

	// =====================================================================
	// 5. volume stats (voxels → ml)
	// =====================================================================
	const statsMask = new Uint8Array(C * R * ds.slices);
	for (let i = 0; i < 400; i++) statsMask[i] = 1;
	const voxels = countMaskRange(statsMask);
	const ml = (voxels * ds.spacing_x * ds.spacing_y * ds.spacing_z) / 1000;
	check('stats: 400 voxels @0.5mm³ = 0.05 ml', voxels === 400 && Math.abs(ml - 0.05) < 1e-12,
		`${ml} ml`);

	// =====================================================================
	// 6. boundary import from a model mesh
	// =====================================================================
	// box x,y ∈ [5,15] mm (px 10..30), z ∈ [1.1, 4.9] mm → slices 3..9
	const mesh = boxMesh(5, 5, 1.1, 15, 15, 4.9);
	const imported = boundariesFromMesh(mesh, null, ds);
	const slicesHit = Object.keys(imported).map(Number).sort((a, b) => a - b);
	check('from-model hits slices 3..9', slicesHit.join(',') === '3,4,5,6,7,8,9', slicesHit.join(','));
	const poly5 = imported[5];
	check('from-model chains one closed loop per slice', poly5?.length === 1 && poly5[0].length >= 4,
		`${poly5?.length} polylines, ${poly5?.[0]?.length} pts`);
	let inBox = true;
	for (const p of poly5?.[0] ?? []) {
		if (p.x < 9.4 || p.x > 30.6 || p.y < 9.4 || p.y > 30.6) inBox = false;
	}
	check('from-model contour matches box footprint (px 10..30)', inBox);

	// identity transform must not change the contours
	const ident = boundariesFromMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], ds);
	check('from-model respects transform (identity)', JSON.stringify(ident) === JSON.stringify(imported));

	// imported boundaries constrain a fill on slice 5 (HU square at px 10..29)
	await saveBoundaries(ds, imported);
	const impMask = await loadMask(ds, 'imp');
	const c5 = await getSliceConstraint(ds, 'imp', 5);
	const impFilled = floodFill2D(vol, impMask, ds, 5, 15, 15, 300, 32767, 1, c5);
	check('imported boundary blocks flood fill', impFilled === 19 * 19, `${impFilled} px, expected 361`);

	// =====================================================================
	// 7. slots: isolation, roles, exclude/source precedence
	// =====================================================================
	await saveBoundaries(ds, {}); // clear boundaries for the slot tests

	const altMask = new Uint8Array(C * R * ds.slices);
	altMask[123] = 1;
	await saveMask(ds, altMask, 'alt');
	await saveMask(ds, mainMask, 'main');
	evictMask(ds.id); // force reload from disk
	const mainReload = await loadMask(ds, 'main');
	const altReload = await loadMask(ds, 'alt');
	check('slot files are separate on disk',
		existsSync(join(DATA_DIR, maskRelPath(ds))) &&
			existsSync(join(DATA_DIR, maskRelPath(ds, 'alt'))));
	check('slots are isolated', bytesEqual(mainReload, postBytes) && altReload[123] === 1 &&
		countMaskRange(altReload) === 1);
	check('listSlotNames finds main + alt',
		(await listSlotNames(ds)).includes('main') && (await listSlotNames(ds)).includes('alt'));

	// roles: exclude blocks target paint; source constrains; exclude > source
	const exclMask = new Uint8Array(C * R * ds.slices);
	for (let y = 12; y < 18; y++) for (let x = 12; x < 18; x++) exclMask[4 * CR + y * C + x] = 1;
	await saveMask(ds, exclMask, 'excl');
	const srcMask = new Uint8Array(C * R * ds.slices);
	for (let y = 8; y < 24; y++) for (let x = 8; x < 16; x++) srcMask[4 * CR + y * C + x] = 1;
	await saveMask(ds, srcMask, 'src');
	await setSlotRole(ds, 'excl', 'exclude');
	await setSlotRole(ds, 'src', 'source');
	await setSlotRole(ds, 'tgt', 'target');

	const tgtMask = await loadMask(ds, 'tgt');
	const c4 = await getSliceConstraint(ds, 'tgt', 4);
	paintDisc(tgtMask, ds, 'axial', 4, 15, 15, 6, 1, c4);
	const at = (x: number, y: number) => tgtMask[4 * CR + y * C + x];
	check('exclude blocks target paint (even inside source)', at(15, 15) === 0 && at(13, 13) === 0);
	check('source allows paint on its pixels', at(10, 15) === 1 && at(13, 19) === 1);
	check('outside source is blocked', at(18, 15) === 0 && at(20, 15) === 0);

	// editing a role-'none' slot ignores exclude slots (spec: only 'target')
	const noneMask = new Uint8Array(C * R * ds.slices);
	const cNone = await getSliceConstraint(ds, 'free', 4);
	paintDisc(noneMask, ds, 'axial', 4, 15, 15, 2, 1, cNone);
	check('exclude not enforced for role-none slot (source still applies)',
		noneMask[4 * CR + 15 * C + 15] === 1);

	await setSlotRole(ds, 'src', 'none'); // drop the source constraint again
	const cAfter = await getSliceConstraint(ds, 'tgt', 4);
	check('demoted source no longer constrains', cAfter.source === null);

	// =====================================================================
	// 8. LOD pipeline: half resolution, smoothing, decimation, noise
	// =====================================================================
	const lodMask = new Uint8Array(C * R * ds.slices);
	for (let k = 3; k <= 10; k++) {
		for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) lodMask[k * CR + y * C + x] = 1;
	}
	const dims: [number, number, number] = [C, R, ds.slices];
	const spacing: [number, number, number] = [0.5, 0.5, 0.5];

	const full = buildMaskMesh(lodMask, dims, spacing, {
		resolution: 'full', smoothing: 0, reduction: 0, noise: 0
	});
	const legacy = buildMaskMesh(lodMask, dims, spacing, null);
	const half = buildMaskMesh(lodMask, dims, spacing, {
		resolution: 'half', smoothing: 0, reduction: 0, noise: 0
	});
	const triFull = full.positions.length / 9;
	const triHalf = half.positions.length / 9;
	check('legacy (no lod) build unchanged', legacy.positions.length === full.positions.length);
	check('half resolution yields fewer triangles', triHalf > 0 && triHalf < triFull,
		`${triHalf} vs ${triFull}`);

	const smoothed = buildMaskMesh(lodMask, dims, spacing, {
		resolution: 'full', smoothing: 2, reduction: 0, noise: 0
	});
	let moved = false;
	for (let i = 0; i < full.positions.length; i++) {
		if (Math.abs(smoothed.positions[i] - full.positions[i]) > 1e-4) { moved = true; break; }
	}
	check('smoothing moves vertices, keeps topology',
		smoothed.positions.length === full.positions.length && moved);
	check('laplacianSmooth(0 passes) is a no-op', laplacianSmooth(full.positions, 0) === full.positions);

	const reduced = buildMaskMesh(lodMask, dims, spacing, {
		resolution: 'full', smoothing: 0, reduction: 0.7, noise: 0
	});
	const vFull = uniqueVertexCount(full.positions);
	const vRed = uniqueVertexCount(reduced.positions);
	check('decimation reduces vertex count', vRed > 0 && vRed < vFull, `${vRed} vs ${vFull}`);
	check('decimated mesh still has triangles', reduced.positions.length >= 9 &&
		reduced.positions.length % 9 === 0);

	// noise: 10-voxel blob removed, 400-voxel square kept
	const noisy = new Uint8Array(C * R * ds.slices);
	for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) noisy[5 * CR + y * C + x] = 1;
	for (let i = 0; i < 10; i++) noisy[8 * CR + 50 * C + 40 + i] = 1;
	const removed = removeSmallComponents(noisy, dims, 50);
	check('noise filter drops <50-voxel components', removed === 10 &&
		countMaskRange(noisy) === 400, `${removed} removed`);

	// =====================================================================
	// 9. LOD presets (settings-backed CRUD)
	// =====================================================================
	const baseCount = listLodPresets().length;
	const p1 = createLodPreset({ name: 'Coarse', resolution: 'half', smoothing: 1, reduction: 0.5, noise: 1, isDefault: true });
	check('create preset', p1 !== null && p1!.isDefault && p1!.resolution === 'half');
	check('create rejects bad reduction', createLodPreset({ name: 'X', reduction: 1.5 }) === null);
	const p2 = createLodPreset({ name: 'Fine', resolution: 'full', smoothing: 0, reduction: 0, noise: 0, isDefault: true });
	const list = listLodPresets();
	check('second default clears the first', list.find((p) => p.id === p1!.id)?.isDefault === false &&
		list.find((p) => p.id === p2!.id)?.isDefault === true);
	const upd = updateLodPreset(p1!.id, { name: 'Coarse 2', smoothing: 3 });
	check('update preset', upd?.name === 'Coarse 2' && upd?.smoothing === 3 && upd?.reduction === 0.5);
	check('update unknown preset fails', updateLodPreset('nope', { name: 'x' }) === null);
	check('delete presets', deleteLodPreset(p1!.id) && deleteLodPreset(p2!.id) &&
		listLodPresets().length === baseCount);
} finally {
	evictMask(ds.id);
	evictBoundaries(ds.id);
	clearHistory(ds.id);
	clearHistory(9997);
	rmSync(join(DATA_DIR, 'cases', '9998'), { recursive: true, force: true });
	if (settingsBefore) setSetting('seg_lod_presets', settingsBefore.value);
	else db.query("DELETE FROM settings WHERE key = 'seg_lod_presets'").run();
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All checks passed');
