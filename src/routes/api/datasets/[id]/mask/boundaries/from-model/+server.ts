import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import {
	boundariesFromMesh,
	loadBoundaries,
	saveBoundaries,
	type BoundarySet
} from '$lib/server/segBoundary';
import { parsePly, parseStl } from '$lib/server/stl';
import type { Mat4 } from '$lib/registration';
import type { Model } from '$lib/types';

/**
 * Body: { modelId: number, mode?: 'merge'|'replace' } → intersect the model's
 * (transformed) triangle mesh with every axial slice plane and import the
 * resulting contours as boundary polylines.
 *
 * mode 'merge' (default) appends the imported polylines to the existing
 * per-slice boundaries; 'replace' replaces the whole boundary set.
 * Limits: chaining of the intersection segments is approximate — open chains
 * (mesh holes, non-manifold edges) are closed with a chord and chains shorter
 * than 3 points are dropped (see segBoundary.boundariesFromMesh).
 *
 * Response: { ok: true, slices, polylines } (counts for the imported set).
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => null);
	const modelId = Number(body?.modelId);
	if (!Number.isInteger(modelId)) error(400, 'Invalid modelId');
	const mode = body?.mode ?? 'merge';
	if (mode !== 'merge' && mode !== 'replace') error(400, 'Invalid mode');

	const model = db.query('SELECT * FROM models WHERE id = ?1').get(modelId) as Model | null;
	if (!model) error(404, 'Model not found');
	if (model.case_id !== ds.case_id) error(400, 'Model belongs to another case');

	const file = Bun.file(resolveData(model.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = model.file_path.toLowerCase().endsWith('.ply')
		? (parsePly(bytes) ?? parseStl(bytes))
		: (parseStl(bytes) ?? parsePly(bytes));
	if (!parsed) error(400, 'Unsupported model file format');

	let transform: Mat4 | null = null;
	if (model.transform) {
		try {
			const t = JSON.parse(model.transform);
			if (Array.isArray(t) && t.length === 16 && t.every((v) => Number.isFinite(v))) {
				transform = t;
			}
		} catch {
			transform = null;
		}
	}

	const imported = boundariesFromMesh(parsed.positions, transform, ds);

	let merged: BoundarySet = imported;
	if (mode === 'merge') {
		merged = { ...(await loadBoundaries(ds)) };
		for (const [k, polys] of Object.entries(imported)) {
			const idx = Number(k);
			merged[idx] = [...(merged[idx] ?? []), ...polys];
		}
	}
	await saveBoundaries(ds, merged);

	let polylines = 0;
	for (const polys of Object.values(imported)) polylines += polys.length;
	return json({ ok: true, slices: Object.keys(imported).length, polylines });
};
