import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { caseDir, db } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { marchingCubes } from '$lib/server/marchingCubes';
import { meshToStlBinary } from '$lib/server/stl';
import type { Model } from '$lib/types';

/** Re-run a segmentation model at a new threshold, replacing its mesh in place. */
export const POST: RequestHandler = async ({ params, request }) => {
	const model = db
		.query('SELECT * FROM models WHERE id = ?1')
		.get(Number(params.id)) as Model | null;
	if (!model || model.kind !== 'segmentation') error(404, 'Segmentation model not found');

	let oldParams: { threshold?: number; dataset_id?: number } = {};
	try {
		oldParams = model.params ? JSON.parse(model.params) : {};
	} catch {
		oldParams = {};
	}

	const body = await request.json().catch(() => ({}));
	const threshold = Number.isFinite(Number(body.threshold))
		? Number(body.threshold)
		: (oldParams.threshold ?? 300);

	// resolve the source dataset (stored at creation, else the case's first dataset)
	let ds = oldParams.dataset_id ? getDataset(oldParams.dataset_id) : null;
	if (!ds) {
		const row = db
			.query('SELECT id FROM datasets WHERE case_id = ?1 ORDER BY created_at LIMIT 1')
			.get(model.case_id) as { id: number } | null;
		ds = row ? getDataset(row.id) : null;
	}
	if (!ds) error(400, 'Source dataset not found for this segmentation');

	const vol = await loadVolume(ds);
	const maxDim = Math.max(ds.cols, ds.rows, ds.slices);
	const mesh = marchingCubes(
		vol,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		threshold,
		maxDim > 320 ? 2 : 1
	);
	if (mesh.positions.length === 0) error(400, 'No surface at this threshold');

	const path = join(caseDir(model.case_id), `seg_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(path, meshToStlBinary(mesh.positions, `bone_${threshold}HU`));
	if (model.file_path) await unlink(model.file_path).catch(() => {});

	db.query(`UPDATE models SET file_path = ?2, name = ?3, params = ?4 WHERE id = ?1`).run(
		model.id,
		path,
		`Bone (${threshold} HU)`,
		JSON.stringify({ threshold, dataset_id: ds.id })
	);
	const updated = db.query('SELECT * FROM models WHERE id = ?1').get(model.id) as Model;
	return json({ model: updated, triangles: mesh.positions.length / 9 });
};
