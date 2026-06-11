import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import { detectNervePath, NervePathNotFoundError } from '$lib/server/nervePath';

function isVec(v: unknown): v is { x: number; y: number; z: number } {
	if (!v || typeof v !== 'object') return false;
	const p = v as Record<string, unknown>;
	return (
		Number.isFinite(p.x as number) &&
		Number.isFinite(p.y as number) &&
		Number.isFinite(p.z as number)
	);
}

/**
 * Automatic nerve canal detection between two seed points (SPEC §6.3).
 * Body: { start: {x,y,z}, end: {x,y,z}, via?: {x,y,z}[] } in volume-local mm.
 * `via` lists intermediate markers (in order); detection routes through them
 * as waypoints — one A* per consecutive pair — like the original, instead of
 * discarding them.
 * Response: { points: {x,y,z}[], warning: string } — 422 when no path is found.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const start = body.start as unknown;
	const end = body.end as unknown;
	if (!isVec(start) || !isVec(end)) error(400, 'start and end {x,y,z} required');
	const via: { x: number; y: number; z: number }[] = Array.isArray(body.via)
		? (body.via as unknown[]).filter(isVec)
		: [];
	if (via.length > 10) error(400, 'At most 10 via points are supported');

	const data = await loadVolume(ds);
	const vol = {
		data,
		dims: { x: ds.cols, y: ds.rows, z: ds.slices },
		spacing: { x: ds.spacing_x, y: ds.spacing_y, z: ds.spacing_z }
	};

	const nodes = [start, ...via, end];
	const points: { x: number; y: number; z: number }[] = [];
	const warnings = new Set<string>();
	for (let i = 1; i < nodes.length; i++) {
		let seg;
		try {
			seg = detectNervePath(vol, nodes[i - 1], nodes[i]);
		} catch (e) {
			if (e instanceof NervePathNotFoundError) {
				error(
					422,
					via.length
						? `No nerve canal path found between marker ${i} and marker ${i + 1}`
						: 'No nerve canal path found between the seed points'
				);
			}
			throw e;
		}
		// segments share their joint marker — drop the duplicate
		points.push(...(i === 1 ? seg.points : seg.points.slice(1)));
		if (seg.warning) warnings.add(seg.warning);
	}
	return json({ points, warning: [...warnings].join('; ') });
};
