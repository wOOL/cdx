import type { Dataset } from '$lib/types';

/**
 * Extract bone-surface points (mm, volume-local) from the preview volume for ICP.
 * Surface = voxel ≥ threshold with at least one 6-neighbour below it.
 */
export async function extractSurfacePoints(
	ds: Dataset,
	thresholdHU = 300,
	maxPoints = 30000
): Promise<{ x: number; y: number; z: number }[]> {
	const res = await fetch(`/api/datasets/${ds.id}/preview`);
	if (!res.ok) return [];
	const cols = Number(res.headers.get('X-Cols'));
	const rows = Number(res.headers.get('X-Rows'));
	const slices = Number(res.headers.get('X-Slices'));
	const data = new Uint8Array(await res.arrayBuffer());

	// preview u8 is windowed [-1000, 3000]
	const th = Math.max(1, Math.min(254, Math.round(((thresholdHU + 1000) / 4000) * 255)));

	// preview voxel k spans full-res voxels [k*cols_f/cols ..); its center in the
	// app's mm convention (voxel i center = i*spacing) is the mean source index
	const sx = (ds.cols * ds.spacing_x) / cols;
	const sy = (ds.rows * ds.spacing_y) / rows;
	const sz = (ds.slices * ds.spacing_z) / slices;

	const pts: { x: number; y: number; z: number }[] = [];
	const cr = cols * rows;
	for (let z = 1; z < slices - 1; z++) {
		for (let y = 1; y < rows - 1; y++) {
			const base = z * cr + y * cols;
			for (let x = 1; x < cols - 1; x++) {
				const i = base + x;
				const v = data[i];
				if (v < th) continue;
				if (
					data[i - 1] < th ||
					data[i + 1] < th ||
					data[i - cols] < th ||
					data[i + cols] < th ||
					data[i - cr] < th ||
					data[i + cr] < th
				) {
					pts.push({ x: x * sx, y: y * sy, z: z * sz });
				}
			}
		}
	}

	if (pts.length > maxPoints) {
		const stride = pts.length / maxPoints;
		const sub: typeof pts = [];
		for (let i = 0; i < pts.length; i += stride) sub.push(pts[Math.floor(i)]);
		return sub;
	}
	return pts;
}
