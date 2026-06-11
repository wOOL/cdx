import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { caseRel, resolveData } from '$lib/server/db';
import { getBarrier } from '$lib/server/segBoundary';
import { diffRuns, type PatchSlice } from '$lib/server/segHistory';
import type { Dataset } from '$lib/types';

/**
 * Per-dataset binary segmentation masks: one byte per voxel (0 or 1), same
 * dims/layout as the HU volume (x fastest, then y, then z). Backs the
 * Scanview-style paint/fill editor.
 *
 * Slots: a dataset can hold several named masks ("slots"). The default slot
 * 'main' keeps the legacy file name (mask_<id>.u8) so existing data and
 * callers keep working; other slots live in mask_<id>.<slot>.u8. Each slot
 * has a role (sidecar mask_<id>.roles.json):
 *
 *   'target'  — editable; paint/fill skip pixels claimed by any exclude slot
 *   'source'  — constrains tools (of other slots) to ITS pixels
 *   'exclude' — its pixels are off-limits for target-slot edits
 *   'none'    — free segmentation (default)
 *
 * Constraint precedence: exclude > source > boundaries. An excluded pixel is
 * blocked even when inside the source region; a pixel outside the source is
 * blocked even when no boundary is near; boundary pixels themselves block
 * painting and region connectivity. Exclusion is enforced only when the slot
 * being edited has role 'target' (per spec); the source constraint applies to
 * every add-operation as long as a (different) source slot exists. Erase
 * operations are only constrained by boundaries.
 */

export type SlotRole = 'target' | 'source' | 'exclude' | 'none';

export const DEFAULT_SLOT = 'main';
const SLOT_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Validate a ?slot query value; null/'' → default slot, invalid → null. */
export function normalizeSlot(raw: string | null | undefined): string | null {
	if (raw == null || raw === '') return DEFAULT_SLOT;
	return SLOT_RE.test(raw) ? raw : null;
}

/** In-memory LRU of loaded masks, keyed by `${datasetId}:${slot}`. */
const cache = new Map<string, Uint8Array>();
const MAX_ENTRIES = 4;

function cacheKey(id: number, slot: string): string {
	return `${id}:${slot}`;
}

function remember(id: number, slot: string, mask: Uint8Array): void {
	const k = cacheKey(id, slot);
	cache.delete(k);
	cache.set(k, mask);
	while (cache.size > MAX_ENTRIES) {
		const oldest = cache.keys().next().value as string;
		cache.delete(oldest);
	}
}

/** Stored (relative) path of a dataset's mask file for a slot. */
export function maskRelPath(ds: Dataset, slot: string = DEFAULT_SLOT): string {
	const file = slot === DEFAULT_SLOT ? `mask_${ds.id}.u8` : `mask_${ds.id}.${slot}.u8`;
	return join(caseRel(ds.case_id), file);
}

/**
 * Load a dataset's mask slot. Missing (or stale, wrong-sized) files yield an
 * all-zero mask without creating anything on disk.
 */
export async function loadMask(ds: Dataset, slot: string = DEFAULT_SLOT): Promise<Uint8Array> {
	const hit = cache.get(cacheKey(ds.id, slot));
	if (hit) {
		remember(ds.id, slot, hit); // refresh LRU order
		return hit;
	}
	const size = ds.cols * ds.rows * ds.slices;
	let mask: Uint8Array | null = null;
	const file = Bun.file(resolveData(maskRelPath(ds, slot)));
	if (await file.exists()) {
		const loaded = new Uint8Array(await file.arrayBuffer());
		if (loaded.length === size) mask = loaded;
	}
	mask ??= new Uint8Array(size);
	remember(ds.id, slot, mask);
	return mask;
}

/**
 * Drop a dataset's cached masks (all slots, or just one) — e.g. after the
 * file is replaced/deleted.
 */
export function evictMask(id: number, slot?: string): void {
	if (slot != null) {
		cache.delete(cacheKey(id, slot));
		return;
	}
	for (const k of [...cache.keys()]) {
		if (k.startsWith(`${id}:`)) cache.delete(k);
	}
	roleCache.delete(id);
}

/** Persist a dataset's mask slot and keep the cache coherent. */
export async function saveMask(
	ds: Dataset,
	mask: Uint8Array,
	slot: string = DEFAULT_SLOT
): Promise<void> {
	await Bun.write(resolveData(maskRelPath(ds, slot)), mask);
	remember(ds.id, slot, mask);
}

// ---------------------------------------------------------------------------
// Slot roles & listing
// ---------------------------------------------------------------------------

function rolesRelPath(ds: Dataset): string {
	return join(caseRel(ds.case_id), `mask_${ds.id}.roles.json`);
}

const roleCache = new Map<number, Record<string, SlotRole>>();

const VALID_ROLES: readonly SlotRole[] = ['target', 'source', 'exclude', 'none'];

export async function loadSlotRoles(ds: Dataset): Promise<Record<string, SlotRole>> {
	const hit = roleCache.get(ds.id);
	if (hit) return hit;
	let roles: Record<string, SlotRole> = {};
	const file = Bun.file(resolveData(rolesRelPath(ds)));
	if (await file.exists()) {
		try {
			const raw = await file.json();
			if (raw && typeof raw === 'object') {
				for (const [name, role] of Object.entries(raw as Record<string, unknown>)) {
					if (SLOT_RE.test(name) && VALID_ROLES.includes(role as SlotRole)) {
						roles[name] = role as SlotRole;
					}
				}
			}
		} catch {
			roles = {};
		}
	}
	roleCache.set(ds.id, roles);
	return roles;
}

/**
 * Set a slot's role. Only one slot may be 'source' at a time: assigning
 * 'source' demotes any previous source slot to 'none'.
 */
export async function setSlotRole(ds: Dataset, slot: string, role: SlotRole): Promise<void> {
	const roles = { ...(await loadSlotRoles(ds)) };
	if (role === 'source') {
		for (const [name, r] of Object.entries(roles)) {
			if (r === 'source' && name !== slot) roles[name] = 'none';
		}
	}
	if (role === 'none') delete roles[slot];
	else roles[slot] = role;
	await Bun.write(resolveData(rolesRelPath(ds)), JSON.stringify(roles));
	roleCache.set(ds.id, roles);
}

/** All known slot names: 'main' ∪ mask files on disk ∪ role entries. */
export async function listSlotNames(ds: Dataset): Promise<string[]> {
	const names = new Set<string>([DEFAULT_SLOT]);
	try {
		const re = new RegExp(`^mask_${ds.id}\\.([A-Za-z0-9_-]{1,32})\\.u8$`);
		for (const f of readdirSync(resolveData(caseRel(ds.case_id)))) {
			const m = re.exec(f);
			if (m) names.add(m[1]);
		}
	} catch {
		// case dir unreadable — fall through with what we have
	}
	for (const name of Object.keys(await loadSlotRoles(ds))) names.add(name);
	return [...names].sort((a, b) => (a === DEFAULT_SLOT ? -1 : b === DEFAULT_SLOT ? 1 : a < b ? -1 : 1));
}

/** Count set voxels in [from, from+len). */
export function countMaskRange(mask: Uint8Array, from = 0, len = mask.length): number {
	let n = 0;
	const end = Math.min(mask.length, from + len);
	for (let i = from; i < end; i++) n += mask[i];
	return n;
}

// ---------------------------------------------------------------------------
// Editing constraints (boundaries + slot semantics)
// ---------------------------------------------------------------------------

export interface SliceConstraint {
	/** rasterized boundary pixels — impassable and unpaintable (C×R), or null */
	barrier: Uint8Array | null;
	/** union of exclude-slot pixels on this slice (only when editing a 'target' slot) */
	exclude: Uint8Array | null;
	/** source-slot pixels on this slice — add-ops may only set where 1 */
	source: Uint8Array | null;
}

/** Whether a pixel may be set to `value` under the constraint (see precedence above). */
export function allowedAt(
	c: SliceConstraint | null | undefined,
	p: number,
	value: 0 | 1
): boolean {
	if (!c) return true;
	if (c.barrier && c.barrier[p]) return false;
	if (value === 1) {
		if (c.exclude && c.exclude[p]) return false;
		if (c.source && !c.source[p]) return false;
	}
	return true;
}

/** Build the constraint for editing `slot` on axial slice `index`. */
export async function getSliceConstraint(
	ds: Dataset,
	slot: string,
	index: number
): Promise<SliceConstraint> {
	const CR = ds.cols * ds.rows;
	const base = index * CR;
	const roles = await loadSlotRoles(ds);
	const editRole = roles[slot] ?? 'none';

	let exclude: Uint8Array | null = null;
	if (editRole === 'target') {
		for (const [name, role] of Object.entries(roles)) {
			if (role !== 'exclude' || name === slot) continue;
			const m = await loadMask(ds, name);
			if (!exclude) exclude = new Uint8Array(CR);
			for (let i = 0; i < CR; i++) if (m[base + i]) exclude[i] = 1;
		}
	}

	let source: Uint8Array | null = null;
	const sourceName = Object.entries(roles).find(([n, r]) => r === 'source' && n !== slot)?.[0];
	if (sourceName) {
		const m = await loadMask(ds, sourceName);
		source = m.subarray(base, base + CR);
	}

	const barrier = await getBarrier(ds, index);
	return { barrier, exclude, source };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** mask = 1 where lo <= HU <= hi, else 0. Returns the count of 1s. */
export function initFromThreshold(
	vol: Int16Array,
	mask: Uint8Array,
	lo: number,
	hi: number
): number {
	let filled = 0;
	for (let i = 0; i < mask.length; i++) {
		const v = vol[i];
		if (v >= lo && v <= hi) {
			mask[i] = 1;
			filled++;
		} else {
			mask[i] = 0;
		}
	}
	return filled;
}

/**
 * Set a filled disc on an axial slice (slice pixel coords, radius in pixels,
 * clamped to the slice bounds). With a constraint, boundary pixels block the
 * brush: only the part of the disc 4-connected to the brush center (without
 * crossing a boundary) is painted, and per-pixel exclude/source rules apply.
 */
export function paintDisc(
	mask: Uint8Array,
	ds: Dataset,
	plane: 'axial',
	index: number,
	cx: number,
	cy: number,
	radiusPx: number,
	value: 0 | 1,
	constraint?: SliceConstraint | null
): void {
	void plane; // only 'axial' is supported
	if (!(radiusPx >= 0)) return;
	const C = ds.cols;
	const R = ds.rows;
	const k = Math.max(0, Math.min(ds.slices - 1, Math.trunc(index)));
	const base = k * C * R;
	const r2 = radiusPx * radiusPx;

	if (constraint?.barrier) {
		// flood the disc from its center so paint cannot jump across a boundary
		const sx = Math.max(0, Math.min(C - 1, Math.round(cx)));
		const sy = Math.max(0, Math.min(R - 1, Math.round(cy)));
		const seed = sy * C + sx;
		const inDisc = (p: number): boolean => {
			const dx = (p % C) - cx;
			const dy = ((p / C) | 0) - cy;
			return dx * dx + dy * dy <= r2;
		};
		if (!inDisc(seed) || !allowedAt(constraint, seed, value)) return;
		const visited = new Uint8Array(C * R);
		const queue: number[] = [seed];
		visited[seed] = 1;
		let head = 0;
		while (head < queue.length) {
			const p = queue[head++];
			mask[base + p] = value;
			const x = p % C;
			const cand = [
				x > 0 ? p - 1 : -1,
				x < C - 1 ? p + 1 : -1,
				p >= C ? p - C : -1,
				p < C * (R - 1) ? p + C : -1
			];
			for (const q of cand) {
				if (q < 0 || visited[q]) continue;
				visited[q] = 1;
				if (inDisc(q) && allowedAt(constraint, q, value)) queue.push(q);
			}
		}
		return;
	}

	const y0 = Math.max(0, Math.ceil(cy - radiusPx));
	const y1 = Math.min(R - 1, Math.floor(cy + radiusPx));
	for (let y = y0; y <= y1; y++) {
		const dy = y - cy;
		const span = Math.sqrt(Math.max(0, r2 - dy * dy));
		const x0 = Math.max(0, Math.ceil(cx - span));
		const x1 = Math.min(C - 1, Math.floor(cx + span));
		if (x1 < x0) continue;
		const row = base + y * C;
		if (!constraint) {
			mask.fill(value, row + x0, row + x1 + 1);
		} else {
			for (let x = x0; x <= x1; x++) {
				const p = y * C + x;
				if (allowedAt(constraint, p, value)) mask[base + p] = value;
			}
		}
	}
}

/** Safety cap on flooded region size (pixels). */
const FILL_VISIT_CAP = 4_000_000;

/**
 * BFS 4-connected flood fill on axial slice `index`: the region is the
 * connected set of pixels whose HU is within [lo, hi], starting at the seed
 * (which must itself satisfy the range, else 0 is returned). Sets
 * mask = value over the region and returns the filled pixel count.
 * A constraint blocks traversal at boundary/excluded/out-of-source pixels.
 */
export function floodFill2D(
	vol: Int16Array,
	mask: Uint8Array,
	ds: Dataset,
	index: number,
	seedX: number,
	seedY: number,
	lo: number,
	hi: number,
	value: 0 | 1,
	constraint?: SliceConstraint | null
): number {
	const C = ds.cols;
	const R = ds.rows;
	if (!Number.isInteger(index) || index < 0 || index >= ds.slices) return 0;
	const sx = Math.floor(seedX);
	const sy = Math.floor(seedY);
	if (sx < 0 || sx >= C || sy < 0 || sy >= R) return 0;

	const base = index * C * R;
	const enterable = (p: number): boolean => {
		const v = vol[base + p];
		return v >= lo && v <= hi && allowedAt(constraint, p, value);
	};

	const seed = sy * C + sx;
	if (!enterable(seed)) return 0;

	const visited = new Uint8Array(C * R);
	const queue: number[] = [seed];
	visited[seed] = 1;
	let head = 0;
	let filled = 0;

	while (head < queue.length) {
		const p = queue[head++];
		mask[base + p] = value;
		filled++;
		if (queue.length >= FILL_VISIT_CAP) break;
		const x = p % C;
		// 4-connected neighbours
		if (x > 0 && !visited[p - 1]) {
			visited[p - 1] = 1;
			if (enterable(p - 1)) queue.push(p - 1);
		}
		if (x < C - 1 && !visited[p + 1]) {
			visited[p + 1] = 1;
			if (enterable(p + 1)) queue.push(p + 1);
		}
		if (p >= C && !visited[p - C]) {
			visited[p - C] = 1;
			if (enterable(p - C)) queue.push(p - C);
		}
		if (p < C * (R - 1) && !visited[p + C]) {
			visited[p + C] = 1;
			if (enterable(p + C)) queue.push(p + C);
		}
	}
	return filled;
}

// ---------------------------------------------------------------------------
// Slice propagation (automatic segmentation)
// ---------------------------------------------------------------------------

export interface PropagateSliceResult {
	index: number;
	/** pixels newly set on this slice */
	changed: number;
	/** total set pixels on this slice after propagation */
	voxels: number;
}

/**
 * Propagate the mask region of slice `from` toward slice `to` one slice at a
 * time: on each next slice, seed with (previous slice's region ∩ HU∈[lo,hi])
 * and region-grow 4-connected within the threshold, respecting boundaries and
 * slot constraints. Growth is additive (pixels are only set, never cleared).
 * Returns per-slice results plus undo patch slices for the changed pixels.
 */
export async function propagateMask(
	ds: Dataset,
	vol: Int16Array,
	mask: Uint8Array,
	slot: string,
	from: number,
	to: number,
	lo: number,
	hi: number
): Promise<{ slices: PropagateSliceResult[]; patches: PatchSlice[] }> {
	const C = ds.cols;
	const R = ds.rows;
	const CR = C * R;
	const step = to > from ? 1 : -1;
	const results: PropagateSliceResult[] = [];
	const patches: PatchSlice[] = [];

	for (let k = from + step; step > 0 ? k <= to : k >= to; k += step) {
		const prevBase = (k - step) * CR;
		const base = k * CR;
		const constraint = await getSliceConstraint(ds, slot, k);
		const before = mask.slice(base, base + CR);

		const enterable = (p: number): boolean => {
			const v = vol[base + p];
			return v >= lo && v <= hi && allowedAt(constraint, p, 1);
		};

		const visited = new Uint8Array(CR);
		const queue: number[] = [];
		for (let p = 0; p < CR; p++) {
			if (mask[prevBase + p] && enterable(p)) {
				visited[p] = 1;
				queue.push(p);
			}
		}
		let head = 0;
		while (head < queue.length) {
			const p = queue[head++];
			mask[base + p] = 1;
			if (queue.length >= FILL_VISIT_CAP) break;
			const x = p % C;
			if (x > 0 && !visited[p - 1]) {
				visited[p - 1] = 1;
				if (enterable(p - 1)) queue.push(p - 1);
			}
			if (x < C - 1 && !visited[p + 1]) {
				visited[p + 1] = 1;
				if (enterable(p + 1)) queue.push(p + 1);
			}
			if (p >= C && !visited[p - C]) {
				visited[p - C] = 1;
				if (enterable(p - C)) queue.push(p - C);
			}
			if (p < C * (R - 1) && !visited[p + C]) {
				visited[p + C] = 1;
				if (enterable(p + C)) queue.push(p + C);
			}
		}

		const runs = diffRuns(before, mask.subarray(base, base + CR));
		let changed = 0;
		if (runs) {
			for (let i = 1; i < runs.length; i += 2) changed += runs[i];
			patches.push({ index: k, runs });
		}
		results.push({ index: k, changed, voxels: countMaskRange(mask, base, CR) });
	}

	return { slices: results, patches };
}
