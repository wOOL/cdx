import type { Dataset } from '$lib/types';
import { SliceCache } from './sliceCache';

export interface WindowPreset {
	name: string;
	wc: number;
	ww: number;
}

export const WINDOW_PRESETS: WindowPreset[] = [
	{ name: 'Bone', wc: 400, ww: 1800 },
	{ name: 'Soft tissue', wc: 50, ww: 400 },
	{ name: 'High contrast', wc: 700, ww: 3200 },
	{ name: 'Metal', wc: 1500, ww: 4000 }
];

/** Shared reactive state for one planning session (one dataset). */
export class PlanningState {
	ds: Dataset;
	slices: SliceCache;

	// crosshair position in voxel coordinates (x=col, y=row, z=slice index)
	cursor = $state({ x: 0, y: 0, z: 0 });
	wc = $state(400);
	ww = $state(1800);
	crosshairVisible = $state(true);

	constructor(ds: Dataset) {
		this.ds = ds;
		this.slices = new SliceCache(ds.id);
		this.cursor = { x: Math.floor(ds.cols / 2), y: Math.floor(ds.rows / 2), z: Math.floor(ds.slices / 2) };
		this.wc = ds.window_center || 400;
		this.ww = ds.window_width || 1800;
	}

	/** voxel → patient mm (volume-local, origin at first voxel corner) */
	toMM(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
		return { x: v.x * this.ds.spacing_x, y: v.y * this.ds.spacing_y, z: v.z * this.ds.spacing_z };
	}

	clampCursor() {
		this.cursor.x = Math.max(0, Math.min(this.ds.cols - 1, Math.round(this.cursor.x)));
		this.cursor.y = Math.max(0, Math.min(this.ds.rows - 1, Math.round(this.cursor.y)));
		this.cursor.z = Math.max(0, Math.min(this.ds.slices - 1, Math.round(this.cursor.z)));
	}
}
