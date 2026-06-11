/**
 * Offline heuristic "AI" segmentation pipeline (SPEC §10.6, FEATURES §6).
 *
 * No network/model inference: a threshold + morphology multi-class heuristic
 * over the HU volume that mimics the AI Assistant's output set:
 *
 *   bone      — HU > 300, one binary closing pass (6-neighborhood dilate
 *               then erode) to bridge small gaps, then the largest
 *               6-connected component.
 *   teeth     — HU > 1400 components whose z-extent overlaps the bone
 *               z-range (drops metal flecks far from the jaws).
 *   soft      — HU > -300 envelope minus the bone mass.
 *   mandible / maxilla — the bone mask split at the z center-of-mass of the
 *               bone voxels (lower z = mandible: slice z grows toward the
 *               top of the head in this volume layout).
 *
 * Each class is meshed via the existing LOD pipeline at HALF resolution
 * (with noise removal and one smoothing pass) and stored as a model row
 * (kind 'segmentation', params { ai: true, class }). Rows are written even
 * for empty classes so the review dialog can show them struck-through
 * (ok = triangles > 0); unimported rows are deleted by the case page.
 *
 * Jobs run async in-process; state lives in a module-level Map keyed by
 * dataset id (POST returns { jobId } immediately, GET polls the state).
 */
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { buildMaskMesh, type LodParams } from '$lib/server/segLod';
import { meshToStlBinary } from '$lib/server/stl';
import { loadVolume } from '$lib/server/volumeCache';
import type { Dataset, Model } from '$lib/types';

export const BONE_HU = 300;
export const TEETH_HU = 1400;
export const SOFT_HU = -300;

const AI_LOD: LodParams = { resolution: 'half', smoothing: 1, reduction: 0, noise: 1 };

export interface AiSegModel {
	id: number;
	name: string;
	class: string;
	color: string;
	triangles: number;
	ok: boolean;
}

export type AiSegStatus = 'idle' | 'running' | 'done' | 'error';

interface AiJob {
	jobId: string;
	status: AiSegStatus;
	models?: AiSegModel[];
	error?: string;
}

const jobs = new Map<number, AiJob>();

export function getAiSegState(datasetId: number): {
	status: AiSegStatus;
	jobId?: string;
	models?: AiSegModel[];
	error?: string;
} {
	const j = jobs.get(datasetId);
	if (!j) return { status: 'idle' };
	return { status: j.status, jobId: j.jobId, models: j.models, error: j.error };
}

/**
 * Kick off (or join) the segmentation job for a dataset. If a job is already
 * running its jobId is returned instead of starting a second one.
 */
export function startAiSegmentation(ds: Dataset): { jobId: string } {
	const existing = jobs.get(ds.id);
	if (existing?.status === 'running') return { jobId: existing.jobId };
	const jobId = crypto.randomUUID().slice(0, 8);
	jobs.set(ds.id, { jobId, status: 'running' });
	void (async () => {
		try {
			const models = await segmentDataset(ds);
			jobs.set(ds.id, { jobId, status: 'done', models });
		} catch (e) {
			jobs.set(ds.id, {
				jobId,
				status: 'error',
				error: e instanceof Error ? e.message : 'AI segmentation failed'
			});
		}
	})();
	return { jobId };
}

// ---------------------------------------------------------------------------
// Voxel heuristics
// ---------------------------------------------------------------------------

function threshold(vol: Int16Array, lo: number): Uint8Array {
	const out = new Uint8Array(vol.length);
	for (let i = 0; i < vol.length; i++) if (vol[i] > lo) out[i] = 1;
	return out;
}

/** One 6-neighborhood binary dilation (positive) or erosion (negative). */
function morph6(mask: Uint8Array, dims: [number, number, number], dilate: boolean): Uint8Array {
	const [nx, ny, nz] = dims;
	const nxny = nx * ny;
	const out = new Uint8Array(mask.length);
	for (let z = 0; z < nz; z++) {
		for (let y = 0; y < ny; y++) {
			const row = z * nxny + y * nx;
			for (let x = 0; x < nx; x++) {
				const p = row + x;
				const self = mask[p];
				if (dilate ? self : !self) {
					out[p] = self;
					continue;
				}
				// dilate: any set neighbor sets the voxel; erode: any unset neighbor clears it
				const nb =
					(x > 0 ? mask[p - 1] : 0) ||
					(x < nx - 1 ? mask[p + 1] : 0) ||
					(y > 0 ? mask[p - nx] : 0) ||
					(y < ny - 1 ? mask[p + nx] : 0) ||
					(z > 0 ? mask[p - nxny] : 0) ||
					(z < nz - 1 ? mask[p + nxny] : 0);
				if (dilate) out[p] = nb ? 1 : 0;
				else {
					const hole =
						(x > 0 ? !mask[p - 1] : 1) ||
						(x < nx - 1 ? !mask[p + 1] : 1) ||
						(y > 0 ? !mask[p - nx] : 1) ||
						(y < ny - 1 ? !mask[p + nx] : 1) ||
						(z > 0 ? !mask[p - nxny] : 1) ||
						(z < nz - 1 ? !mask[p + nxny] : 1);
					out[p] = hole ? 0 : 1;
				}
			}
		}
	}
	return out;
}

function closing(mask: Uint8Array, dims: [number, number, number]): Uint8Array {
	return morph6(morph6(mask, dims, true), dims, false);
}

/**
 * 6-connected component pass. `keep` decides per component (given its voxel
 * list inside the shared queue) whether it survives; losers are cleared.
 */
function filterComponents(
	mask: Uint8Array,
	dims: [number, number, number],
	keep: (queue: Int32Array, size: number) => boolean
): void {
	const [nx, ny, nz] = dims;
	const nxny = nx * ny;
	const visited = new Uint8Array(mask.length);
	const queue = new Int32Array(mask.length);
	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || visited[start]) continue;
		let head = 0;
		let tail = 0;
		queue[tail++] = start;
		visited[start] = 1;
		while (head < tail) {
			const p = queue[head++];
			const x = p % nx;
			const y = ((p / nx) | 0) % ny;
			const z = (p / nxny) | 0;
			if (x > 0 && mask[p - 1] && !visited[p - 1]) (visited[p - 1] = 1), (queue[tail++] = p - 1);
			if (x < nx - 1 && mask[p + 1] && !visited[p + 1])
				(visited[p + 1] = 1), (queue[tail++] = p + 1);
			if (y > 0 && mask[p - nx] && !visited[p - nx])
				(visited[p - nx] = 1), (queue[tail++] = p - nx);
			if (y < ny - 1 && mask[p + nx] && !visited[p + nx])
				(visited[p + nx] = 1), (queue[tail++] = p + nx);
			if (z > 0 && mask[p - nxny] && !visited[p - nxny])
				(visited[p - nxny] = 1), (queue[tail++] = p - nxny);
			if (z < nz - 1 && mask[p + nxny] && !visited[p + nxny])
				(visited[p + nxny] = 1), (queue[tail++] = p + nxny);
		}
		if (!keep(queue, tail)) {
			for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
		}
	}
}

/** Keep only the largest 6-connected component. */
function largestComponent(mask: Uint8Array, dims: [number, number, number]): void {
	// first pass: find the size of the largest component
	let best = 0;
	filterComponents(mask.slice(), dims, (_q, size) => {
		if (size > best) best = size;
		return true;
	});
	if (best === 0) return;
	let kept = false;
	filterComponents(mask, dims, (_q, size) => {
		if (!kept && size === best) {
			kept = true;
			return true;
		}
		return false;
	});
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const CLASS_COLORS: Record<string, string> = {
	bone: '#cbbf9a',
	teeth: '#f4f0e4',
	soft: '#d98c7a',
	mandible: '#7fb2d9',
	maxilla: '#b58cd9'
};

const CLASS_NAMES: Record<string, string> = {
	bone: 'AI — Bone',
	teeth: 'AI — Teeth',
	soft: 'AI — Soft tissue',
	mandible: 'AI — Mandible',
	maxilla: 'AI — Maxilla'
};

async function segmentDataset(ds: Dataset): Promise<AiSegModel[]> {
	const vol = await loadVolume(ds);
	const dims: [number, number, number] = [ds.cols, ds.rows, ds.slices];
	const spacing: [number, number, number] = [ds.spacing_x, ds.spacing_y, ds.spacing_z];
	const nxny = ds.cols * ds.rows;

	// bone: threshold → closing → largest component
	const bone = closing(threshold(vol, BONE_HU), dims);
	largestComponent(bone, dims);

	// bone z statistics (extent + center of mass)
	let zMin = ds.slices;
	let zMax = -1;
	let zSum = 0;
	let boneCount = 0;
	for (let i = 0; i < bone.length; i++) {
		if (!bone[i]) continue;
		const z = (i / nxny) | 0;
		if (z < zMin) zMin = z;
		if (z > zMax) zMax = z;
		zSum += z;
		boneCount++;
	}
	const zMid = boneCount > 0 ? zSum / boneCount : ds.slices / 2;

	// teeth: bright components overlapping the bone z-range
	const teeth = threshold(vol, TEETH_HU);
	if (boneCount > 0) {
		filterComponents(teeth, dims, (queue, size) => {
			let lo = ds.slices;
			let hi = -1;
			for (let i = 0; i < size; i++) {
				const z = (queue[i] / nxny) | 0;
				if (z < lo) lo = z;
				if (z > hi) hi = z;
			}
			return hi >= zMin && lo <= zMax;
		});
	} else {
		teeth.fill(0);
	}

	// soft tissue envelope: everything denser than air/fat, minus the bone mass
	const soft = new Uint8Array(vol.length);
	for (let i = 0; i < vol.length; i++) if (vol[i] > SOFT_HU && !bone[i]) soft[i] = 1;

	// jaw split at the z center of the bone mass (higher z = superior = maxilla)
	const mandible = new Uint8Array(bone.length);
	const maxilla = new Uint8Array(bone.length);
	for (let i = 0; i < bone.length; i++) {
		if (!bone[i]) continue;
		const z = (i / nxny) | 0;
		if (z < zMid) mandible[i] = 1;
		else maxilla[i] = 1;
	}

	const classes: [string, Uint8Array][] = [
		['bone', bone],
		['teeth', teeth],
		['soft', soft],
		['mandible', mandible],
		['maxilla', maxilla]
	];

	const out: AiSegModel[] = [];
	for (const [cls, mask] of classes) {
		const mesh = buildMaskMesh(mask, dims, spacing, AI_LOD);
		const triangles = mesh.positions.length / 9;
		const name = CLASS_NAMES[cls];
		const rel = join(caseRel(ds.case_id), `ai_${cls}_${crypto.randomUUID().slice(0, 8)}.stl`);
		await Bun.write(resolveData(rel), meshToStlBinary(mesh.positions, name));
		const model = db
			.query(
				`INSERT INTO models (case_id, name, kind, file_path, color, params)
				 VALUES (?1, ?2, 'segmentation', ?3, ?4, ?5) RETURNING *`
			)
			.get(
				ds.case_id,
				name,
				rel,
				CLASS_COLORS[cls],
				JSON.stringify({ ai: true, class: cls, dataset_id: ds.id, lod: AI_LOD })
			) as Model;
		out.push({
			id: model.id,
			name,
			class: cls,
			color: CLASS_COLORS[cls],
			triangles,
			ok: triangles > 0
		});
	}
	return out;
}
