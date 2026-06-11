/** Shared 2D rendering helpers for slice-like views (raw Int16 images + window/level). */

export interface RawImage {
	width: number;
	height: number;
	data: Int16Array;
}

export interface ViewTransform {
	scaleX: number;
	scaleY: number;
	ox: number;
	oy: number;
}

/** Metadata for reconstructed images (pano / cross-section). */
export interface ReconInfo {
	stepMM: number;
	width: number;
	height: number;
}

export interface ToolPointerEvent {
	type: 'down' | 'move' | 'up';
	/** image/slice pixel coords (float) */
	px: number;
	py: number;
	native: PointerEvent;
}

/** Fit an image with physical pixel size (spacingW, spacingH) into a canvas. */
export function fitTransform(
	canvasW: number,
	canvasH: number,
	img: { width: number; height: number },
	spacingW: number,
	spacingH: number,
	zoom = 1,
	panX = 0,
	panY = 0
): ViewTransform {
	const wmm = img.width * spacingW;
	const hmm = img.height * spacingH;
	const fit = Math.min(canvasW / wmm, canvasH / hmm) * 0.95 * zoom;
	const scaleX = fit * spacingW;
	const scaleY = fit * spacingH;
	return {
		scaleX,
		scaleY,
		ox: (canvasW - img.width * scaleX) / 2 + panX,
		oy: (canvasH - img.height * scaleY) / 2 + panY
	};
}

export function toCanvas(t: ViewTransform, px: number, py: number): { x: number; y: number } {
	return { x: t.ox + (px + 0.5) * t.scaleX, y: t.oy + (py + 0.5) * t.scaleY };
}

export function toImage(t: ViewTransform, cx: number, cy: number): { px: number; py: number } {
	return { px: cx / t.scaleX - 0.5 - t.ox / t.scaleX, py: cy / t.scaleY - 0.5 - t.oy / t.scaleY };
}

/** Apply window/level to a raw image, drawing into (and resizing) the given offscreen canvas. */
export function windowInto(
	offscreen: HTMLCanvasElement,
	img: RawImage,
	wc: number,
	ww: number
): void {
	if (offscreen.width !== img.width || offscreen.height !== img.height) {
		offscreen.width = img.width;
		offscreen.height = img.height;
	}
	const ctx = offscreen.getContext('2d')!;
	const out = ctx.createImageData(img.width, img.height);
	const lo = wc - ww / 2;
	const scale = 255 / ww;
	const d = out.data;
	const src = img.data;
	for (let i = 0; i < src.length; i++) {
		let v = (src[i] - lo) * scale;
		if (v < 0) v = 0;
		else if (v > 255) v = 255;
		const o = i * 4;
		d[o] = d[o + 1] = d[o + 2] = v;
		d[o + 3] = 255;
	}
	ctx.putImageData(out, 0, 0);
}
