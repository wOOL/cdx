import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseDir, db } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { marchingCubes } from '$lib/server/marchingCubes';
import { meshToStlBinary } from '$lib/server/stl';
import type { Model } from '$lib/types';

/** Body: { threshold: HU (default 300), downsample?: int } → creates a segmentation model (STL). */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const threshold = Number.isFinite(Number(body.threshold)) ? Number(body.threshold) : 300;
	// keep meshes manageable: full res below 320³, stride 2 above
	const maxDim = Math.max(ds.cols, ds.rows, ds.slices);
	const downsample = Math.max(1, Math.min(4, Number(body.downsample) || (maxDim > 320 ? 2 : 1)));

	const vol = await loadVolume(ds);
	const mesh = marchingCubes(
		vol,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		threshold,
		downsample
	);
	if (mesh.positions.length === 0) error(400, 'No surface at this threshold');

	const stl = meshToStlBinary(mesh.positions, `bone_${threshold}HU`);
	const dir = caseDir(ds.case_id);
	const path = join(dir, `seg_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(path, stl);

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color)
			 VALUES (?1, ?2, 'segmentation', ?3, '#d8cfc0') RETURNING *`
		)
		.get(ds.case_id, `Bone (${threshold} HU)`, path) as Model;

	return json({ model, triangles: mesh.positions.length / 9 });
};
