import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import { loadMask, normalizeSlot } from '$lib/server/segMask';
import { buildMaskMesh, getLodPreset, sanitizeLodParams, type LodParams } from '$lib/server/segLod';
import { meshToStlBinary } from '$lib/server/stl';
import type { Model } from '$lib/types';

/**
 * Body: { name?: string, lodId?: string, lod?: { resolution?, smoothing?,
 * reduction?, noise? } } → mesh the mask (marching cubes) into a segmentation
 * model (STL). ?slot=<name> selects the mask slot (default 'main').
 *
 * LOD: inline `lod` params win over `lodId` (a stored preset). Without
 * either, the legacy meshing behavior is kept unchanged (no preset is applied
 * implicitly, including the isDefault one, so existing callers see identical
 * output).
 */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	const slot = normalizeSlot(url.searchParams.get('slot'));
	if (!slot) error(400, 'Invalid slot');

	const body = await request.json().catch(() => ({}));
	const name =
		typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Custom segmentation';

	let lod: LodParams | null = null;
	if (body.lod != null) {
		lod = sanitizeLodParams(body.lod);
		if (!lod) error(400, 'Invalid lod params');
	} else if (body.lodId != null) {
		if (typeof body.lodId !== 'string') error(400, 'Invalid lodId');
		const preset = getLodPreset(body.lodId);
		if (!preset) error(404, 'LOD preset not found');
		lod = {
			resolution: preset.resolution,
			smoothing: preset.smoothing,
			reduction: preset.reduction,
			noise: preset.noise
		};
	}

	const mask = await loadMask(ds, slot);
	if (!mask.includes(1)) error(400, 'Mask is empty');

	const mesh = buildMaskMesh(
		mask,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		lod
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
		.get(
			ds.case_id,
			name,
			path,
			JSON.stringify({ source: 'mask', dataset_id: ds.id, slot, lod })
		) as Model;

	return json({ model, triangles: mesh.positions.length / 9, lod });
};
