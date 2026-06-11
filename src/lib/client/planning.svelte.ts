import type { Dataset, Plan } from '$lib/types';
import { SliceCache } from './sliceCache';
import { sampleCurve, type Vec2 } from '$lib/curve';

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

/** Shared reactive state for one planning session (one dataset + one plan). */
export class PlanningState {
	ds: Dataset;
	planId: number;
	slices: SliceCache;

	// crosshair position in voxel coordinates (x=col, y=row, z=slice index)
	cursor = $state({ x: 0, y: 0, z: 0 });
	wc = $state(400);
	ww = $state(1800);
	crosshairVisible = $state(true);

	// panoramic curve — control points in mm (volume-local), defined on axial slice curveZ
	curveControl = $state<Vec2[]>([]);
	curveZ = $state(0);
	curveEditMode = $state(false);
	panoThickness = $state(0);
	/** position along the curve (mm) for the cross-sectional view */
	crossU = $state(0);

	curve = $derived.by(() => sampleCurve(this.curveControl.map((p) => ({ ...p })), 0.5));

	constructor(ds: Dataset, plan: Plan) {
		this.ds = ds;
		this.planId = plan.id;
		this.slices = new SliceCache(ds.id);
		this.cursor = {
			x: Math.floor(ds.cols / 2),
			y: Math.floor(ds.rows / 2),
			z: Math.floor(ds.slices / 2)
		};
		this.wc = ds.window_center || 400;
		this.ww = ds.window_width || 1800;
		this.curveZ = Math.floor(ds.slices / 2);

		if (plan.pan_curve) {
			try {
				const saved = JSON.parse(plan.pan_curve);
				if (saved?.control?.length) {
					this.curveControl = saved.control;
					this.curveZ = saved.z ?? this.curveZ;
					this.cursor.z = this.curveZ;
				}
			} catch {
				// ignore corrupt curve
			}
		}
		const c = this.curve;
		if (c) this.crossU = c.length / 2;
	}

	/** voxel → mm (volume-local, origin at first voxel corner) */
	toMM(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
		return { x: v.x * this.ds.spacing_x, y: v.y * this.ds.spacing_y, z: v.z * this.ds.spacing_z };
	}

	clampCursor() {
		this.cursor.x = Math.max(0, Math.min(this.ds.cols - 1, Math.round(this.cursor.x)));
		this.cursor.y = Math.max(0, Math.min(this.ds.rows - 1, Math.round(this.cursor.y)));
		this.cursor.z = Math.max(0, Math.min(this.ds.slices - 1, Math.round(this.cursor.z)));
	}

	// ---------- persistence ----------
	private saveTimer: ReturnType<typeof setTimeout> | undefined;

	saveCurve() {
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			fetch(`/api/plans/${this.planId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					pan_curve: this.curveControl.length
						? { control: this.curveControl, z: this.curveZ }
						: null
				})
			}).catch(() => {});
		}, 400);
	}
}
