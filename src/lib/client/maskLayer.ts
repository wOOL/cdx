/**
 * Client layer for the voxel segmentation mask editor: slice cache with
 * optimistic local painting, batched paint ops, and overlay rendering.
 */
import type { ViewTransform } from './render2d';

export interface MaskSlice {
	width: number;
	height: number;
	data: Uint8Array;
}

const sliceCache = new Map<string, MaskSlice>();
const inflight = new Map<string, Promise<MaskSlice | null>>();

function key(dsId: number, index: number): string {
	return `${dsId}:${index}`;
}

export function peekMaskSlice(dsId: number, index: number): MaskSlice | undefined {
	return sliceCache.get(key(dsId, index));
}

export function fetchMaskSlice(dsId: number, index: number): Promise<MaskSlice | null> {
	const k = key(dsId, index);
	const hit = sliceCache.get(k);
	if (hit) return Promise.resolve(hit);
	const pending = inflight.get(k);
	if (pending) return pending;
	const p = fetch(`/api/datasets/${dsId}/mask/slice/${index}`)
		.then(async (res) => {
			if (!res.ok) return null;
			const width = Number(res.headers.get('X-Width'));
			const height = Number(res.headers.get('X-Height'));
			const slice: MaskSlice = {
				width,
				height,
				data: new Uint8Array(await res.arrayBuffer())
			};
			sliceCache.set(k, slice);
			while (sliceCache.size > 48) {
				const oldest = sliceCache.keys().next().value as string;
				sliceCache.delete(oldest);
			}
			return slice;
		})
		.finally(() => inflight.delete(k));
	inflight.set(k, p);
	return p;
}

export function invalidateMaskSlice(dsId: number, index?: number): void {
	if (index == null) {
		for (const k of [...sliceCache.keys()]) if (k.startsWith(`${dsId}:`)) sliceCache.delete(k);
	} else {
		sliceCache.delete(key(dsId, index));
	}
}

/** optimistic local disc paint into the cached slice (mirrors the server op) */
export function paintLocal(
	dsId: number,
	index: number,
	cx: number,
	cy: number,
	r: number,
	value: 0 | 1
): void {
	const slice = sliceCache.get(key(dsId, index));
	if (!slice) return;
	const r2 = r * r;
	const x0 = Math.max(0, Math.floor(cx - r));
	const x1 = Math.min(slice.width - 1, Math.ceil(cx + r));
	const y0 = Math.max(0, Math.floor(cy - r));
	const y1 = Math.min(slice.height - 1, Math.ceil(cy + r));
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const dx = x - cx;
			const dy = y - cy;
			if (dx * dx + dy * dy <= r2) slice.data[y * slice.width + x] = value;
		}
	}
}

// ---- batched paint op sender ----

interface PaintOp {
	x: number;
	y: number;
	r: number;
	mode: 'add' | 'erase';
}

const pendingOps = new Map<string, PaintOp[]>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function queuePaintOp(dsId: number, index: number, op: PaintOp): void {
	const k = key(dsId, index);
	const list = pendingOps.get(k) ?? [];
	list.push(op);
	pendingOps.set(k, list);
	if (!flushTimer) flushTimer = setTimeout(flushPaintOps, 150);
}

export async function flushPaintOps(): Promise<void> {
	clearTimeout(flushTimer);
	flushTimer = undefined;
	const batches = [...pendingOps.entries()];
	pendingOps.clear();
	for (const [k, ops] of batches) {
		const [dsId, index] = k.split(':').map(Number);
		await fetch(`/api/datasets/${dsId}/mask/paint`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ index, ops: ops.slice(0, 500) })
		}).catch(() => {});
	}
}

/** draw the mask tint over the slice image, honoring (possibly mirrored) transforms */
export function drawMaskOverlay(
	ctx: CanvasRenderingContext2D,
	t: ViewTransform,
	slice: MaskSlice,
	canvasWidth: number
): void {
	const off = document.createElement('canvas');
	off.width = slice.width;
	off.height = slice.height;
	const octx = off.getContext('2d')!;
	const img = octx.createImageData(slice.width, slice.height);
	const d = img.data;
	for (let i = 0; i < slice.data.length; i++) {
		if (slice.data[i]) {
			const o = i * 4;
			d[o] = 110;
			d[o + 1] = 220;
			d[o + 2] = 130;
			d[o + 3] = 92;
		}
	}
	octx.putImageData(img, 0, 0);
	if (t.scaleX < 0) {
		ctx.save();
		ctx.translate(canvasWidth, 0);
		ctx.scale(-1, 1);
		ctx.drawImage(off, canvasWidth - t.ox, t.oy, slice.width * -t.scaleX, slice.height * t.scaleY);
		ctx.restore();
	} else {
		ctx.drawImage(off, t.ox, t.oy, slice.width * t.scaleX, slice.height * t.scaleY);
	}
}
