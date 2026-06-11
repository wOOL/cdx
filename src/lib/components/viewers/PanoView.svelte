<script lang="ts">
	import type { PlanningState } from '$lib/client/planning.svelte';
	import {
		fitTransform,
		windowInto,
		type RawImage,
		type ReconInfo,
		type ViewTransform
	} from '$lib/client/render2d';

	let {
		state: ps,
		overlayDraw,
		overlayDeps,
		onToolPointer
	}: {
		state: PlanningState;
		overlayDraw?: (ctx: CanvasRenderingContext2D, t: ViewTransform, info: ReconInfo) => void;
		overlayDeps?: unknown;
		/** domain coords: u = mm along curve, zmm = height in mm. Return true to consume. */
		onToolPointer?: (e: {
			type: 'down' | 'move' | 'up';
			u: number;
			zmm: number;
			native: PointerEvent;
		}) => boolean;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();

	let img: RawImage | null = $state.raw(null);
	let stepMM = 0.5;
	let loading = $state(false);

	const offscreen = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	let lastWindowKey = '';
	let fetchSeq = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | undefined;

	// re-fetch panorama whenever the curve or thickness changes (debounced)
	$effect(() => {
		const control = ps.curveControl.map((p) => ({ x: p.x, y: p.y }));
		const thickness = ps.panoThickness;
		clearTimeout(fetchTimer);
		if (control.length < 2) {
			img = null;
			return;
		}
		const seq = ++fetchSeq;
		fetchTimer = setTimeout(async () => {
			loading = true;
			try {
				const res = await fetch(`/api/datasets/${ps.ds.id}/pano`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ control, step: stepMM, thickness })
				});
				if (!res.ok) return;
				const width = Number(res.headers.get('X-Width'));
				const height = Number(res.headers.get('X-Height'));
				const buf = await res.arrayBuffer();
				if (seq === fetchSeq) {
					img = { width, height, data: new Int16Array(buf) };
					lastWindowKey = '';
					draw();
				}
			} finally {
				if (seq === fetchSeq) loading = false;
			}
		}, 120);
	});

	function transform(): ViewTransform | null {
		if (!canvas || !img) return null;
		return fitTransform(canvas.width, canvas.height, img, stepMM, ps.ds.spacing_z);
	}

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
		const t = transform()!;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(offscreen, t.ox, t.oy, img.width * t.scaleX, img.height * t.scaleY);

		// cross-section position indicator
		const cu = ps.crossU / stepMM;
		const cx = t.ox + (cu + 0.5) * t.scaleX;
		ctx.strokeStyle = 'rgba(240, 138, 36, 0.9)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(cx, t.oy);
		ctx.lineTo(cx, t.oy + img.height * t.scaleY);
		ctx.stroke();
		ctx.fillStyle = 'rgba(240, 138, 36, 0.9)';
		ctx.beginPath();
		ctx.moveTo(cx - 5, t.oy);
		ctx.lineTo(cx + 5, t.oy);
		ctx.lineTo(cx, t.oy + 8);
		ctx.closePath();
		ctx.fill();

		overlayDraw?.(ctx, t, { stepMM, width: img.width, height: img.height });

		ctx.fillStyle = 'rgba(216, 220, 228, 0.85)';
		ctx.font = '11px Inter, sans-serif';
		ctx.fillText(`${ps.crossU.toFixed(1)} mm`, 8, canvas.height - 8);
	}

	$effect(() => {
		void ps.wc;
		void ps.ww;
		void ps.crossU;
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

	// ---------- interaction ----------
	let dragging: 'scrub' | 'tool' | false = false;

	function domainCoords(e: PointerEvent): { u: number; zmm: number } | null {
		const t = transform();
		if (!t || !img) return null;
		const px = (e.offsetX - t.ox) / t.scaleX - 0.5;
		const py = (e.offsetY - t.oy) / t.scaleY - 0.5;
		return { u: px * stepMM, zmm: (img.height - 1 - py) * ps.ds.spacing_z };
	}

	function toolEvent(type: 'down' | 'move' | 'up', e: PointerEvent): boolean {
		if (!onToolPointer) return false;
		const d = domainCoords(e);
		if (!d) return false;
		return onToolPointer({ type, u: d.u, zmm: d.zmm, native: e });
	}

	function setUFromCanvas(cx: number) {
		const t = transform();
		const c = ps.curve;
		if (!t || !c) return;
		const u = ((cx - t.ox) / t.scaleX - 0.5) * stepMM;
		ps.crossU = Math.max(0, Math.min(c.length, u));
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		canvas?.setPointerCapture(e.pointerId);
		if (toolEvent('down', e)) {
			dragging = 'tool';
			return;
		}
		dragging = 'scrub';
		setUFromCanvas(e.offsetX);
	}
	function onPointerMove(e: PointerEvent) {
		if (dragging === 'tool') toolEvent('move', e);
		else if (dragging === 'scrub') setUFromCanvas(e.offsetX);
	}
	function onPointerUp(e: PointerEvent) {
		if (dragging === 'tool') toolEvent('up', e);
		dragging = false;
	}
	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const c = ps.curve;
		if (!c) return;
		ps.crossU = Math.max(0, Math.min(c.length, ps.crossU + (e.deltaY > 0 ? 1 : -1)));
	}
</script>

<div class="pano-view" bind:this={container}>
	<canvas
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onwheel={onWheel}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>
	<div class="view-label">Panoramic</div>
	{#if !ps.curve}
		<div class="pano-hint muted">
			Define the panoramic curve: enable <strong>Draw curve</strong> and click along the dental arch
			in the axial view.
		</div>
	{:else if loading && !img}
		<div class="pano-hint muted">Reconstructing…</div>
	{/if}
</div>

<style>
	.pano-view {
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
	.pano-hint {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		text-align: center;
		padding: 20px;
		pointer-events: none;
	}
</style>
