<script lang="ts">
	import type { PlanningState } from '$lib/client/planning.svelte';
	import type { Plane, Slice } from '$lib/client/sliceCache';

	import {
		drawScaleBar,
		handleSnapshot,
		type ToolPointerEvent,
		type ViewTransform
	} from '$lib/client/render2d';

	let {
		state: ps,
		plane,
		label = '',
		overlayDraw,
		onToolPointer,
		onImageDblClick,
		overlayDeps,
		zoomSignal,
		previewRotate = 0
	}: {
		state: PlanningState;
		plane: Plane;
		label?: string;
		/** drawn after image + crosshair; coords via transform (slice px → canvas px) */
		overlayDraw?: (ctx: CanvasRenderingContext2D, t: ViewTransform) => void;
		/** return true to consume left-button events (suppresses crosshair placement) */
		onToolPointer?: (e: ToolPointerEvent) => boolean;
		/** double-click in image coords; return true to suppress the view reset */
		onImageDblClick?: (px: number, py: number) => boolean;
		/** reactive value(s) the overlay depends on — read in the redraw effect */
		overlayDeps?: unknown;
		/** external zoom command: f > 0 multiplies, f === 0 resets (seq triggers) */
		zoomSignal?: { seq: number; f: number };
		/** pending in-plane rotation preview (°, clockwise) — image only, before baking */
		previewRotate?: number;
	} = $props();

	let lastZoomSeq = 0;
	$effect(() => {
		if (!zoomSignal || zoomSignal.seq === lastZoomSeq) return;
		lastZoomSeq = zoomSignal.seq;
		animateZoom(zoomSignal.f === 0 ? 1 : Math.max(0.2, Math.min(10, zoom * zoomSignal.f)));
		if (zoomSignal.f === 0) {
			panX = 0;
			panY = 0;
		}
	});

	// display-only horizontal mirror (axial L/R convention switch)
	let mirrored = $state(false);

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();

	// local view transform
	let zoom = $state(1);
	let zoomAnim: number | null = null;

	/** Animate zoom toward `target` over ~140ms (honors the Views > smooth-transitions setting). */
	function animateZoom(target: number) {
		if (!smoothTransitions()) {
			zoom = target;
			return;
		}
		const from = zoom;
		const t0 = performance.now();
		if (zoomAnim != null) cancelAnimationFrame(zoomAnim);
		const step = (now: number) => {
			const u = Math.min(1, (now - t0) / 140);
			const e = 1 - (1 - u) * (1 - u);
			zoom = from + (target - from) * e;
			if (u < 1) zoomAnim = requestAnimationFrame(step);
			else zoomAnim = null;
		};
		zoomAnim = requestAnimationFrame(step);
	}

	function smoothTransitions(): boolean {
		return ps.settings?.smooth_transitions !== '0';
	}
	let panX = $state(0);
	let panY = $state(0);

	let hoverHU: number | null = $state(null);
	let hoverPos: { px: number; py: number } | null = null;
	let snapSaved = $state(false);

	// slice geometry per plane
	let sliceIndex = $derived(
		plane === 'axial' ? ps.cursor.z : plane === 'coronal' ? ps.cursor.y : ps.cursor.x
	);
	let maxIndex = $derived(
		plane === 'axial' ? ps.ds.slices - 1 : plane === 'coronal' ? ps.ds.rows - 1 : ps.ds.cols - 1
	);
	let spacingW = $derived(plane === 'sagittal' ? ps.ds.spacing_y : ps.ds.spacing_x);
	let spacingH = $derived(plane === 'axial' ? ps.ds.spacing_y : ps.ds.spacing_z);

	let offscreen: HTMLCanvasElement | null = null;
	let lastSlice: Slice | null = null;
	let lastImageKey = '';
	let raf = 0;

	function setIndex(i: number) {
		const idx = Math.max(0, Math.min(maxIndex, Math.round(i)));
		if (plane === 'axial') ps.cursor.z = idx;
		else if (plane === 'coronal') ps.cursor.y = idx;
		else ps.cursor.x = idx;
	}

	// crosshair position in slice pixel coords
	function crosshairPx(): { px: number; py: number } {
		const S = ps.ds.slices;
		if (plane === 'axial') return { px: ps.cursor.x, py: ps.cursor.y };
		if (plane === 'coronal') return { px: ps.cursor.x, py: S - 1 - ps.cursor.z };
		return { px: ps.cursor.y, py: S - 1 - ps.cursor.z };
	}

	function setCursorFromSlicePx(px: number, py: number) {
		const S = ps.ds.slices;
		if (plane === 'axial') {
			ps.cursor.x = px;
			ps.cursor.y = py;
		} else if (plane === 'coronal') {
			ps.cursor.x = px;
			ps.cursor.z = S - 1 - py;
		} else {
			ps.cursor.y = px;
			ps.cursor.z = S - 1 - py;
		}
		ps.clampCursor();
	}

	/** canvas px → slice px (float, pixel-center convention matching toCanvas) */
	function canvasToSlice(cx: number, cy: number): { px: number; py: number } | null {
		if (!canvas || !lastSlice) return null;
		const t = fitTransform(lastSlice);
		return { px: (cx - t.ox) / t.scaleX - 0.5, py: (cy - t.oy) / t.scaleY - 0.5 };
	}

	function fitTransform(slice: Slice) {
		const cw = canvas!.width;
		const ch = canvas!.height;
		const wmm = slice.width * spacingW;
		const hmm = slice.height * spacingH;
		const fit = Math.min(cw / wmm, ch / hmm) * 0.95 * zoom;
		const scaleX = fit * spacingW;
		const scaleY = fit * spacingH;
		const ox = (cw - slice.width * scaleX) / 2 + panX;
		const oy = (ch - slice.height * scaleY) / 2 + panY;
		if (mirrored) {
			return { scaleX: -scaleX, scaleY, ox: cw - ox, oy };
		}
		return { scaleX, scaleY, ox, oy };
	}

	function render(slice: Slice) {
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		const cw = canvas.width;
		const ch = canvas.height;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, cw, ch);

		// window/level into offscreen canvas (cache per slice+wl)
		const key = `${plane}:${sliceIndex}:${ps.wc}:${ps.ww}`;
		if (key !== lastImageKey || !offscreen) {
			if (!offscreen || offscreen.width !== slice.width || offscreen.height !== slice.height) {
				offscreen = document.createElement('canvas');
				offscreen.width = slice.width;
				offscreen.height = slice.height;
			}
			const octx = offscreen.getContext('2d')!;
			const img = octx.createImageData(slice.width, slice.height);
			const lo = ps.wc - ps.ww / 2;
			const scale = 255 / ps.ww;
			const d = img.data;
			const src = slice.data;
			for (let i = 0; i < src.length; i++) {
				let v = (src[i] - lo) * scale;
				if (v < 0) v = 0;
				else if (v > 255) v = 255;
				const o = i * 4;
				d[o] = d[o + 1] = d[o + 2] = v;
				d[o + 3] = 255;
			}
			octx.putImageData(img, 0, 0);
			lastImageKey = key;
		}

		const t = fitTransform(slice);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		const rot = ((previewRotate || 0) * Math.PI) / 180;
		if (rot) {
			// rotate the image about its canvas center (midpoint formula also holds
			// for the mirrored case where scaleX < 0)
			ctx.save();
			const mx = t.ox + (slice.width * t.scaleX) / 2;
			const my = t.oy + (slice.height * t.scaleY) / 2;
			ctx.translate(mx, my);
			ctx.rotate(rot);
			ctx.translate(-mx, -my);
		}
		if (t.scaleX < 0) {
			// mirrored: flip the bitmap, overlays use the mirrored transform directly
			ctx.save();
			ctx.translate(cw, 0);
			ctx.scale(-1, 1);
			ctx.drawImage(offscreen, cw - t.ox, t.oy, slice.width * -t.scaleX, slice.height * t.scaleY);
			ctx.restore();
		} else {
			ctx.drawImage(offscreen, t.ox, t.oy, slice.width * t.scaleX, slice.height * t.scaleY);
		}
		if (rot) {
			ctx.restore();
			ctx.fillStyle = 'rgba(240, 138, 36, 0.95)';
			ctx.font = '11px Inter, sans-serif';
			const rt = `${(previewRotate || 0).toFixed(1)}° pending`;
			ctx.fillText(rt, cw / 2 - ctx.measureText(rt).width / 2, 26);
		}

		// crosshair — each line carries the color of the plane it represents
		// (axial = blue, coronal = green, sagittal = red), as in the original
		if (ps.crosshairVisible) {
			const { px, py } = crosshairPx();
			const cx = t.ox + (px + 0.5) * t.scaleX;
			const cy = t.oy + (py + 0.5) * t.scaleY;
			const AX = 'rgba(69, 150, 224, 0.6)';
			const COR = 'rgba(96, 190, 96, 0.6)';
			const SAG = 'rgba(224, 92, 92, 0.6)';
			const horiz = plane === 'axial' ? COR : AX; // horizontal line's plane
			const vert = plane === 'coronal' || plane === 'axial' ? SAG : COR;
			ctx.lineWidth = 1;
			ctx.strokeStyle = horiz;
			ctx.beginPath();
			ctx.moveTo(0, cy);
			ctx.lineTo(cx - 12, cy);
			ctx.moveTo(cx + 12, cy);
			ctx.lineTo(cw, cy);
			ctx.stroke();
			ctx.strokeStyle = vert;
			ctx.beginPath();
			ctx.moveTo(cx, 0);
			ctx.lineTo(cx, cy - 12);
			ctx.moveTo(cx, cy + 12);
			ctx.lineTo(cx, ch);
			ctx.stroke();
		}

		overlayDraw?.(ctx, t);

		// overlays
		ctx.fillStyle = 'rgba(216, 220, 228, 0.85)';
		ctx.font = '11px Inter, sans-serif';
		ctx.fillText(`${sliceIndex + 1} / ${maxIndex + 1}`, 8, ch - 8);
		const wlText = `C ${Math.round(ps.wc)}  W ${Math.round(ps.ww)}`;
		ctx.fillText(wlText, cw - ctx.measureText(wlText).width - 8, ch - 8);
		if (hoverHU !== null) {
			ctx.fillText(`${hoverHU} HU`, 8, ch - 22);
		}

		drawScaleBar(ctx, Math.abs(t.scaleX) / spacingW, cw, ch);

		// orientation labels
		ctx.fillStyle = 'rgba(138, 145, 160, 0.9)';
		ctx.font = '10px Inter, sans-serif';
		let labels =
			plane === 'axial'
				? { top: 'A', bottom: 'P', left: 'R', right: 'L' }
				: plane === 'coronal'
					? { top: 'S', bottom: 'I', left: 'R', right: 'L' }
					: { top: 'S', bottom: 'I', left: 'A', right: 'P' };
		if (mirrored) labels = { ...labels, left: labels.right, right: labels.left };
		ctx.fillText(labels.top, cw / 2 - 3, 14);
		ctx.fillText(labels.bottom, cw / 2 - 3, ch - 18);
		ctx.fillText(labels.left, 6, ch / 2 + 3);
		ctx.fillText(labels.right, cw - 14, ch / 2 + 3);
	}

	function scheduleDraw() {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(async () => {
			const idx = sliceIndex;
			const cached = ps.slices.peek(plane, idx);
			if (cached) {
				lastSlice = cached;
				render(cached);
			} else {
				if (lastSlice) render(lastSlice); // keep previous while loading
				try {
					const slice = await ps.slices.get(plane, idx);
					if (idx === sliceIndex) {
						lastSlice = slice;
						render(slice);
					}
				} catch {
					// dataset gone or network error — leave last frame
				}
			}
			// prefetch neighbours
			ps.slices.get(plane, Math.min(maxIndex, idx + 1)).catch(() => {});
			ps.slices.get(plane, Math.max(0, idx - 1)).catch(() => {});
		});
	}

	$effect(() => {
		// dependencies: cursor, window, transform, hover
		void ps.cursor.x;
		void ps.cursor.y;
		void ps.cursor.z;
		void ps.wc;
		void ps.ww;
		void zoom;
		void panX;
		void panY;
		void hoverHU;
		void ps.crosshairVisible;
		void overlayDeps;
		void mirrored;
		scheduleDraw();
	});

	$effect(() => {
		if (!container || !canvas) return;
		const ro = new ResizeObserver(() => {
			if (!canvas || !container) return;
			canvas.width = container.clientWidth;
			canvas.height = container.clientHeight;
			scheduleDraw();
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	// ---------- mouse interaction ----------
	let dragMode: 'none' | 'cursor' | 'wl' | 'pan' | 'tool' = 'none';
	let lastMouse = { x: 0, y: 0 };

	function toolEvent(type: 'down' | 'move' | 'up', e: PointerEvent): boolean {
		if (!onToolPointer || !lastSlice) return false;
		const p = canvasToSlice(e.offsetX, e.offsetY);
		if (!p) return false;
		return onToolPointer({ type, px: p.px, py: p.py, native: e });
	}

	function onPointerDown(e: PointerEvent) {
		canvas?.setPointerCapture(e.pointerId);
		lastMouse = { x: e.offsetX, y: e.offsetY };
		if (e.button === 0) {
			if (toolEvent('down', e)) {
				dragMode = 'tool';
				return;
			}
			dragMode = 'cursor';
			applyCursor(e);
		} else if (e.button === 2) {
			dragMode = 'wl';
		} else if (e.button === 1) {
			dragMode = 'pan';
		}
	}

	function applyCursor(e: PointerEvent) {
		const p = canvasToSlice(e.offsetX, e.offsetY);
		if (!p || !lastSlice) return;
		const px = Math.max(0, Math.min(lastSlice.width - 1, Math.round(p.px)));
		const py = Math.max(0, Math.min(lastSlice.height - 1, Math.round(p.py)));
		setCursorFromSlicePx(px, py);
	}

	function onPointerMove(e: PointerEvent) {
		const dx = e.offsetX - lastMouse.x;
		const dy = e.offsetY - lastMouse.y;
		if (dragMode === 'tool') {
			toolEvent('move', e);
		} else if (dragMode === 'cursor') {
			applyCursor(e);
		} else if (dragMode === 'wl') {
			ps.ww = Math.max(10, ps.ww + dx * 8);
			ps.wc = ps.wc + dy * 4;
		} else if (dragMode === 'pan') {
			panX += dx;
			panY += dy;
		}
		lastMouse = { x: e.offsetX, y: e.offsetY };

		// HU readout
		const p = canvasToSlice(e.offsetX, e.offsetY);
		if (p && lastSlice) {
			const px = Math.round(p.px);
			const py = Math.round(p.py);
			if (px >= 0 && px < lastSlice.width && py >= 0 && py < lastSlice.height) {
				hoverHU = lastSlice.data[py * lastSlice.width + px];
				hoverPos = { px, py };
			} else {
				hoverHU = null;
				hoverPos = null;
			}
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (dragMode === 'tool') toolEvent('up', e);
		dragMode = 'none';
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		// Ctrl+wheel or Shift+wheel (the desktop hotkey) zooms; plain wheel scrolls slices
		if (e.ctrlKey || e.shiftKey) {
			animateZoom(Math.max(0.2, Math.min(10, zoom * (e.deltaY < 0 ? 1.25 : 0.8))));
		} else {
			setIndex(sliceIndex + (e.deltaY > 0 ? 1 : -1));
		}
	}

	function resetView() {
		zoom = 1;
		panX = 0;
		panY = 0;
	}

	function onDblClick(e: MouseEvent) {
		if (onImageDblClick && lastSlice) {
			const p = canvasToSlice(e.offsetX, e.offsetY);
			if (p && onImageDblClick(p.px, p.py)) return;
		}
		resetView();
	}
</script>

<div class="slice-view" bind:this={container}>
	<canvas
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onwheel={onWheel}
		oncontextmenu={(e) => e.preventDefault()}
		ondblclick={onDblClick}
	></canvas>
	<div class="view-label">{label || plane}</div>
	{#if plane === 'axial'}
		<button
			class="snap-btn mirror-btn"
			class:mirror-on={mirrored}
			title="Mirror horizontally (radiological / surgical convention)"
			onclick={() => (mirrored = !mirrored)}>⇋</button
		>
	{/if}
	<button
		class="snap-btn"
		title="Snapshot → image library (Alt+click to download)"
		onclick={async (e) => {
			if (!canvas) return;
			if (await handleSnapshot(e, canvas, ps.snapshotName(`${plane}-${sliceIndex + 1}`), ps.ds.case_id)) {
				snapSaved = true;
				setTimeout(() => (snapSaved = false), 1200);
			}
		}}>{snapSaved ? '✓' : '📷'}</button
	>
	<input
		class="slice-slider"
		type="range"
		min="0"
		max={maxIndex}
		value={sliceIndex}
		oninput={(e) => setIndex(Number(e.currentTarget.value))}
	/>
</div>

<style>
	.slice-view {
		position: relative;
		width: 100%;
		height: 100%;
		background: #000;
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
		cursor: crosshair;
		touch-action: none;
	}
	.view-label {
		position: absolute;
		top: 6px;
		left: 8px;
		font-size: 11px;
		color: var(--accent-bright);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		pointer-events: none;
	}
	.snap-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 24px;
		height: 22px;
		border-radius: 3px;
		background: var(--bg-2);
		border: 1px solid var(--border);
		font-size: 11px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.slice-view:hover .snap-btn {
		opacity: 0.8;
	}
	.mirror-btn {
		right: 32px;
	}
	.mirror-on {
		color: var(--accent-bright);
		border-color: var(--accent);
		opacity: 0.9 !important;
	}
	.slice-slider {
		position: absolute;
		right: 4px;
		top: 50%;
		width: 120px;
		transform: rotate(90deg) translateX(-50%);
		transform-origin: left center;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.slice-view:hover .slice-slider {
		opacity: 0.7;
	}
</style>
