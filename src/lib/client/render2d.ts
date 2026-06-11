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

/** 10 mm scale bar, bottom-right. pxPerMM = canvas pixels per millimetre. */
export function drawScaleBar(
	ctx: CanvasRenderingContext2D,
	pxPerMM: number,
	canvasW: number,
	canvasH: number
): void {
	const px = pxPerMM * 10;
	if (px < 20 || px > canvasW * 0.8) return;
	const x1 = canvasW - px - 14;
	const y = canvasH - 26;
	ctx.strokeStyle = 'rgba(216, 220, 228, 0.75)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(x1, y);
	ctx.lineTo(x1 + px, y);
	ctx.moveTo(x1, y - 3);
	ctx.lineTo(x1, y + 3);
	ctx.moveTo(x1 + px, y - 3);
	ctx.lineTo(x1 + px, y + 3);
	ctx.stroke();
	ctx.fillStyle = 'rgba(216, 220, 228, 0.75)';
	ctx.font = '10px Inter, sans-serif';
	ctx.fillText('10 mm', x1 + px / 2 - 14, y - 5);
}

/** Trigger a PNG download of a canvas. */
export function downloadCanvas(canvas: HTMLCanvasElement, name: string): void {
	canvas.toBlob((blob) => {
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${name}.png`;
		a.click();
		URL.revokeObjectURL(url);
	});
}

/** Screenshot preferences set once per session from the settings rows. */
export const snapshotPrefs = { format: 'png' as 'png' | 'jpeg', notify: true };

/** Save a canvas snapshot into the case's image library. */
export async function snapshotToLibrary(
	canvas: HTMLCanvasElement,
	name: string,
	caseId: number
): Promise<boolean> {
	const mime = snapshotPrefs.format === 'jpeg' ? 'image/jpeg' : 'image/png';
	const ext = snapshotPrefs.format === 'jpeg' ? 'jpg' : 'png';
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, 0.92));
	if (!blob) return false;
	const form = new FormData();
	form.append('file', blob, `${name}.${ext}`);
	form.append('name', name);
	const res = await fetch(`/api/cases/${caseId}/images`, { method: 'POST', body: form });
	if (res.ok && snapshotPrefs.notify) notifySnapshot(`Saved "${name}" to the image library`);
	return res.ok;
}

/** Small transient toast in the lower-right corner (no framework dependency). */
function notifySnapshot(text: string): void {
	const el = document.createElement('div');
	el.textContent = text;
	el.style.cssText =
		'position:fixed;right:16px;bottom:36px;z-index:300;background:var(--bg-3);' +
		'border:1px solid var(--accent-dim);border-radius:4px;padding:8px 14px;' +
		'font-size:12px;color:var(--text);box-shadow:var(--shadow);opacity:0;transition:opacity .2s';
	document.body.appendChild(el);
	requestAnimationFrame(() => (el.style.opacity = '1'));
	setTimeout(() => {
		el.style.opacity = '0';
		setTimeout(() => el.remove(), 300);
	}, 2200);
}

/**
 * Snapshot button behavior shared by all views:
 * plain click → save to the image library; Alt+click → download the PNG.
 */
export async function handleSnapshot(
	e: MouseEvent,
	canvas: HTMLCanvasElement,
	name: string,
	caseId: number
): Promise<boolean> {
	if (e.altKey) {
		downloadCanvas(canvas, name);
		return true;
	}
	return snapshotToLibrary(canvas, name, caseId);
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
