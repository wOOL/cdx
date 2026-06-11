import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getCase } from '$lib/server/db/repo';
import { virtualToothTemplate } from '$lib/implantLibrary';
import { generateVirtualTooth, virtualToothTransform } from '$lib/server/virtualTooth';
import { meshToStlBinary } from '$lib/server/stl';
import type { Model } from '$lib/types';

/**
 * Place a virtual tooth (library wax-up crown) into a case as a real 3D
 * model — the "Edit teeth" planning reference. Not exportable to the guide.
 *
 * POST body: {
 *   tooth: number,                    // FDI tooth number (11–18 … 41–48)
 *   position: { x, y, z },            // volume-local mm (cervical center)
 *   scale?: number,                   // uniform scale, default 1
 *   flip?: boolean                    // 180° X-rotation (upper-jaw teeth)
 * }
 * → { model, triangles }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Invalid JSON body');

	const tooth = Number(body.tooth);
	if (!Number.isInteger(tooth) || !virtualToothTemplate(tooth)) {
		error(400, `Unknown FDI tooth ${body.tooth}`);
	}

	const p = body.position;
	if (
		!p ||
		typeof p !== 'object' ||
		![p.x, p.y, p.z].every((v: unknown) => Number.isFinite(Number(v)))
	) {
		error(400, 'position must be { x, y, z } in volume-local mm');
	}
	const position = { x: Number(p.x), y: Number(p.y), z: Number(p.z) };

	const scale = body.scale === undefined ? 1 : Number(body.scale);
	if (!Number.isFinite(scale) || scale < 0.2 || scale > 3) {
		error(400, 'scale must be a number between 0.2 and 3');
	}
	const flip = Boolean(body.flip ?? false);

	const positions = generateVirtualTooth(tooth, { scale });
	const stl = meshToStlBinary(positions, `virtual tooth ${tooth}`);
	const path = join(caseRel(caseId), `vtooth_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(path), stl);

	const transform = JSON.stringify(virtualToothTransform(position, flip));
	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, transform, params)
			 VALUES (?1, ?2, 'waxup', ?3, '#e8e4d0', ?4, ?5) RETURNING *`
		)
		.get(
			caseId,
			`Virtual tooth ${tooth}`,
			path,
			transform,
			JSON.stringify({ virtualTooth: tooth, scale, flip })
		) as Model;

	return json({ model, triangles: positions.length / 9 });
};
