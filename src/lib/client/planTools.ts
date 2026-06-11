/**
 * Overlay rendering + pointer tools for nerves and implants across the
 * planning views (axial / panoramic / cross-section).
 * All domain math in volume-local mm.
 */
import type { ViewTransform, ReconInfo, ToolPointerEvent } from './render2d';
import type { PlanningState, ImplantData } from './planning.svelte';
import { indexAtLength } from '$lib/curve';
import { dot, len, norm, sub, type Vec3 } from '$lib/geometry';

// ---------------- shared drawing ----------------

function drawImplantGlyph(
	ctx: CanvasRenderingContext2D,
	head: { x: number; y: number },
	apex: { x: number; y: number },
	halfWidthPx: number,
	color: string,
	selected: boolean,
	warning: boolean,
	opts?: { crestal?: boolean; selectionBox?: boolean }
) {
	const dx = apex.x - head.x;
	const dy = apex.y - head.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;

	const c = warning ? '#d05050' : color;
	ctx.beginPath();
	ctx.moveTo(head.x + nx * halfWidthPx, head.y + ny * halfWidthPx);
	ctx.lineTo(apex.x + nx * halfWidthPx * 0.62, apex.y + ny * halfWidthPx * 0.62);
	ctx.lineTo(apex.x - nx * halfWidthPx * 0.62, apex.y - ny * halfWidthPx * 0.62);
	ctx.lineTo(head.x - nx * halfWidthPx, head.y - ny * halfWidthPx);
	ctx.closePath();
	ctx.fillStyle = c + '55';
	ctx.fill();
	ctx.strokeStyle = c;
	ctx.lineWidth = selected ? 2 : 1.2;
	ctx.stroke();

	// platform line
	ctx.beginPath();
	ctx.moveTo(head.x + nx * halfWidthPx, head.y + ny * halfWidthPx);
	ctx.lineTo(head.x - nx * halfWidthPx, head.y - ny * halfWidthPx);
	ctx.lineWidth = 2.5;
	ctx.stroke();

	if (opts?.crestal) {
		// crestal plane: extended platform-level line perpendicular to the axis
		ctx.strokeStyle = '#e8d44d';
		ctx.setLineDash([5, 3]);
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(head.x + nx * halfWidthPx * 2.6, head.y + ny * halfWidthPx * 2.6);
		ctx.lineTo(head.x - nx * halfWidthPx * 2.6, head.y - ny * halfWidthPx * 2.6);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	if (selected && opts?.selectionBox !== false) {
		const pad = 6;
		const minX = Math.min(head.x, apex.x) - halfWidthPx - pad;
		const maxX = Math.max(head.x, apex.x) + halfWidthPx + pad;
		const minY = Math.min(head.y, apex.y) - halfWidthPx - pad;
		const maxY = Math.max(head.y, apex.y) + halfWidthPx + pad;
		ctx.strokeStyle = '#f08a24';
		ctx.setLineDash([4, 3]);
		ctx.lineWidth = 1;
		ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
		ctx.setLineDash([]);
	}

	if (selected) {
		for (const p of [head, apex]) {
			ctx.beginPath();
			ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
			ctx.fillStyle = '#f08a24';
			ctx.fill();
			ctx.strokeStyle = '#0b0d10';
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}
}

function implantApex(im: ImplantData): Vec3 {
	return {
		x: im.x + im.ax * im.length,
		y: im.y + im.ay * im.length,
		z: im.z + im.az * im.length
	};
}

/** sleeve bottom/top 3D positions (above the implant head, against the axis) */
export function sleeveEnds(im: ImplantData): { bottom: Vec3; top: Vec3 } | null {
	if (!im.sleeve) return null;
	const s = im.sleeve;
	return {
		bottom: { x: im.x - im.ax * s.offset, y: im.y - im.ay * s.offset, z: im.z - im.az * s.offset },
		top: {
			x: im.x - im.ax * (s.offset + s.height),
			y: im.y - im.ay * (s.offset + s.height),
			z: im.z - im.az * (s.offset + s.height)
		}
	};
}

/** abutment ends: shoulder (= head) → top, mm */
export function abutmentEnds(im: ImplantData): { top: Vec3 } | null {
	if (!im.abutment) return null;
	const h = im.abutment.height;
	return {
		top: { x: im.x - im.ax * h, y: im.y - im.ay * h, z: im.z - im.az * h }
	};
}

function drawAbutmentGlyph(
	ctx: CanvasRenderingContext2D,
	shoulder: { x: number; y: number },
	top: { x: number; y: number },
	halfWidthPx: number,
	angled: boolean,
	selected: boolean
) {
	const dx = top.x - shoulder.x;
	const dy = top.y - shoulder.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;
	ctx.beginPath();
	if (angled) {
		// bent profile: straight lower half, kinked upper half
		const mid = { x: shoulder.x + dx * 0.5, y: shoulder.y + dy * 0.5 };
		const kx = mid.x + dx * 0.5 - nx * halfWidthPx * 1.1;
		const ky = mid.y + dy * 0.5 - ny * halfWidthPx * 1.1;
		ctx.moveTo(shoulder.x + nx * halfWidthPx, shoulder.y + ny * halfWidthPx);
		ctx.lineTo(mid.x + nx * halfWidthPx * 0.8, mid.y + ny * halfWidthPx * 0.8);
		ctx.lineTo(kx + nx * halfWidthPx * 0.6, ky + ny * halfWidthPx * 0.6);
		ctx.lineTo(kx - nx * halfWidthPx * 0.6, ky - ny * halfWidthPx * 0.6);
		ctx.lineTo(mid.x - nx * halfWidthPx * 0.8, mid.y - ny * halfWidthPx * 0.8);
		ctx.lineTo(shoulder.x - nx * halfWidthPx, shoulder.y - ny * halfWidthPx);
	} else {
		ctx.moveTo(shoulder.x + nx * halfWidthPx, shoulder.y + ny * halfWidthPx);
		ctx.lineTo(top.x + nx * halfWidthPx * 0.7, top.y + ny * halfWidthPx * 0.7);
		ctx.lineTo(top.x - nx * halfWidthPx * 0.7, top.y - ny * halfWidthPx * 0.7);
		ctx.lineTo(shoulder.x - nx * halfWidthPx, shoulder.y - ny * halfWidthPx);
	}
	ctx.closePath();
	ctx.fillStyle = 'rgba(196, 168, 220, 0.35)';
	ctx.fill();
	ctx.strokeStyle = selected ? '#d8c2f0' : '#b59ad4';
	ctx.lineWidth = selected ? 1.8 : 1.2;
	ctx.stroke();
}

function drawSleeveGlyph(
	ctx: CanvasRenderingContext2D,
	bottom: { x: number; y: number },
	top: { x: number; y: number },
	halfWidthPx: number,
	selected: boolean
) {
	const dx = top.x - bottom.x;
	const dy = top.y - bottom.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;
	ctx.strokeStyle = selected ? '#bfe2f2' : '#9ab8c8';
	ctx.lineWidth = selected ? 2 : 1.4;
	ctx.beginPath();
	// two walls + caps
	ctx.moveTo(bottom.x + nx * halfWidthPx, bottom.y + ny * halfWidthPx);
	ctx.lineTo(top.x + nx * halfWidthPx, top.y + ny * halfWidthPx);
	ctx.lineTo(top.x - nx * halfWidthPx, top.y - ny * halfWidthPx);
	ctx.lineTo(bottom.x - nx * halfWidthPx, bottom.y - ny * halfWidthPx);
	ctx.closePath();
	ctx.stroke();
}

function warningIds(ps: PlanningState): Set<number> {
	const ids = new Set<number>();
	for (const w of ps.warnings) {
		ids.add(w.implantId);
		if (w.kind === 'implant') ids.add(w.otherId);
	}
	return ids;
}

// ---------------- panoramic view ----------------

function panoMap(ps: PlanningState, t: ViewTransform, info: ReconInfo) {
	const sz = ps.ds.spacing_z;
	return {
		toCanvas(u: number, zmm: number) {
			const px = u / info.stepMM;
			const py = info.height - 1 - zmm / sz;
			return { x: t.ox + (px + 0.5) * t.scaleX, y: t.oy + (py + 0.5) * t.scaleY };
		},
		pxPerMMx: t.scaleX / info.stepMM,
		pxPerMMy: t.scaleY / sz
	};
}

export function drawPanoOverlay(
	ps: PlanningState,
	ctx: CanvasRenderingContext2D,
	t: ViewTransform,
	info: ReconInfo
) {
	const map = panoMap(ps, t, info);

	// nerves
	for (const n of ps.nerves) {
		if (!n.visible || n.points.length === 0) continue;
		const pts = n.points
			.map((p) => {
				const pc = ps.toPano(p);
				return pc ? map.toCanvas(pc.u, pc.zmm) : null;
			})
			.filter(Boolean) as { x: number; y: number }[];
		if (pts.length === 0) continue;

		const active = ps.activeNerveId === n.id && ps.nerveEditMode;
		ctx.strokeStyle = n.color;
		ctx.lineWidth = Math.max(1.5, n.diameter * map.pxPerMMy * 0.9);
		ctx.globalAlpha = 0.55;
		ctx.beginPath();
		pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
		ctx.stroke();
		ctx.globalAlpha = 1;
		pts.forEach((p, pi) => {
			ctx.beginPath();
			ctx.arc(p.x, p.y, active ? 4 : 2.5, 0, Math.PI * 2);
			ctx.fillStyle = n.color;
			ctx.fill();
			if (active) {
				ctx.strokeStyle = '#0b0d10';
				ctx.lineWidth = 1;
				ctx.stroke();
			}
			if (ps.showNervePointNumbers) {
				ctx.fillStyle = '#fff';
				ctx.font = '9px sans-serif';
				ctx.fillText(String(pi + 1), p.x + 5, p.y - 4);
			}
		});

		// while editing: live segment lengths (placement guidance, 5–10 mm spacing)
		if (active && n.points.length >= 2) {
			ctx.font = '9px sans-serif';
			for (let i = 1; i < n.points.length; i++) {
				const a3 = n.points[i - 1];
				const b3 = n.points[i];
				const mm = Math.hypot(b3.x - a3.x, b3.y - a3.y, b3.z - a3.z);
				const a2 = pts[i - 1];
				const b2 = pts[i];
				if (!a2 || !b2) continue;
				const mx = (a2.x + b2.x) / 2;
				const my = (a2.y + b2.y) / 2;
				ctx.fillStyle = mm > 10.5 ? 'rgba(240, 138, 36, 0.95)' : 'rgba(216, 220, 228, 0.85)';
				ctx.fillText(`${mm.toFixed(1)}`, mx + 4, my - 3);
			}
		}
	}

	// implants
	const warns = warningIds(ps);
	for (const im of ps.implants) {
		if (!im.visible) continue;
		const h = ps.toPano({ x: im.x, y: im.y, z: im.z });
		const a = ps.toPano(implantApex(im));
		if (!h || !a) continue;
		drawImplantGlyph(
			ctx,
			map.toCanvas(h.u, h.zmm),
			map.toCanvas(a.u, a.zmm),
			(im.diameter / 2) * map.pxPerMMx,
			im.color,
			ps.selectedImplantId === im.id,
			warns.has(im.id)
		,
			{ crestal: ps.showCrestalPlanes, selectionBox: ps.showSelectionBox }
		);
		if (ps.showImplantAxes) {
			const ext1 = ps.toPano({ x: im.x - im.ax * 8, y: im.y - im.ay * 8, z: im.z - im.az * 8 });
			const apex3 = implantApex(im);
			const ext2 = ps.toPano({
				x: apex3.x + im.ax * 8,
				y: apex3.y + im.ay * 8,
				z: apex3.z + im.az * 8
			});
			if (ext1 && ext2) {
				const q1 = map.toCanvas(ext1.u, ext1.zmm);
				const q2 = map.toCanvas(ext2.u, ext2.zmm);
				ctx.strokeStyle = im.color;
				ctx.setLineDash([3, 4]);
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(q1.x, q1.y);
				ctx.lineTo(q2.x, q2.y);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
		const se = sleeveEnds(im);
		if (se && im.sleeve) {
			const b = ps.toPano(se.bottom);
			const tp = ps.toPano(se.top);
			if (b && tp) {
				drawSleeveGlyph(
					ctx,
					map.toCanvas(b.u, b.zmm),
					map.toCanvas(tp.u, tp.zmm),
					(im.sleeve.diameter / 2) * map.pxPerMMx,
					ps.selectedImplantId === im.id
				);
			}
		}
		const ae = abutmentEnds(im);
		if (ae && im.abutment) {
			const tp = ps.toPano(ae.top);
			if (h && tp) {
				drawAbutmentGlyph(
					ctx,
					map.toCanvas(h.u, h.zmm),
					map.toCanvas(tp.u, tp.zmm),
					(im.abutment.diameter / 2) * map.pxPerMMx,
					im.abutment.type === 'angled',
					ps.selectedImplantId === im.id
				);
			}
		}
	}
}

interface PanoToolEvent {
	type: 'down' | 'move' | 'up';
	u: number;
	zmm: number;
	native: PointerEvent;
}

type DragKind = 'none' | 'nerve-point' | 'implant-body' | 'implant-head' | 'implant-apex';
/** set when the active nerve-point drag started by appending a new point */
let nervePointAppended = false;

let panoDrag: { kind: DragKind; index: number; implantId: number; lastU: number; lastZ: number } = {
	kind: 'none',
	index: -1,
	implantId: -1,
	lastU: 0,
	lastZ: 0
};

/** 3D position of a pano click: point on curve at u, height zmm */
function panoTo3D(ps: PlanningState, u: number, zmm: number): Vec3 | null {
	const c = ps.curve;
	if (!c) return null;
	const i = indexAtLength(c, Math.max(0, Math.min(c.length, u)));
	return { x: c.points[i].x, y: c.points[i].y, z: zmm };
}

export function panoTool(ps: PlanningState, e: PanoToolEvent): boolean {
	const c = ps.curve;
	if (!c || ps.locked) return false;

	// --- nerve editing has priority when active ---
	if (ps.nerveEditMode && ps.activeNerveId != null) {
		const nerve = ps.nerves.find((n) => n.id === ps.activeNerveId);
		if (!nerve) return false;
		if (e.type === 'down') {
			ps.markEdit();
			// near an existing point → drag it, else append
			let near = -1;
			nerve.points.forEach((p, i) => {
				const pc = ps.toPano(p);
				if (pc && Math.hypot(pc.u - e.u, pc.zmm - e.zmm) < 1.6) near = i;
			});
			if (near >= 0) {
				panoDrag = { kind: 'nerve-point', index: near, implantId: -1, lastU: e.u, lastZ: e.zmm };
				nervePointAppended = false;
			} else {
				const p3 = panoTo3D(ps, e.u, e.zmm);
				if (!p3) return false;
				nerve.points.push(p3);
				panoDrag = {
					kind: 'nerve-point',
					index: nerve.points.length - 1,
					implantId: -1,
					lastU: e.u,
					lastZ: e.zmm
				};
				nervePointAppended = true;
				ps.saveNerve(nerve.id);
			}
			ps.lastNervePoint = { nerveId: nerve.id, index: panoDrag.index };
			return true;
		}
		if (e.type === 'move' && panoDrag.kind === 'nerve-point') {
			const p3 = panoTo3D(ps, e.u, e.zmm);
			if (p3 && nerve.points[panoDrag.index]) {
				nerve.points[panoDrag.index] = { ...p3, d: nerve.points[panoDrag.index].d };
				ps.saveNerve(nerve.id);
			}
			return true;
		}
		if (e.type === 'up') {
			// center the other views on a freshly placed point (like the original)
			if (panoDrag.kind === 'nerve-point' && nervePointAppended) {
				const pt = nerve.points[panoDrag.index];
				if (pt) {
					ps.cursor.x = Math.round(pt.x / ps.ds.spacing_x);
					ps.cursor.y = Math.round(pt.y / ps.ds.spacing_y);
					ps.cursor.z = Math.max(
						0,
						Math.min(ps.ds.slices - 1, Math.round(pt.z / ps.ds.spacing_z))
					);
				}
				nervePointAppended = false;
			}
			panoDrag.kind = 'none';
			return true;
		}
		return false;
	}

	// --- implant selection / manipulation ---
	if (e.type === 'down') {
		for (const im of ps.implants) {
			if (!im.visible) continue;
			const h = ps.toPano({ x: im.x, y: im.y, z: im.z });
			const a = ps.toPano(implantApex(im));
			if (!h || !a) continue;
			const dHead = Math.hypot(h.u - e.u, h.zmm - e.zmm);
			const dApex = Math.hypot(a.u - e.u, a.zmm - e.zmm);
			const isSelected = ps.selectedImplantId === im.id;
			if (isSelected && dHead < 1.8) {
				ps.markEdit();
				panoDrag = { kind: 'implant-head', index: -1, implantId: im.id, lastU: e.u, lastZ: e.zmm };
				return true;
			}
			if (isSelected && dApex < 1.8) {
				ps.markEdit();
				panoDrag = { kind: 'implant-apex', index: -1, implantId: im.id, lastU: e.u, lastZ: e.zmm };
				return true;
			}
			// distance from point to implant body segment in pano space
			const bodyDist = pointSegDist(e.u, e.zmm, h.u, h.zmm, a.u, a.zmm);
			if (bodyDist < im.diameter / 2 + 1) {
				ps.markEdit();
				ps.selectedImplantId = im.id;
				panoDrag = { kind: 'implant-body', index: -1, implantId: im.id, lastU: e.u, lastZ: e.zmm };
				return true;
			}
		}
		return false;
	}
	if (e.type === 'move' && panoDrag.kind.startsWith('implant')) {
		const im = ps.implants.find((i) => i.id === panoDrag.implantId);
		if (!im) return true;
		const du = e.u - panoDrag.lastU;
		const dz = e.zmm - panoDrag.lastZ;
		const ci = indexAtLength(c, Math.max(0, Math.min(c.length, e.u)));
		const tan = c.tangents[ci];
		if (panoDrag.kind === 'implant-body') {
			im.x += tan.x * du;
			im.y += tan.y * du;
			im.z += dz;
		} else {
			// rotate: move head or apex toward the drag point (in tangent-z plane)
			const head: Vec3 = { x: im.x, y: im.y, z: im.z };
			const apex = implantApex(im);
			if (panoDrag.kind === 'implant-head') {
				const nh: Vec3 = { x: head.x + tan.x * du, y: head.y + tan.y * du, z: head.z + dz };
				const axis = norm(sub(apex, nh));
				im.x = nh.x;
				im.y = nh.y;
				im.z = nh.z;
				im.ax = axis.x;
				im.ay = axis.y;
				im.az = axis.z;
			} else {
				const na: Vec3 = { x: apex.x + tan.x * du, y: apex.y + tan.y * du, z: apex.z + dz };
				const axis = norm(sub(na, head));
				im.ax = axis.x;
				im.ay = axis.y;
				im.az = axis.z;
			}
		}
		panoDrag.lastU = e.u;
		panoDrag.lastZ = e.zmm;
		ps.saveImplant(im.id);
		return true;
	}
	if (e.type === 'up' && panoDrag.kind !== 'none') {
		panoDrag.kind = 'none';
		return true;
	}
	return false;
}

// ---------------- cross-section view ----------------

export function crossFrame(ps: PlanningState, u?: number) {
	const c = ps.curve;
	if (!c) return null;
	const ci = indexAtLength(c, u ?? ps.crossU);
	return {
		origin: c.points[ci],
		normal: c.normals[ci], // in-plane horizontal axis
		tangent: c.tangents[ci] // plane normal
	};
}

function crossMap(ps: PlanningState, t: ViewTransform, info: ReconInfo) {
	const sz = ps.ds.spacing_z;
	return {
		toCanvas(w: number, zmm: number) {
			const px = w / info.stepMM + (info.width - 1) / 2;
			const py = info.height - 1 - zmm / sz;
			return { x: t.ox + (px + 0.5) * t.scaleX, y: t.oy + (py + 0.5) * t.scaleY };
		},
		pxPerMMx: t.scaleX / info.stepMM,
		pxPerMMy: t.scaleY / sz
	};
}

/** project a 3D point into the section plane coords (w = along normal, v = out-of-plane, zmm) */
function projectToSection(
	frame: NonNullable<ReturnType<typeof crossFrame>>,
	p: Vec3
): { w: number; v: number; zmm: number } {
	const dx = p.x - frame.origin.x;
	const dy = p.y - frame.origin.y;
	return {
		w: dx * frame.normal.x + dy * frame.normal.y,
		v: dx * frame.tangent.x + dy * frame.tangent.y,
		zmm: p.z
	};
}

export interface SectionFrame {
	origin: { x: number; y: number };
	normal: { x: number; y: number };
	tangent: { x: number; y: number };
}

export function drawCrossOverlay(
	ps: PlanningState,
	ctx: CanvasRenderingContext2D,
	t: ViewTransform,
	info: ReconInfo,
	atU?: number,
	frameOverride?: SectionFrame
) {
	const frame = frameOverride ?? crossFrame(ps, atU);
	if (!frame) return;
	const map = crossMap(ps, t, info);

	// nerves: segment intersections with the plane
	for (const n of ps.nerves) {
		if (!n.visible || n.points.length === 0) continue;
		const proj = n.points.map((p) => projectToSection(frame, p));
		for (let i = 0; i < proj.length; i++) {
			const isCrossing =
				i < proj.length - 1 && Math.sign(proj[i].v) !== Math.sign(proj[i + 1].v);
			const isNear = Math.abs(proj[i].v) < 1.5;
			if (!isCrossing && !isNear) continue;
			let q = proj[i];
			let dmm = n.points[i].d ?? n.diameter;
			if (isCrossing) {
				const f = Math.abs(proj[i].v) / (Math.abs(proj[i].v) + Math.abs(proj[i + 1].v) || 1);
				q = {
					w: proj[i].w + (proj[i + 1].w - proj[i].w) * f,
					v: 0,
					zmm: proj[i].zmm + (proj[i + 1].zmm - proj[i].zmm) * f
				};
				const d2 = n.points[i + 1].d ?? n.diameter;
				dmm = dmm + (d2 - dmm) * f;
			}
			const pc = map.toCanvas(q.w, q.zmm);
			ctx.beginPath();
			ctx.arc(pc.x, pc.y, Math.max(2.5, (dmm / 2) * map.pxPerMMx), 0, Math.PI * 2);
			ctx.strokeStyle = n.color;
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.fillStyle = n.color + '44';
			ctx.fill();
		}
	}

	// implants: silhouette if near the plane
	const warns = warningIds(ps);
	for (const im of ps.implants) {
		if (!im.visible) continue;
		const h = projectToSection(frame, { x: im.x, y: im.y, z: im.z });
		const a = projectToSection(frame, implantApex(im));
		if (Math.min(Math.abs(h.v), Math.abs(a.v)) > 10) continue;
		const far = Math.min(Math.abs(h.v), Math.abs(a.v)) > 2;
		ctx.globalAlpha = far ? 0.35 : 1;
		drawImplantGlyph(
			ctx,
			map.toCanvas(h.w, h.zmm),
			map.toCanvas(a.w, a.zmm),
			(im.diameter / 2) * map.pxPerMMx,
			im.color,
			ps.selectedImplantId === im.id,
			warns.has(im.id)
		,
			{ crestal: ps.showCrestalPlanes, selectionBox: ps.showSelectionBox }
		);
		const se = sleeveEnds(im);
		if (se && im.sleeve) {
			const b = projectToSection(frame, se.bottom);
			const tp = projectToSection(frame, se.top);
			drawSleeveGlyph(
				ctx,
				map.toCanvas(b.w, b.zmm),
				map.toCanvas(tp.w, tp.zmm),
				(im.sleeve.diameter / 2) * map.pxPerMMx,
				ps.selectedImplantId === im.id
			);
		}
		const ae = abutmentEnds(im);
		if (ae && im.abutment) {
			const tp = projectToSection(frame, ae.top);
			drawAbutmentGlyph(
				ctx,
				map.toCanvas(h.w, h.zmm),
				map.toCanvas(tp.w, tp.zmm),
				(im.abutment.diameter / 2) * map.pxPerMMx,
				im.abutment.type === 'angled',
				ps.selectedImplantId === im.id
			);
		}
		ctx.globalAlpha = 1;
	}
}

interface CrossToolEvent {
	type: 'down' | 'move' | 'up';
	w: number;
	zmm: number;
	native: PointerEvent;
}

let crossDrag: { kind: DragKind; implantId: number; lastW: number; lastZ: number } = {
	kind: 'none',
	implantId: -1,
	lastW: 0,
	lastZ: 0
};
/** active nerve-point drag in the cross-section view */
let crossNerveDrag: { index: number; lastW: number; lastZ: number } | null = null;

function crossTo3D(ps: PlanningState, w: number, zmm: number): Vec3 | null {
	const frame = crossFrame(ps);
	if (!frame) return null;
	return {
		x: frame.origin.x + frame.normal.x * w,
		y: frame.origin.y + frame.normal.y * w,
		z: zmm
	};
}

export function crossTool(ps: PlanningState, e: CrossToolEvent): boolean {
	const frame = crossFrame(ps);
	if (!frame || ps.locked) return false;

	// nerve point placement (click or click-drag) + drag-correction of existing points
	if (ps.nerveEditMode && ps.activeNerveId != null) {
		const nerve = ps.nerves.find((n) => n.id === ps.activeNerveId);
		if (!nerve) return false;
		if (e.type === 'down') {
			// near an existing point in this section → drag it instead of appending
			let near = -1;
			nerve.points.forEach((p, i) => {
				const s = projectToSection(frame, p);
				if (Math.abs(s.v) < 5 && Math.hypot(s.w - e.w, s.zmm - e.zmm) < 2) near = i;
			});
			ps.markEdit();
			if (near < 0) {
				const p3 = crossTo3D(ps, e.w, e.zmm);
				if (!p3) return false;
				nerve.points.push(p3);
				near = nerve.points.length - 1;
				ps.saveNerve(nerve.id);
			}
			crossNerveDrag = { index: near, lastW: e.w, lastZ: e.zmm };
			ps.lastNervePoint = { nerveId: nerve.id, index: near };
			return true;
		}
		if (e.type === 'move' && crossNerveDrag) {
			const p = nerve.points[crossNerveDrag.index];
			if (p) {
				const dw = e.w - crossNerveDrag.lastW;
				const dz = e.zmm - crossNerveDrag.lastZ;
				nerve.points[crossNerveDrag.index] = {
					...p,
					x: p.x + frame.normal.x * dw,
					y: p.y + frame.normal.y * dw,
					z: p.z + dz
				};
				crossNerveDrag.lastW = e.w;
				crossNerveDrag.lastZ = e.zmm;
				ps.saveNerve(nerve.id);
			}
			return true;
		}
		if (e.type === 'up') {
			crossNerveDrag = null;
			return true;
		}
		return true;
	}

	if (e.type === 'down') {
		for (const im of ps.implants) {
			if (!im.visible) continue;
			const h = projectToSection(frame, { x: im.x, y: im.y, z: im.z });
			const a = projectToSection(frame, implantApex(im));
			if (Math.min(Math.abs(h.v), Math.abs(a.v)) > 10) continue;
			const dHead = Math.hypot(h.w - e.w, h.zmm - e.zmm);
			const dApex = Math.hypot(a.w - e.w, a.zmm - e.zmm);
			const isSelected = ps.selectedImplantId === im.id;
			if (isSelected && dHead < 1.8) {
				ps.markEdit();
				crossDrag = { kind: 'implant-head', implantId: im.id, lastW: e.w, lastZ: e.zmm };
				return true;
			}
			if (isSelected && dApex < 1.8) {
				ps.markEdit();
				crossDrag = { kind: 'implant-apex', implantId: im.id, lastW: e.w, lastZ: e.zmm };
				return true;
			}
			if (pointSegDist(e.w, e.zmm, h.w, h.zmm, a.w, a.zmm) < im.diameter / 2 + 1) {
				ps.markEdit();
				ps.selectedImplantId = im.id;
				crossDrag = { kind: 'implant-body', implantId: im.id, lastW: e.w, lastZ: e.zmm };
				return true;
			}
		}
		return false;
	}
	if (e.type === 'move' && crossDrag.kind.startsWith('implant')) {
		const im = ps.implants.find((i) => i.id === crossDrag.implantId);
		if (!im) return true;
		const dw = e.w - crossDrag.lastW;
		const dz = e.zmm - crossDrag.lastZ;
		if (crossDrag.kind === 'implant-body') {
			im.x += frame.normal.x * dw;
			im.y += frame.normal.y * dw;
			im.z += dz;
		} else {
			const head: Vec3 = { x: im.x, y: im.y, z: im.z };
			const apex = implantApex(im);
			if (crossDrag.kind === 'implant-head') {
				const nh: Vec3 = {
					x: head.x + frame.normal.x * dw,
					y: head.y + frame.normal.y * dw,
					z: head.z + dz
				};
				const axis = norm(sub(apex, nh));
				im.x = nh.x;
				im.y = nh.y;
				im.z = nh.z;
				im.ax = axis.x;
				im.ay = axis.y;
				im.az = axis.z;
			} else {
				const na: Vec3 = {
					x: apex.x + frame.normal.x * dw,
					y: apex.y + frame.normal.y * dw,
					z: apex.z + dz
				};
				const axis = norm(sub(na, head));
				im.ax = axis.x;
				im.ay = axis.y;
				im.az = axis.z;
			}
		}
		crossDrag.lastW = e.w;
		crossDrag.lastZ = e.zmm;
		ps.saveImplant(im.id);
		return true;
	}
	if (e.type === 'up' && crossDrag.kind !== 'none') {
		crossDrag.kind = 'none';
		return true;
	}
	return false;
}

// ---------------- axial view ----------------

export function drawAxialObjects(
	ps: PlanningState,
	ctx: CanvasRenderingContext2D,
	t: ViewTransform
) {
	const sx = ps.ds.spacing_x;
	const sy = ps.ds.spacing_y;
	const zmm = ps.cursor.z * ps.ds.spacing_z;
	const toCanvas = (mmx: number, mmy: number) => ({
		x: t.ox + (mmx / sx + 0.5) * t.scaleX,
		y: t.oy + (mmy / sy + 0.5) * t.scaleY
	});
	const pxPerMM = t.scaleX / sx;

	// nerve cross-points near this slice
	for (const n of ps.nerves) {
		if (!n.visible) continue;
		for (let i = 0; i < n.points.length - 1; i++) {
			const p1 = n.points[i];
			const p2 = n.points[i + 1];
			if ((p1.z - zmm) * (p2.z - zmm) > 0) continue;
			const f = Math.abs(p1.z - zmm) / (Math.abs(p1.z - zmm) + Math.abs(p2.z - zmm) || 1);
			const q = toCanvas(p1.x + (p2.x - p1.x) * f, p1.y + (p2.y - p1.y) * f);
			const d1 = p1.d ?? n.diameter;
			const d2 = p2.d ?? n.diameter;
			const dmm = d1 + (d2 - d1) * f;
			ctx.beginPath();
			ctx.arc(q.x, q.y, Math.max(2.5, (dmm / 2) * pxPerMM), 0, Math.PI * 2);
			ctx.strokeStyle = n.color;
			ctx.lineWidth = 2;
			ctx.stroke();
		}
	}

	// implant cross-sections at this slice
	const warns = warningIds(ps);
	for (const im of ps.implants) {
		if (!im.visible) continue;
		const apex = implantApex(im);
		const lo = Math.min(im.z, apex.z);
		const hi = Math.max(im.z, apex.z);
		if (zmm < lo - 0.5 || zmm > hi + 0.5) continue;
		const denom = apex.z - im.z || 1e-6;
		const s = Math.max(0, Math.min(1, (zmm - im.z) / denom));
		const q = toCanvas(im.x + im.ax * im.length * s, im.y + im.ay * im.length * s);
		const r = (im.diameter / 2) * pxPerMM;
		ctx.beginPath();
		ctx.arc(q.x, q.y, Math.max(2, r), 0, Math.PI * 2);
		const c = warns.has(im.id) ? '#d05050' : im.color;
		ctx.strokeStyle = c;
		ctx.lineWidth = ps.selectedImplantId === im.id ? 2.5 : 1.5;
		ctx.stroke();
		ctx.fillStyle = c + '44';
		ctx.fill();
	}
}

// ---------------- measurements (axial view) ----------------

// drag-editing of existing measurement points on the axial slice
let measureDrag: { id: number; index: number } | null = null;

export function measureEditTool(ps: PlanningState, e: ToolPointerEvent): boolean {
	if (ps.locked || ps.measureTool !== 'none') return false;
	const sx = ps.ds.spacing_x;
	const sy = ps.ds.spacing_y;
	const zmm = ps.cursor.z * ps.ds.spacing_z;
	const mm = { x: e.px * sx, y: e.py * sy };

	if (e.type === 'down') {
		for (const m of ps.measurements) {
			if (m.type === 'density') continue;
			for (let i = 0; i < m.points.length; i++) {
				const p = m.points[i];
				if (Math.abs(p.z - zmm) > 1.01) continue;
				if (Math.hypot(p.x - mm.x, p.y - mm.y) < 1.6) {
					ps.markEdit();
					measureDrag = { id: m.id, index: i };
					return true;
				}
			}
		}
		return false;
	}
	if (e.type === 'move' && measureDrag) {
		const m = ps.measurements.find((m) => m.id === measureDrag!.id);
		if (m) {
			m.points[measureDrag.index] = { ...m.points[measureDrag.index], x: mm.x, y: mm.y };
			// recompute the value live
			if (m.type === 'distance' && m.points.length === 2) {
				m.value = len(sub(m.points[1], m.points[0]));
				m.label = `${m.value.toFixed(ps.measureDecimals)} mm`;
			} else if (m.type === 'angle' && m.points.length === 3) {
				const v1 = norm(sub(m.points[0], m.points[1]));
				const v2 = norm(sub(m.points[2], m.points[1]));
				m.value = (Math.acos(Math.max(-1, Math.min(1, dot(v1, v2)))) * 180) / Math.PI;
				m.label = `${m.value.toFixed(ps.measureDecimals)}°`;
			} else if (m.type === 'polyline') {
				m.value = 0;
				for (let i = 1; i < m.points.length; i++) m.value += len(sub(m.points[i], m.points[i - 1]));
				m.label = `Σ ${m.value.toFixed(ps.measureDecimals)} mm`;
			}
		}
		return true;
	}
	if (e.type === 'up' && measureDrag) {
		const m = ps.measurements.find((m) => m.id === measureDrag!.id);
		if (m) ps.saveMeasurement(m.id);
		measureDrag = null;
		return true;
	}
	return false;
}

export function measureAxialTool(ps: PlanningState, e: ToolPointerEvent): boolean {
	if (ps.measureTool === 'none' || ps.locked) return false;
	if (e.type !== 'down') return true;
	const p: Vec3 = {
		x: e.px * ps.ds.spacing_x,
		y: e.py * ps.ds.spacing_y,
		z: ps.cursor.z * ps.ds.spacing_z
	};

	if (ps.measureTool === 'density') {
		const slice = ps.slices.peek('axial', ps.cursor.z);
		const px = Math.round(e.px);
		const py = Math.round(e.py);
		const hu =
			slice && px >= 0 && py >= 0 && px < slice.width && py < slice.height
				? slice.data[py * slice.width + px]
				: 0;
		ps.addMeasurement('density', [p], hu, `${hu} HU`);
		ps.measureTool = 'none';
		return true;
	}

	if (ps.measureTool === 'annotation') {
		const text = window.prompt('Annotation text:');
		if (text) ps.addMeasurement('annotation', [p], 0, text);
		ps.measureTool = 'none';
		return true;
	}

	if (ps.measureTool === 'polyline') {
		ps.pendingMeasure.push(p);
		return true; // finished explicitly via the toolbar button
	}

	if (ps.measureTool === 'auxline') {
		ps.pendingMeasure.push(p);
		if (ps.pendingMeasure.length === 2) {
			ps.addMeasurement(
				'auxline',
				ps.pendingMeasure.map((q) => ({ ...q })),
				0,
				''
			);
			ps.pendingMeasure.length = 0;
			ps.measureTool = 'none';
		}
		return true;
	}

	ps.pendingMeasure.push(p);
	if (ps.measureTool === 'distance' && ps.pendingMeasure.length === 2) {
		const [a, b] = ps.pendingMeasure;
		const d = len(sub(b, a));
		ps.addMeasurement('distance', [{ ...a }, { ...b }], d, `${d.toFixed(ps.measureDecimals)} mm`);
		ps.pendingMeasure.length = 0;
		ps.measureTool = 'none';
	} else if (ps.measureTool === 'angle' && ps.pendingMeasure.length === 3) {
		const [a, b, c] = ps.pendingMeasure;
		const v1 = norm(sub(a, b));
		const v2 = norm(sub(c, b));
		const ang = (Math.acos(Math.max(-1, Math.min(1, dot(v1, v2)))) * 180) / Math.PI;
		ps.addMeasurement('angle', [{ ...a }, { ...b }, { ...c }], ang, `${ang.toFixed(ps.measureDecimals)}°`);
		ps.pendingMeasure.length = 0;
		ps.measureTool = 'none';
	}
	return true;
}

/** complete a pending polyline measurement (≥2 points) */
export function finishPolyline(ps: PlanningState): void {
	if (ps.pendingMeasure.length >= 2) {
		let total = 0;
		for (let i = 1; i < ps.pendingMeasure.length; i++) {
			total += len(sub(ps.pendingMeasure[i], ps.pendingMeasure[i - 1]));
		}
		ps.addMeasurement(
			'polyline',
			ps.pendingMeasure.map((p) => ({ ...p })),
			total,
			`Σ ${total.toFixed(ps.measureDecimals)} mm`
		);
	}
	ps.pendingMeasure.length = 0;
	ps.measureTool = 'none';
}

export function drawMeasurements(
	ps: PlanningState,
	ctx: CanvasRenderingContext2D,
	t: ViewTransform
) {
	const sx = ps.ds.spacing_x;
	const sy = ps.ds.spacing_y;
	const zmm = ps.cursor.z * ps.ds.spacing_z;
	const toCanvas = (p: Vec3) => ({
		x: t.ox + (p.x / sx + 0.5) * t.scaleX,
		y: t.oy + (p.y / sy + 0.5) * t.scaleY
	});

	const drawSet = (points: Vec3[], label: string, faded: boolean, segLabels = false) => {
		if (!points.length) return;
		ctx.strokeStyle = faded ? 'rgba(122, 140, 240, 0.5)' : 'rgba(122, 140, 240, 0.95)';
		ctx.fillStyle = ctx.strokeStyle;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		points.forEach((p, i) => {
			const q = toCanvas(p);
			if (i === 0) ctx.moveTo(q.x, q.y);
			else ctx.lineTo(q.x, q.y);
		});
		ctx.stroke();
		for (const p of points) {
			const q = toCanvas(p);
			ctx.beginPath();
			ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
			ctx.fill();
		}
		if (segLabels) {
			ctx.font = '10px Inter, sans-serif';
			ctx.fillStyle = '#bfc8ff';
			for (let i = 1; i < points.length; i++) {
				const a = toCanvas(points[i - 1]);
				const b = toCanvas(points[i]);
				const d = len(sub(points[i], points[i - 1]));
				ctx.fillText(d.toFixed(1), (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4);
			}
		}
		if (label) {
			const q = toCanvas(points[points.length - 1]);
			ctx.font = '11px Inter, sans-serif';
			ctx.fillStyle = '#dfe4ff';
			ctx.fillText(label, q.x + 8, q.y - 6);
		}
	};

	for (const m of ps.measurements) {
		// show on slices near where the measurement was taken
		if (!m.points.every((p) => Math.abs(p.z - zmm) < 1.01)) continue;
		if (m.type === 'annotation') {
			const q = toCanvas(m.points[0]);
			ctx.fillStyle = '#d05050';
			ctx.beginPath();
			ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.font = '11px Inter, sans-serif';
			ctx.fillText(m.label, q.x + 8, q.y + 4);
			continue;
		}
		drawSet(m.points, m.label, false, m.type === 'polyline');
	}
	if (ps.pendingMeasure.length) drawSet(ps.pendingMeasure, '…', true, ps.measureTool === 'polyline');
}

// ---------------- util ----------------

function pointSegDist(
	px: number,
	py: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number
): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const l2 = dx * dx + dy * dy;
	const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export type { PanoToolEvent, CrossToolEvent };
