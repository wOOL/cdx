<script lang="ts">
	import type { PlanningState } from '$lib/client/planning.svelte';
	import { indexAtLength } from '$lib/curve';
	import {
		downloadCanvas,
		drawScaleBar,
		fitTransform,
		windowInto,
		type RawImage,
		type ReconInfo,
		type ViewTransform
	} from '$lib/client/render2d';

	let {
		state: ps,
		halfWidth = 15,
		overlayDraw,
		overlayDeps,
		onToolPointer
	}: {
		state: PlanningState;
		halfWidth?: number;
		overlayDraw?: (ctx: CanvasRenderingContext2D, t: ViewTransform, info: ReconInfo) => void;
		overlayDeps?: unknown;
		/** domain coords: w = signed mm offset from the curve along its normal, zmm = height in mm */
		onToolPointer?: (e: {
			type: 'down' | 'move' | 'up';
			w: number;
			zmm: number;
			native: PointerEvent;
		}) => boolean;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();

	let img: RawImage | null = $state.raw(null);
	let stepMM = $state(0.25);
	let loading = $state(false);

	const offscreen = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	let lastWindowKey = '';
	let fetchSeq = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | undefined;

	// cross = perpendicular to the curve; tangential = along the curve direction
	let orientation = $state<'cross' | 'tangential'>('cross');

	$effect(() => {
		const c = ps.curve;
		const u = ps.crossU;
		const orient = orientation;
		clearTimeout(fetchTimer);
		if (!c) {
			img = null;
			return;
		}
		const i = indexAtLength(c, u);
		const origin = c.points[i];
		const dir = orient === 'cross' ? c.normals[i] : c.tangents[i];
		const seq = ++fetchSeq;
		fetchTimer = setTimeout(async () => {
			loading = true;
			try {
				const res = await fetch(`/api/datasets/${ps.ds.id}/cross`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ origin, dir, halfWidth, step: 0.25 })
				});
				if (!res.ok) return;
				const width = Number(res.headers.get('X-Width'));
				const height = Number(res.headers.get('X-Height'));
				stepMM = Number(res.headers.get('X-Step')) || 0.25;
				const buf = await res.arrayBuffer();
				if (seq === fetchSeq) {
					img = { width, height, data: new Int16Array(buf) };
					lastWindowKey = '';
					draw();
				}
			} finally {
				if (seq === fetchSeq) loading = false;
			}
		}, 60);
	});

	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		if (!img || !offscreen) return;

		const key = `${ps.wc}:${ps.ww}:${img.width}x${img.height}`;
		if (key !== lastWindowKey) {
			windowInto(offscreen, img, ps.wc, ps.ww);
			lastWindowKey = key;
		}
		const t = fitTransform(canvas.width, canvas.height, img, stepMM, ps.ds.spacing_z);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(offscreen, t.ox, t.oy, img.width * t.scaleX, img.height * t.scaleY);

		// center line = curve position
		const cx = t.ox + (img.width / 2) * t.scaleX;
		ctx.strokeStyle = 'rgba(69, 184, 224, 0.35)';
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(cx, t.oy);
		ctx.lineTo(cx, t.oy + img.height * t.scaleY);
		ctx.stroke();
		ctx.setLineDash([]);

		if (orientation === 'cross') {
			overlayDraw?.(ctx, t, { stepMM, width: img.width, height: img.height });
		}

		ctx.fillStyle = 'rgba(216, 220, 228, 0.85)';
		ctx.font = '11px Inter, sans-serif';
		ctx.fillText(`@ ${ps.crossU.toFixed(1)} mm`, 8, canvas.height - 8);
		drawScaleBar(ctx, t.scaleX / stepMM, canvas.width, canvas.height);
		if (orientation === 'cross') {
			// B/L orientation: normal points left of travel; with a counterclockwise-drawn
			// arch (right→left), the normal points buccally (outward)
			ctx.fillStyle = 'rgba(138, 145, 160, 0.9)';
			ctx.font = '10px Inter, sans-serif';
			ctx.fillText('B', canvas.width - 14, canvas.height / 2);
			ctx.fillText('L', 6, canvas.height / 2);
		}
	}

	$effect(() => {
		void ps.wc;
		void ps.ww;
		void overlayDeps;
		void img;
		draw();
	});

	$effect(() => {
		if (!container || !canvas) return;
		const ro = new ResizeObserver(() => {
			if (!canvas || !container) return;
			canvas.width = container.clientWidth;
			canvas.height = container.clientHeight;
			draw();
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const c = ps.curve;
		if (!c) return;
		const delta = e.deltaY > 0 ? 1 : -1;
		ps.crossU = Math.max(0, Math.min(c.length, ps.crossU + delta));
	}

	// ---------- tool interaction ----------
	let toolDragging = false;

	function domainCoords(e: PointerEvent): { w: number; zmm: number } | null {
		if (!canvas || !img) return null;
		const t = fitTransform(canvas.width, canvas.height, img, stepMM, ps.ds.spacing_z);
		const px = (e.offsetX - t.ox) / t.scaleX - 0.5;
		const py = (e.offsetY - t.oy) / t.scaleY - 0.5;
		return { w: (px - (img.width - 1) / 2) * stepMM, zmm: (img.height - 1 - py) * ps.ds.spacing_z };
	}

	function toolEvent(type: 'down' | 'move' | 'up', e: PointerEvent): boolean {
		if (!onToolPointer) return false;
		const d = domainCoords(e);
		if (!d) return false;
		return onToolPointer({ type, w: d.w, zmm: d.zmm, native: e });
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		canvas?.setPointerCapture(e.pointerId);
		if (toolEvent('down', e)) toolDragging = true;
	}
	function onPointerMove(e: PointerEvent) {
		if (toolDragging) toolEvent('move', e);
	}
	function onPointerUp(e: PointerEvent) {
		if (toolDragging) toolEvent('up', e);
		toolDragging = false;
	}
</script>

<div class="cross-view" bind:this={container}>
	<canvas
		bind:this={canvas}
		onwheel={onWheel}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>
	<div class="view-label">{orientation === 'cross' ? 'Cross section' : 'Tangential'}</div>
	<button
		class="orient-toggle"
		title="Toggle cross-section / tangential"
		onclick={() => (orientation = orientation === 'cross' ? 'tangential' : 'cross')}
	>
		{orientation === 'cross' ? '⊥' : '∥'}
	</button>
	<button
		class="orient-toggle snap-pos"
		title="Save view snapshot (PNG)"
		onclick={() => canvas && downloadCanvas(canvas, `${orientation}_${ps.crossU.toFixed(0)}mm`)}
		>📷</button
	>
	{#if !ps.curve}
		<div class="cross-hint muted">Requires a panoramic curve.</div>
	{/if}
</div>

<style>
	.cross-view {
		position: relative;
		width: 100%;
		height: 100%;
		background: #000;
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
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
	.cross-hint {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}
	.orient-toggle {
		position: absolute;
		top: 4px;
		right: 6px;
		width: 22px;
		height: 22px;
		border-radius: 3px;
		border: 1px solid var(--border);
		background: var(--bg-2);
		color: var(--text-dim);
		font-size: 13px;
		opacity: 0.4;
		transition: opacity 0.15s;
	}
	.cross-view:hover .orient-toggle {
		opacity: 1;
	}
	.orient-toggle:hover {
		color: var(--text);
		border-color: var(--accent-dim);
	}
	.snap-pos {
		right: 32px;
		font-size: 11px;
	}
</style>
