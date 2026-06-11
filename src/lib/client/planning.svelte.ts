import type { Dataset, Implant, Measurement, Model, Nerve, Plan } from '$lib/types';
import { SliceCache } from './sliceCache';
import { sampleCurve, type Vec2 } from '$lib/curve';
import { add, scale, segPolylineDistance, type Vec3 } from '$lib/geometry';
import type { SleeveSpec } from '$lib/implantLibrary';

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

export interface NerveData {
	id: number;
	name: string;
	color: string;
	diameter: number;
	points: Vec3[];
	visible: boolean;
}

export interface ImplantData {
	id: number;
	tooth: string;
	manufacturer: string;
	line: string;
	article: string;
	diameter: number;
	length: number;
	/** head (platform) center, mm */
	x: number;
	y: number;
	z: number;
	/** unit axis head → apex */
	ax: number;
	ay: number;
	az: number;
	rotation: number;
	color: string;
	visible: boolean;
	sleeve: SleeveSpec | null;
}

export interface ModelData {
	id: number;
	name: string;
	kind: string;
	color: string;
	opacity: number;
	visible: boolean;
	/** column-major Mat4 (scan-local mm → volume-local mm) or null = identity */
	transform: number[] | null;
}

export type MeasureTool = 'none' | 'distance' | 'angle' | 'density';

export interface MeasurementData {
	id: number;
	type: 'distance' | 'angle' | 'density';
	points: Vec3[];
	value: number;
	label: string;
}

export interface SafetyWarning {
	implantId: number;
	kind: 'nerve' | 'implant';
	otherId: number;
	distance: number;
	limit: number;
}

export const NERVE_SAFETY_MM = 2.0;
export const IMPLANT_SAFETY_MM = 3.0;

function implantSegment(im: ImplantData): { head: Vec3; apex: Vec3 } {
	const head = { x: im.x, y: im.y, z: im.z };
	const apex = add(head, scale({ x: im.ax, y: im.ay, z: im.az }, im.length));
	return { head, apex };
}

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

	// objects
	nerves = $state<NerveData[]>([]);
	implants = $state<ImplantData[]>([]);
	models = $state<ModelData[]>([]);
	measurements = $state<MeasurementData[]>([]);
	activeNerveId = $state<number | null>(null);
	nerveEditMode = $state(false);
	selectedImplantId = $state<number | null>(null);
	measureTool = $state<MeasureTool>('none');
	/** in-progress measurement points (mm) */
	pendingMeasure = $state<Vec3[]>([]);

	warnings = $derived.by(() => {
		const out: SafetyWarning[] = [];
		for (const im of this.implants) {
			const { head, apex } = implantSegment(im);
			for (const n of this.nerves) {
				if (n.points.length === 0) continue;
				const d = segPolylineDistance(head, apex, n.points) - im.diameter / 2 - n.diameter / 2;
				if (d < NERVE_SAFETY_MM) {
					out.push({ implantId: im.id, kind: 'nerve', otherId: n.id, distance: d, limit: NERVE_SAFETY_MM });
				}
			}
			for (const other of this.implants) {
				if (other.id <= im.id) continue;
				const seg2 = implantSegment(other);
				const d =
					segPolylineDistance(head, apex, [seg2.head, seg2.apex]) -
					im.diameter / 2 -
					other.diameter / 2;
				if (d < IMPLANT_SAFETY_MM) {
					out.push({ implantId: im.id, kind: 'implant', otherId: other.id, distance: d, limit: IMPLANT_SAFETY_MM });
				}
			}
		}
		return out;
	});

	constructor(
		ds: Dataset,
		plan: Plan,
		nerves: Nerve[] = [],
		implants: Implant[] = [],
		models: Model[] = [],
		measurements: Measurement[] = []
	) {
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

		this.nerves = nerves.map((n) => ({
			id: n.id,
			name: n.name,
			color: n.color,
			diameter: n.diameter,
			points: JSON.parse(n.points || '[]'),
			visible: !!n.visible
		}));
		this.measurements = measurements.map((m) => ({
			id: m.id,
			type: m.type,
			points: JSON.parse(m.points || '[]'),
			value: m.value,
			label: m.label
		}));
		this.models = models.map((m) => {
			let transform: number[] | null = null;
			try {
				const t = m.transform ? JSON.parse(m.transform) : null;
				if (Array.isArray(t) && t.length === 16) transform = t;
			} catch {
				// identity
			}
			return {
				id: m.id,
				name: m.name,
				kind: m.kind,
				color: m.color,
				opacity: m.opacity,
				visible: !!m.visible,
				transform
			};
		});
		this.implants = implants.map((im) => {
			let sleeve: SleeveSpec | null = null;
			try {
				if (im.sleeve) sleeve = JSON.parse(im.sleeve);
			} catch {
				// none
			}
			return {
				id: im.id,
				tooth: im.tooth,
				manufacturer: im.manufacturer,
				line: im.line,
				article: im.article,
				diameter: im.diameter,
				length: im.length,
				x: im.x,
				y: im.y,
				z: im.z,
				ax: im.ax,
				ay: im.ay,
				az: im.az,
				rotation: im.rotation,
				color: im.color,
				visible: !!im.visible,
				sleeve
			};
		});
	}

	/** voxel → mm (volume-local, origin at first voxel corner) */
	toMM(v: { x: number; y: number; z: number }): Vec3 {
		return { x: v.x * this.ds.spacing_x, y: v.y * this.ds.spacing_y, z: v.z * this.ds.spacing_z };
	}

	clampCursor() {
		this.cursor.x = Math.max(0, Math.min(this.ds.cols - 1, Math.round(this.cursor.x)));
		this.cursor.y = Math.max(0, Math.min(this.ds.rows - 1, Math.round(this.cursor.y)));
		this.cursor.z = Math.max(0, Math.min(this.ds.slices - 1, Math.round(this.cursor.z)));
	}

	/** map a 3D point to panoramic coordinates: u along curve (mm), zmm height */
	toPano(p: Vec3): { u: number; zmm: number } | null {
		const c = this.curve;
		if (!c) return null;
		let best = Infinity;
		let bi = 0;
		for (let i = 0; i < c.points.length; i++) {
			const d = (c.points[i].x - p.x) ** 2 + (c.points[i].y - p.y) ** 2;
			if (d < best) {
				best = d;
				bi = i;
			}
		}
		return { u: c.cumLen[bi], zmm: p.z };
	}

	// ---------- persistence ----------
	private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	private debounced(key: string, fn: () => void, ms = 350) {
		clearTimeout(this.saveTimers.get(key));
		this.saveTimers.set(
			key,
			setTimeout(() => {
				this.saveTimers.delete(key);
				fn();
			}, ms)
		);
	}

	saveCurve() {
		this.debounced('curve', () => {
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

	// ---------- nerves ----------
	async addNerve(name: string, color = '#e8d44d'): Promise<NerveData | null> {
		const res = await fetch(`/api/plans/${this.planId}/nerves`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, color, diameter: 2.0, points: [] })
		});
		if (!res.ok) return null;
		const { nerve } = await res.json();
		const data: NerveData = {
			id: nerve.id,
			name: nerve.name,
			color: nerve.color,
			diameter: nerve.diameter,
			points: [],
			visible: true
		};
		this.nerves.push(data);
		this.activeNerveId = data.id;
		this.nerveEditMode = true;
		return data;
	}

	saveNerve(id: number) {
		const n = this.nerves.find((n) => n.id === id);
		if (!n) return;
		const payload = {
			name: n.name,
			color: n.color,
			diameter: n.diameter,
			points: n.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
			visible: n.visible
		};
		this.debounced(`nerve:${id}`, () => {
			fetch(`/api/nerves/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			}).catch(() => {});
		});
	}

	async deleteNerve(id: number) {
		this.nerves = this.nerves.filter((n) => n.id !== id);
		if (this.activeNerveId === id) {
			this.activeNerveId = null;
			this.nerveEditMode = false;
		}
		await fetch(`/api/nerves/${id}`, { method: 'DELETE' }).catch(() => {});
	}

	// ---------- implants ----------
	async addImplant(spec: {
		tooth: string;
		manufacturer: string;
		line: string;
		article: string;
		diameter: number;
		length: number;
		color: string;
		head: Vec3;
	}): Promise<ImplantData | null> {
		const body = {
			tooth: spec.tooth,
			manufacturer: spec.manufacturer,
			line: spec.line,
			article: spec.article,
			diameter: spec.diameter,
			length: spec.length,
			x: spec.head.x,
			y: spec.head.y,
			z: spec.head.z,
			ax: 0,
			ay: 0,
			az: -1,
			color: spec.color
		};
		const res = await fetch(`/api/plans/${this.planId}/implants`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) return null;
		const { implant } = await res.json();
		const data: ImplantData = { ...body, id: implant.id, rotation: 0, visible: true, sleeve: null };
		this.implants.push(data);
		this.selectedImplantId = data.id;
		return data;
	}

	saveImplant(id: number) {
		const im = this.implants.find((i) => i.id === id);
		if (!im) return;
		const payload = { ...im, visible: im.visible };
		this.debounced(`implant:${id}`, () => {
			fetch(`/api/implants/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			}).catch(() => {});
		});
	}

	async deleteImplant(id: number) {
		this.implants = this.implants.filter((i) => i.id !== id);
		if (this.selectedImplantId === id) this.selectedImplantId = null;
		await fetch(`/api/implants/${id}`, { method: 'DELETE' }).catch(() => {});
	}

	// ---------- measurements ----------
	async addMeasurement(
		type: 'distance' | 'angle' | 'density',
		points: Vec3[],
		value: number,
		label: string
	): Promise<void> {
		const res = await fetch(`/api/plans/${this.planId}/measurements`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type, points, value, label })
		});
		if (!res.ok) return;
		const { measurement } = await res.json();
		this.measurements.push({ id: measurement.id, type, points, value, label });
	}

	async deleteMeasurement(id: number) {
		this.measurements = this.measurements.filter((m) => m.id !== id);
		await fetch(`/api/measurements/${id}`, { method: 'DELETE' }).catch(() => {});
	}

	// ---------- models ----------
	async uploadModel(file: File, kind: string): Promise<ModelData | null> {
		const caseId = this.ds.case_id;
		const form = new FormData();
		form.append('file', file);
		form.append('kind', kind);
		form.append('name', file.name.replace(/\.(stl|ply|obj)$/i, ''));
		const res = await fetch(`/api/cases/${caseId}/models`, { method: 'POST', body: form });
		if (!res.ok) return null;
		const { model } = await res.json();
		const data: ModelData = {
			id: model.id,
			name: model.name,
			kind: model.kind,
			color: model.color,
			opacity: model.opacity,
			visible: true,
			transform: null
		};
		this.models.push(data);
		return data;
	}

	saveModel(id: number) {
		const m = this.models.find((m) => m.id === id);
		if (!m) return;
		const payload = {
			name: m.name,
			color: m.color,
			opacity: m.opacity,
			visible: m.visible,
			transform: m.transform
		};
		this.debounced(`model:${id}`, () => {
			fetch(`/api/models/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			}).catch(() => {});
		});
	}

	async deleteModel(id: number) {
		this.models = this.models.filter((m) => m.id !== id);
		await fetch(`/api/models/${id}`, { method: 'DELETE' }).catch(() => {});
	}
}
