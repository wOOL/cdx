import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDataset } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';

/**
 * Bone density stats in a cylinder around an implant axis.
 * Body: { head: {x,y,z} mm, axis: {x,y,z} unit, length: mm, radius: mm }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const head = body.head as { x: number; y: number; z: number } | undefined;
	const axis = body.axis as { x: number; y: number; z: number } | undefined;
	const length = Number(body.length) || 10;
	const radius = Math.min(8, Number(body.radius) || 2);
	if (!head || !axis) error(400, 'head and axis required');

	const vol = await loadVolume(ds);
	const sx = ds.spacing_x;
	const sy = ds.spacing_y;
	const sz = ds.spacing_z;

	// bounding box of the cylinder in voxel coords
	const apex = { x: head.x + axis.x * length, y: head.y + axis.y * length, z: head.z + axis.z * length };
	const lo = {
		x: Math.max(0, Math.floor((Math.min(head.x, apex.x) - radius) / sx)),
		y: Math.max(0, Math.floor((Math.min(head.y, apex.y) - radius) / sy)),
		z: Math.max(0, Math.floor((Math.min(head.z, apex.z) - radius) / sz))
	};
	const hi = {
		x: Math.min(ds.cols - 1, Math.ceil((Math.max(head.x, apex.x) + radius) / sx)),
		y: Math.min(ds.rows - 1, Math.ceil((Math.max(head.y, apex.y) + radius) / sy)),
		z: Math.min(ds.slices - 1, Math.ceil((Math.max(head.z, apex.z) + radius) / sz))
	};

	let sum = 0;
	let count = 0;
	let min = Infinity;
	let max = -Infinity;
	const r2 = radius * radius;
	const BINS = 16;
	const binSum = new Array(BINS).fill(0);
	const binCount = new Array(BINS).fill(0);
	for (let z = lo.z; z <= hi.z; z++) {
		const pz = (z + 0.5) * sz;
		for (let y = lo.y; y <= hi.y; y++) {
			const py = (y + 0.5) * sy;
			const base = z * ds.cols * ds.rows + y * ds.cols;
			for (let x = lo.x; x <= hi.x; x++) {
				const px = (x + 0.5) * sx;
				// distance to axis segment
				const dx = px - head.x;
				const dy = py - head.y;
				const dz = pz - head.z;
				const tRaw = dx * axis.x + dy * axis.y + dz * axis.z;
				const t = tRaw < 0 ? 0 : tRaw > length ? length : tRaw;
				const cx = dx - axis.x * t;
				const cy = dy - axis.y * t;
				const cz = dz - axis.z * t;
				if (cx * cx + cy * cy + cz * cz > r2) continue;
				const v = vol[base + x];
				sum += v;
				count++;
				if (v < min) min = v;
				if (v > max) max = v;
				if (tRaw >= 0 && tRaw <= length) {
					const b = Math.min(BINS - 1, Math.floor((tRaw / length) * BINS));
					binSum[b] += v;
					binCount[b]++;
				}
			}
		}
	}

	if (count === 0) return json({ mean: 0, min: 0, max: 0, count: 0, profile: [] });
	const profile = binSum.map((s, i) => (binCount[i] ? Math.round(s / binCount[i]) : 0));
	return json({ mean: Math.round(sum / count), min, max, count, profile });
};
