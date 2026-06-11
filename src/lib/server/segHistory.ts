/**
 * In-memory undo/redo history for the voxel segmentation masks.
 *
 * Memory model: masks are strictly binary (0/1), so a patch only needs the
 * RUN-LENGTH ENCODED set of pixels that CHANGED — applying a patch flips
 * those pixels (XOR 1), which makes the same patch its own inverse: undo and
 * redo both just re-apply the flip. Each paint/fill/propagate records one
 * patch (possibly spanning several slices, e.g. propagate).
 *
 * Budget: at most 10 undo steps per dataset and ~50 MB of run data overall;
 * when the global cap is exceeded the globally oldest patch (by sequence
 * number, across all datasets, undo or redo side) is evicted.
 */

export interface PatchSlice {
	/** axial slice index */
	index: number;
	/** flat [startWithinSlice, length, ...] runs of flipped pixels */
	runs: Uint32Array;
}

export interface MaskPatch {
	seq: number;
	slot: string;
	slices: PatchSlice[];
	bytes: number;
}

interface History {
	undo: MaskPatch[];
	redo: MaskPatch[];
}

const MAX_STEPS = 10;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
/** fixed bookkeeping overhead charged per patch / per slice entry */
const PATCH_OVERHEAD = 64;

const histories = new Map<number, History>();
let totalBytes = 0;
let seqCounter = 0;

function history(dsId: number): History {
	let h = histories.get(dsId);
	if (!h) {
		h = { undo: [], redo: [] };
		histories.set(dsId, h);
	}
	return h;
}

/** Runs of differing pixels between two equal-length slice buffers (null = identical). */
export function diffRuns(before: Uint8Array, after: Uint8Array): Uint32Array | null {
	const n = Math.min(before.length, after.length);
	const runs: number[] = [];
	let i = 0;
	while (i < n) {
		if (before[i] !== after[i]) {
			const start = i;
			i++;
			while (i < n && before[i] !== after[i]) i++;
			runs.push(start, i - start);
		} else {
			i++;
		}
	}
	return runs.length > 0 ? Uint32Array.from(runs) : null;
}

/** Flip (XOR 1) every run of the patch in the given mask. Self-inverse. */
export function applyPatch(mask: Uint8Array, patch: MaskPatch, sliceSize: number): void {
	for (const s of patch.slices) {
		const base = s.index * sliceSize;
		const runs = s.runs;
		for (let i = 0; i + 1 < runs.length; i += 2) {
			const start = base + runs[i];
			const end = Math.min(mask.length, start + runs[i + 1]);
			for (let j = start; j < end; j++) mask[j] ^= 1;
		}
	}
}

function patchBytes(slices: PatchSlice[]): number {
	let b = PATCH_OVERHEAD;
	for (const s of slices) b += PATCH_OVERHEAD + s.runs.byteLength;
	return b;
}

/** Evict the globally oldest patch while over the byte budget. */
function evictToBudget(): void {
	while (totalBytes > MAX_TOTAL_BYTES) {
		let oldest: { list: MaskPatch[] } | null = null;
		let oldestSeq = Infinity;
		for (const h of histories.values()) {
			for (const list of [h.undo, h.redo]) {
				if (list.length > 0 && list[0].seq < oldestSeq) {
					oldestSeq = list[0].seq;
					oldest = { list };
				}
			}
		}
		if (!oldest) break;
		const removed = oldest.list.shift()!;
		totalBytes -= removed.bytes;
	}
}

/** Record a new mutation (clears the redo stack of the dataset). */
export function recordPatch(dsId: number, slot: string, slices: PatchSlice[]): void {
	if (slices.length === 0) return;
	const h = history(dsId);
	for (const p of h.redo) totalBytes -= p.bytes;
	h.redo = [];
	const patch: MaskPatch = { seq: ++seqCounter, slot, slices, bytes: patchBytes(slices) };
	h.undo.push(patch);
	totalBytes += patch.bytes;
	while (h.undo.length > MAX_STEPS) {
		totalBytes -= h.undo.shift()!.bytes;
	}
	evictToBudget();
}

/** Pop the newest undo patch and park it on the redo stack (caller applies it). */
export function popUndo(dsId: number): MaskPatch | null {
	const h = histories.get(dsId);
	const patch = h?.undo.pop();
	if (!h || !patch) return null;
	h.redo.push(patch);
	return patch;
}

/** Pop the newest redo patch and park it back on the undo stack (caller applies it). */
export function popRedo(dsId: number): MaskPatch | null {
	const h = histories.get(dsId);
	const patch = h?.redo.pop();
	if (!h || !patch) return null;
	h.undo.push(patch);
	return patch;
}

/** Drop all history for one dataset (or everything). */
export function clearHistory(dsId?: number): void {
	if (dsId == null) {
		histories.clear();
		totalBytes = 0;
		return;
	}
	const h = histories.get(dsId);
	if (!h) return;
	for (const p of h.undo) totalBytes -= p.bytes;
	for (const p of h.redo) totalBytes -= p.bytes;
	histories.delete(dsId);
}

export function historyState(dsId: number): { undo: number; redo: number } {
	const h = histories.get(dsId);
	return { undo: h?.undo.length ?? 0, redo: h?.redo.length ?? 0 };
}

/** Current total run-data bytes held (for tests/diagnostics). */
export function historyBytes(): number {
	return totalBytes;
}
