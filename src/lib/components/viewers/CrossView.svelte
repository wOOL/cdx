<script lang="ts">
	import type { PlanningState } from '$lib/client/planning.svelte';
	import { indexAtLength } from '$lib/curve';
	import { fitTransform, windowInto, type RawImage, type ViewTransform } from '$lib/client/render2d';

	let {
		state: ps,
		halfWidth = 15,
		overlayDraw,
		overlayDeps
	}: {
		state: PlanningState;
		halfWidth?: number;
		overlayDraw?: (ctx: CanvasRenderingContext2D, t: ViewTransform, stepMM: number) => void;
		overlayDeps?: unknown;
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

	$effect(() => {
		const c = ps.curve;
		const u = ps.crossU;
		clearTimeout(fetchTimer);
		if (!c) {
			img = null;
			return;
		}
		const i = indexAtLength(c, u);
		const origin = c.points[i];
		const dir = c.normals[i];
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

		overlayDraw?.(ctx, t, stepMM);

		ctx.fillStyle = 'rgba(216, 220, 228, 0.85)';
		ctx.font = '11px Inter, sans-serif';
		ctx.fillText(`@ ${ps.crossU.toFixed(1)} mm`, 8, canvas.height - 8);
		// B/L orientation: normal points left of travel; with a counterclockwise-drawn
		// arch (right→left), the normal points buccally (outward)
		ctx.fillStyle = 'rgba(138, 145, 160, 0.9)';
		ctx.font = '10px Inter, sans-serif';
		ctx.fillText('B', canvas.width - 14, canvas.height / 2);
		ctx.fillText('L', 6, canvas.height / 2);
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
</script>

<div class="cross-view" bind:this={container}>
	<canvas bind:this={canvas} onwheel={onWheel} oncontextmenu={(e) => e.preventDefault()}></canvas>
	<div class="view-label">Cross section</div>
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
</style>
