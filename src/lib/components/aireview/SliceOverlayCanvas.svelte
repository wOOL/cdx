<script lang="ts">
	/**
	 * Self-contained slice canvas for the AI review wizard: windowed slice
	 * bitmap (cached per plane:index — no per-frame refetch) + a caller-drawn
	 * overlay in in-plane mm coordinates. No imports from the planning viewers.
	 */
	import type { SliceCache } from '$lib/client/sliceCache';
	import {
		makeViewMap,
		sliceToBitmap,
		type DsGeom,
		type Plane,
		type ViewMap
	} from './overlay';

	let {
		cache,
		geom,
		plane,
		index,
		version = 0,
		draw = undefined,
		onpointer = undefined,
		onscroll = undefined,
		label = '',
		height = 250
	}: {
		cache: SliceCache;
		geom: DsGeom;
		plane: Plane;
		index: number;
		/** bump to force an overlay redraw without refetching the slice */
		version?: number;
		draw?: (ctx: CanvasRenderingContext2D, view: ViewMap) => void;
		onpointer?: (type: 'down' | 'move' | 'up', mm: { u: number; v: number }, view: ViewMap) => void;
		onscroll?: (delta: 1 | -1) => void;
		label?: string;
		height?: number;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let wrapW = $state(0);

	// windowed bitmaps keyed plane:index, dropped when the cache instance changes
	let bitmaps = new Map<string, HTMLCanvasElement>();
	let bitmapsFor: SliceCache | null = null;
	const MAX_BITMAPS = 48;

	function render(): void {
		if (!canvas) return;
		const cw = canvas.width;
		const ch = canvas.height;
		const ctx = canvas.getContext('2d');
		if (!ctx || cw === 0) return;
		ctx.fillStyle = '#06080b';
		ctx.fillRect(0, 0, cw, ch);
		const view = makeViewMap(plane, geom, cw, ch);
		const bmp = bitmaps.get(`${plane}:${index}`);
		if (bmp) {
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(bmp, view.ox, view.oy, view.wMm * view.scale, view.hMm * view.scale);
		}
		draw?.(ctx, view);
		if (label) {
			ctx.fillStyle = 'rgba(216,220,228,0.75)';
			ctx.font = '11px sans-serif';
			ctx.fillText(label, 8, 16);
		}
	}

	$effect(() => {
		// re-run on slice address, redraw version, size or cache identity change
		void version;
		void wrapW;
		if (!canvas) return;
		canvas.width = Math.max(50, Math.floor(wrapW));
		canvas.height = height;
		if (bitmapsFor !== cache) {
			bitmaps = new Map();
			bitmapsFor = cache;
		}
		const key = `${plane}:${index}`;
		if (!bitmaps.has(key)) {
			const myBitmaps = bitmaps;
			cache
				.get(plane, index)
				.then((slice) => {
					if (myBitmaps !== bitmaps) return; // cache instance was swapped
					bitmaps.set(key, sliceToBitmap(slice, geom));
					while (bitmaps.size > MAX_BITMAPS) {
						const oldest = bitmaps.keys().next().value as string;
						bitmaps.delete(oldest);
					}
					render();
				})
				.catch(() => {});
		}
		render();
	});

	let dragging = false;

	function mmOf(e: PointerEvent): { mm: { u: number; v: number }; view: ViewMap } | null {
		if (!canvas) return null;
		const r = canvas.getBoundingClientRect();
		const view = makeViewMap(plane, geom, canvas.width, canvas.height);
		const p = view.toMm(e.clientX - r.left, e.clientY - r.top);
		return { mm: p, view };
	}

	function down(e: PointerEvent): void {
		if (!onpointer) return;
		const m = mmOf(e);
		if (!m) return;
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		onpointer('down', m.mm, m.view);
	}
	function move(e: PointerEvent): void {
		if (!onpointer || !dragging) return;
		const m = mmOf(e);
		if (m) onpointer('move', m.mm, m.view);
	}
	function up(e: PointerEvent): void {
		if (!onpointer || !dragging) return;
		dragging = false;
		const m = mmOf(e);
		if (m) onpointer('up', m.mm, m.view);
	}
	function wheel(e: WheelEvent): void {
		if (!onscroll) return;
		e.preventDefault();
		onscroll(e.deltaY > 0 ? 1 : -1);
	}
</script>

<div class="soc-wrap" bind:clientWidth={wrapW} style="height:{height}px">
	<canvas
		bind:this={canvas}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onwheel={wheel}
	></canvas>
</div>

<style>
	.soc-wrap {
		position: relative;
		width: 100%;
		background: #06080b;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		overflow: hidden;
	}
	canvas {
		display: block;
		touch-action: none;
		cursor: crosshair;
	}
</style>
