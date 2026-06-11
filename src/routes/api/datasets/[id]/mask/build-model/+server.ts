import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import { loadMask } from '$lib/server/segMask';
import { marchingCubes } from '$lib/server/marchingCubes';
import { meshToStlBinary } from '$lib/server/stl';
import type { Model } from '$lib/types';

/** Body: { name?: string } → mesh the mask (marching cubes) into a segmentation model (STL). */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const name =
		typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Custom segmentation';

	const mask = await loadMask(ds);
	if (!mask.includes(1)) error(400, 'Mask is empty');

	// marching cubes wants a smooth-ish scalar field: map 1 → 200, iso 100
	const scalars = new Uint8Array(mask.length);
	for (let i = 0; i < mask.length; i++) if (mask[i]) scalars[i] = 200;

	const maxDim = Math.max(ds.cols, ds.rows, ds.slices);
	const mesh = marchingCubes(
		scalars,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		100,
		maxDim <= 320 ? 1 : 2
	);
	if (mesh.positions.length === 0) error(400, 'No surface in mask');

	const stl = meshToStlBinary(mesh.positions, name);
	const path = join(caseRel(ds.case_id), `seg_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(path), stl);

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, params)
			 VALUES (?1, ?2, 'segmentation', ?3, '#cfd8c0', ?4) RETURNING *`
		)
		.get(ds.case_id, name, path, JSON.stringify({ source: 'mask', dataset_id: ds.id })) as Model;

	return json({ model, triangles: mesh.positions.length / 9 });
};
