import type { Dataset, Implant, Measurement, Model, Nerve, Plan } from '$lib/types';
import { SliceCache } from './sliceCache';
import { sampleCurve, type Vec2 } from '$lib/curve';
import { add, scale, segPolylineDistance, type Vec3 } from '$lib/geometry';
import type { AbutmentSpec, SleeveSpec } from '$lib/implantLibrary';
import { dropModel } from './meshContours';

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

/** nerve point with optional per-point diameter (falls back to the nerve default) */
export type NervePoint = Vec3 & { d?: number };

export interface NerveData {
	id: number;
	name: string;
	color: string;
	diameter: number;
	points: NervePoint[];
	visible: boolean;
}

export function nervePointDiameter(n: NerveData, i: number): number {
	return n.points[i]?.d ?? n.diameter;
}

/** conservative radius for safety distance checks: the widest point */
export function nerveMaxRadius(n: NerveData): number {
	let max = n.diameter;
	for (const p of n.points) if (p.d && p.d > max) max = p.d;
	return max / 2;
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
	/** position lock: implant cannot be moved/resized; sleeve & guide stay editable */
	locked: boolean;
	sleeve: SleeveSpec | null;
	abutment: AbutmentSpec | null;
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
	/** generation parameters (segmentation threshold etc.) */
	threshold: number | null;
	/** 3D look: standard (default) | metallic | wireframe */
	shading?: 'standard' | 'metallic' | 'wireframe' | 'xray';
}

export type MeasureTool = 'none' | 'distance' | 'angle' | 'density' | 'polyline' | 'annotation' | 'auxline';

export interface MeasurementData {
	id: number;
	type: 'distance' | 'angle' | 'density' | 'polyline' | 'annotation' | 'auxline';
	points: Vec3[];
	value: number;
	label: string;
	/** user-given name, shown before the value label (renamable in the tree) */
	name: string;
}

export interface SafetyWarning {
	implantId: number;
	kind: 'nerve' | 'implant' | 'sleeve';
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

/** sleeve as a segment (bottom → top, above the implant head) */
function sleeveSegment(im: ImplantData): { a: Vec3; b: Vec3; radius: number } | null {
	if (!im.sleeve) return null;
	const s = im.sleeve;
	const axis = { x: im.ax, y: im.ay, z: im.az };
	return {
		a: add({ x: im.x, y: im.y, z: im.z }, scale(axis, -s.offset)),
		b: add({ x: im.x, y: im.y, z: im.z }, scale(axis, -(s.offset + s.height))),
		radius: s.diameter / 2
	};
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
	showImplantAxes = $state(false);
	showImplantToothNumbers = $state(false);
	/** 3D volume reconstruction visibility (hide to see only segmentations/models) */
	volumeVisible = $state(true);
	/** draw implants on top of surfaces in 3D (x-ray style) */
	implantsXray = $state(false);
	locked = $state(false);

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
	/** last added/dragged nerve point (for the point-diameter editor) */
	lastNervePoint = $state<{ nerveId: number; index: number } | null>(null);
	/** triangle count of the most recent uploadModel (import-time optimize offer) */
	lastUploadTriCount: number | null = null;
	showNervePointNumbers = $state(false);
	showCrestalPlanes = $state(false);
	showSelectionBox = $state(true);
	measureTool = $state<MeasureTool>('none');
	/** in-progress measurement points (mm) */
	pendingMeasure = $state<Vec3[]>([]);

	/** raw settings rows (read-only lookups, e.g. smooth_transitions) */
	settings: Record<string, string> = {};
	measureDecimals = $state(1);
	/** color of annotation markers/text in 2D views (settings: annotation_color) */
	annotationColor = $state('#d05050');
	/** px font size of measurement/annotation labels in 2D views (settings: label_size) */
	labelSize = $state(11);
	/** color of measurement lines in 2D views (settings: measure_color) */
	measureColor = $state('#7a8cf0');
	/** overlay line-width multiplier (settings: line_scale) */
	lineScale = $state(1);
	/** how far the dashed implant-axis extension reaches beyond head/apex, mm (settings: implant_axis_mm) */
	implantAxisExt = $state(8);
	nerveSafety = $state(NERVE_SAFETY_MM);
	implantSafety = $state(IMPLANT_SAFETY_MM);
	/** snapshot name template with {patient} {case} {view} {date} placeholders */
	snapshotScheme = '{view}_{date}';
	snapshotContext = { patient: '', caseTitle: '' };

	snapshotName(view: string): string {
		const today = new Date().toISOString().slice(0, 10);
		return (
			this.snapshotScheme
				.replaceAll('{patient}', this.snapshotContext.patient)
				.replaceAll('{case}', this.snapshotContext.caseTitle)
				.replaceAll('{view}', view)
				.replaceAll('{date}', today)
				.replace(/[^\w\-. ]+/g, '_') || view
		);
	}

	warnings = $derived.by(() => {
		const out: SafetyWarning[] = [];
		for (const im of this.implants) {
			const { head, apex } = implantSegment(im);
			for (const n of this.nerves) {
				if (n.points.length === 0) continue;
				const d = segPolylineDistance(head, apex, n.points) - im.diameter / 2 - nerveMaxRadius(n);
				if (d < this.nerveSafety) {
					out.push({ implantId: im.id, kind: 'nerve', otherId: n.id, distance: d, limit: this.nerveSafety });
				}
			}
			for (const other of this.implants) {
				if (other.id <= im.id) continue;
				const seg2 = implantSegment(other);
				const d =
					segPolylineDistance(head, apex, [seg2.head, seg2.apex]) -
					im.diameter / 2 -
					other.diameter / 2;
				if (d < this.implantSafety) {
					out.push({ implantId: im.id, kind: 'implant', otherId: other.id, distance: d, limit: this.implantSafety });
				}
				// sleeve↔sleeve collision (hard limit 0 mm)
				const s1 = sleeveSegment(im);
				const s2 = sleeveSegment(other);
				if (s1 && s2) {
					const ds = segPolylineDistance(s1.a, s1.b, [s2.a, s2.b]) - s1.radius - s2.radius;
					if (ds < 0) {
						out.push({ implantId: im.id, kind: 'sleeve', otherId: other.id, distance: ds, limit: 0 });
					}
				}
			}
		}
		return out;
	});

	/** live clearances for the selected implant (surface-to-surface, mm) */
	liveDistances = $derived.by(() => {
		const im = this.implants.find((i) => i.id === this.selectedImplantId);
		if (!im) return null;
		const { head, apex } = implantSegment(im);
		let nerve: number | null = null;
		for (const n of this.nerves) {
			if (n.points.length === 0) continue;
			const d = segPolylineDistance(head, apex, n.points) - im.diameter / 2 - nerveMaxRadius(n);
			nerve = nerve == null ? d : Math.min(nerve, d);
		}
		let implant: number | null = null;
		for (const o of this.implants) {
			if (o.id === im.id) continue;
			const s2 = implantSegment(o);
			const d =
				segPolylineDistance(head, apex, [s2.head, s2.apex]) - im.diameter / 2 - o.diameter / 2;
			implant = implant == null ? d : Math.min(implant, d);
		}
		return { nerve, implant };
	});

	constructor(
		ds: Dataset,
		plan: Plan,
		nerves: Nerve[] = [],
		implants: Implant[] = [],
		models: Model[] = [],
		measurements: Measurement[] = [],
		settings: Record<string, string> = {}
	) {
		this.ds = ds;
		this.planId = plan.id;
		this.locked = !!plan.locked;
		this.settings = settings;
		if (Number(settings.nerve_safety_mm) > 0) this.nerveSafety = Number(settings.nerve_safety_mm);
		if (Number(settings.implant_safety_mm) > 0)
			this.implantSafety = Number(settings.implant_safety_mm);
		if (settings.nerve_safety_on === '0') this.nerveSafety = 0;
		if (settings.implant_safety_on === '0') this.implantSafety = 0;
		const dec = Number(settings.measure_decimals);
		if (Number.isInteger(dec) && dec >= 0 && dec <= 3) this.measureDecimals = dec;
		if (settings.snapshot_scheme) this.snapshotScheme = settings.snapshot_scheme;
		if (/^#[0-9a-fA-F]{6}$/.test(settings.annotation_color ?? ''))
			this.annotationColor = settings.annotation_color;
		const lsz = Number(settings.label_size);
		if (Number.isFinite(lsz) && lsz >= 8 && lsz <= 20) this.labelSize = lsz;
		if (/^#[0-9a-fA-F]{6}$/.test(settings.measure_color ?? ''))
			this.measureColor = settings.measure_color;
		const lsc = Number(settings.line_scale);
		if (Number.isFinite(lsc) && lsc >= 0.5 && lsc <= 3) this.lineScale = lsc;
		const axe = Number(settings.implant_axis_mm);
		if (Number.isFinite(axe) && axe >= 0 && axe <= 30) this.implantAxisExt = axe;
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
			label: m.label,
			name: m.name ?? ''
		}));
		this.models = models.map((m) => {
			let transform: number[] | null = null;
			try {
				const t = m.transform ? JSON.parse(m.transform) : null;
				if (Array.isArray(t) && t.length === 16) transform = t;
			} catch {
				// identity
			}
			let threshold: number | null = null;
			try {
				const p = m.params ? JSON.parse(m.params) : null;
				if (p && Number.isFinite(Number(p.threshold))) threshold = Number(p.threshold);
			} catch {
				threshold = null;
			}
			let shading: ModelData['shading'];
			try {
				const p2 = m.params ? JSON.parse(m.params) : null;
				if (p2 && ['standard', 'metallic', 'wireframe', 'xray'].includes(p2.shading)) shading = p2.shading;
			} catch {
				shading = undefined;
			}
			return {
				id: m.id,
				name: m.name,
				kind: m.kind,
				color: m.color,
				opacity: m.opacity,
				visible: !!m.visible,
				transform,
				threshold,
				shading
			};
		});
		this.implants = implants.map((im) => {
			let sleeve: SleeveSpec | null = null;
			let abutment: AbutmentSpec | null = null;
			try {
				if (im.sleeve) sleeve = JSON.parse(im.sleeve);
			} catch {
				// none
			}
			try {
				if (im.abutment) abutment = JSON.parse(im.abutment);
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
				locked: !!im.locked,
				visible: !!im.visible,
				sleeve,
				abutment
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

	// ---------- undo/redo (position & shape edits on existing objects) ----------
	private undoStack: string[] = [];
	private redoStack: string[] = [];
	private undoTimer: ReturnType<typeof setTimeout> | undefined;
	canUndo = $state(false);
	canRedo = $state(false);

	private editSnapshot(): string {
		return JSON.stringify({
			curve: this.curveControl,
			curveZ: this.curveZ,
			nerves: this.nerves.map((n) => ({ id: n.id, points: n.points, diameter: n.diameter })),
			implants: this.implants.map((im) => ({
				id: im.id,
				x: im.x,
				y: im.y,
				z: im.z,
				ax: im.ax,
				ay: im.ay,
				az: im.az,
				diameter: im.diameter,
				length: im.length,
				sleeve: im.sleeve
			}))
		});
	}

	/** call before mutating — debounced so a drag becomes one undo step */
	markEdit() {
		if (this.undoTimer) return; // already captured for this burst
		const snap = this.editSnapshot();
		if (this.undoStack[this.undoStack.length - 1] !== snap) {
			this.undoStack.push(snap);
			if (this.undoStack.length > 50) this.undoStack.shift();
			this.redoStack.length = 0;
			this.canUndo = true;
			this.canRedo = false;
		}
		this.undoTimer = setTimeout(() => (this.undoTimer = undefined), 600);
	}

	private applySnapshot(json: string) {
		try {
			const s = JSON.parse(json);
			this.curveControl = s.curve ?? [];
			this.curveZ = s.curveZ ?? this.curveZ;
			this.saveCurve();
			for (const sn of s.nerves ?? []) {
				const n = this.nerves.find((n) => n.id === sn.id);
				if (n) {
					n.points = sn.points;
					n.diameter = sn.diameter;
					this.saveNerve(n.id);
				}
			}
			for (const si of s.implants ?? []) {
				const im = this.implants.find((i) => i.id === si.id);
				if (im) {
					Object.assign(im, si);
					this.saveImplant(im.id);
				}
			}
		} catch {
			// corrupt snapshot — ignore
		}
	}

	undo() {
		if (this.locked || this.undoStack.length === 0) return;
		clearTimeout(this.undoTimer);
		this.undoTimer = undefined;
		this.redoStack.push(this.editSnapshot());
		this.applySnapshot(this.undoStack.pop()!);
		this.canUndo = this.undoStack.length > 0;
		this.canRedo = true;
	}

	redo() {
		if (this.locked || this.redoStack.length === 0) return;
		this.undoStack.push(this.editSnapshot());
		this.applySnapshot(this.redoStack.pop()!);
		this.canUndo = true;
		this.canRedo = this.redoStack.length > 0;
	}

	// ---------- persistence ----------
	private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private saveFns = new Map<string, () => void>();

	/** run every pending debounced save immediately (call before invalidateAll/navigation) */
	flushSaves(): void {
		for (const [key, timer] of this.saveTimers) {
			clearTimeout(timer);
			const fn = this.saveFns.get(key);
			this.saveTimers.delete(key);
			this.saveFns.delete(key);
			fn?.();
		}
	}

	private debounced(key: string, fn: () => void, ms = 350) {
		if (this.locked) return;
		clearTimeout(this.saveTimers.get(key));
		this.saveFns.set(key, fn);
		this.saveTimers.set(
			key,
			setTimeout(() => {
				this.saveTimers.delete(key);
				this.saveFns.delete(key);
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
			points: n.points.map((p) => ({ x: p.x, y: p.y, z: p.z, ...(p.d != null ? { d: p.d } : {}) })),
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
		const data: ImplantData = {
			...body,
			id: implant.id,
			rotation: 0,
			visible: true,
			locked: false,
			sleeve: null,
			abutment: null
		};
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
		type: MeasurementData['type'],
		points: Vec3[],
		value: number,
		label: string,
		name = ''
	): Promise<void> {
		const res = await fetch(`/api/plans/${this.planId}/measurements`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ type, points, value, label, name })
		});
		if (!res.ok) return;
		const { measurement } = await res.json();
		this.measurements.push({ id: measurement.id, type, points, value, label, name });
	}

	saveMeasurement(id: number) {
		const m = this.measurements.find((m) => m.id === id);
		if (!m) return;
		const payload = {
			points: m.points.map((p) => ({ ...p })),
			value: m.value,
			label: m.label,
			name: m.name
		};
		this.debounced(`measurement:${id}`, () => {
			fetch(`/api/measurements/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			}).catch(() => {});
		});
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
		const { model, triCount } = await res.json();
		this.lastUploadTriCount = typeof triCount === 'number' ? triCount : null;
		const data: ModelData = {
			id: model.id,
			name: model.name,
			kind: model.kind,
			color: model.color,
			opacity: model.opacity,
			visible: true,
			transform: null,
			threshold: null
		};
		this.models.push(data);
		return data;
	}

	/** regenerate a segmentation mesh at a new threshold (replaces the file in place) */
	async resegmentModel(id: number, threshold: number): Promise<boolean> {
		const res = await fetch(`/api/models/${id}/resegment`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ threshold })
		}).catch(() => null);
		const ok = !!res?.ok;
		if (!ok) return false;
		const { model } = await res!.json();
		const idx = this.models.findIndex((m) => m.id === id);
		if (idx >= 0) {
			const updated: ModelData = { ...this.models[idx], name: model.name, threshold };
			// remove + re-add so 3D views drop the stale mesh and refetch the new file
			this.models.splice(idx, 1);
			setTimeout(() => this.models.splice(idx, 0, updated), 60);
		}
		return true;
	}

	saveModel(id: number) {
		const m = this.models.find((m) => m.id === id);
		if (!m) return;
		const payload = {
			name: m.name,
			color: m.color,
			opacity: m.opacity,
			visible: m.visible,
			transform: m.transform,
			shading: m.shading ?? null
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
		dropModel(id); // clear contour/mesh caches
		await fetch(`/api/models/${id}`, { method: 'DELETE' }).catch(() => {});
	}
}
