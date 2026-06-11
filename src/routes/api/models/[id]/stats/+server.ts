import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { parsePly, parseStl } from '$lib/server/stl';
import type { Model } from '$lib/types';

/**
 * Mesh properties for the model-tree "Properties" readout (desktop guide
 * visualization: triangle count + volume): triangles, watertight signed
 * volume (ml), bounding-box dimensions (mm).
 */
export const GET: RequestHandler = async ({ params }) => {
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	const bytes = new Uint8Array(await Bun.file(resolveData(m.file_path)).arrayBuffer());
	const parsed = parseStl(bytes) ?? parsePly(bytes);
	if (!parsed) error(415, 'Unsupported mesh format');
	const p = parsed.positions;
	const triangles = Math.floor(p.length / 9);

	let vol6 = 0; // 6 × signed volume via divergence theorem
	let area = 0;
	let minX = Infinity,
		minY = Infinity,
		minZ = Infinity,
		maxX = -Infinity,
		maxY = -Infinity,
		maxZ = -Infinity;
	for (let i = 0; i + 8 < p.length; i += 9) {
		const ax = p[i],
			ay = p[i + 1],
			az = p[i + 2],
			bx = p[i + 3],
			by = p[i + 4],
			bz = p[i + 5],
			cx = p[i + 6],
			cy = p[i + 7],
			cz = p[i + 8];
		vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
		{
			const ux = bx - ax,
				uy = by - ay,
				uz = bz - az,
				vx = cx - ax,
				vy = cy - ay,
				vz = cz - az;
			const cxn = uy * vz - uz * vy,
				cyn = uz * vx - ux * vz,
				czn = ux * vy - uy * vx;
			area += Math.hypot(cxn, cyn, czn) / 2;
		}
		for (const [x, y, z] of [
			[ax, ay, az],
			[bx, by, bz],
			[cx, cy, cz]
		] as const) {
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (z < minZ) minZ = z;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			if (z > maxZ) maxZ = z;
		}
	}
	const volumeMm3 = Math.abs(vol6) / 6;
	return json({
		triangles,
		points: triangles * 3,
		surfaceMm2: area,
		volumeMl: volumeMm3 / 1000,
		size: triangles
			? { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
			: { x: 0, y: 0, z: 0 }
	});
};
