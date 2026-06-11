<script lang="ts">
	import type { PlanningState } from '$lib/client/planning.svelte';
	import { indexAtLength } from '$lib/curve';
	import {
		drawScaleBar,
		fitTransform,
		handleSnapshot,
		windowInto,
		type RawImage,
		type ReconInfo,
		type ViewTransform
	} from '$lib/client/render2d';

	let {
		state: ps,
		halfWidth = 15,
		uOffset = 0,
		compact = false,
		overlayDraw,
		overlayDeps,
		onToolPointer
	}: {
		state: PlanningState;
		halfWidth?: number;
		/** arc-length offset from ps.crossU (mm) — for parallel section groups */
		uOffset?: number;
		/** hide toggles/labels for use inside a section group */
		compact?: boolean;
		overlayDraw?: (
			ctx: CanvasRenderingContext2D,
			t: ViewTransform,
			info: ReconInfo,
			u: number,
			frame: { origin: { x: number; y: number }; normal: { x: number; y: number }; tangent: { x: number; y: number } } | null
		) => void;
		overlayDeps?: unknown;
		/** domain coords: w = signed mm offset from the curve along its normal, zmm = height in mm */
		onToolPointer?: (e: {
			type: 'down' | 'move' | 'up';
			w: number;
			zmm: number;
			native: PointerEvent;
		}) => boolean;
	} = $props();

	let effU = $derived.by(() => {
		const c = ps.curve;
		if (!c) return 0;
		return Math.max(0, Math.min(c.length, ps.crossU + uOffset));
	});

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();

	let img: RawImage | null = $state.raw(null);
	let stepMM = $state(0.25);
	let loading = $state(false);
	let snapSaved = $state(false);

	const offscreen = typeof document !== 'undefined' ? document.createElement('canvas') : null;
	let lastWindowKey = '';
	let fetchSeq = 0;
	let fetchTimer: ReturnType<typeof setTimeout> | undefined;
	let lastFrame: {
		origin: { x: number; y: number };
		normal: { x: number; y: number };
		tangent: { x: number; y: number };
	} | null = null;

	// cross = perpendicular to the curve; tangential = along the curve direction
	let orientation = $state<'cross' | 'tangential'>('cross');
	// align the section plane with the selected implant axis
	let alignToImplant = $state(false);

	$effect(() => {
		const c = ps.curve;
		const u = effU;
		const orient = orientation;
		clearTimeout(fetchTimer);
		if (!c) {
			img = null;
			return;
		}
		const i = indexAtLength(c, u);
		let origin: { x: number; y: number } = c.points[i];
		let dir = orient === 'cross' ? c.normals[i] : c.tangents[i];
		let tangent = orient === 'cross' ? c.tangents[i] : c.normals[i];
		if (alignToImplant && ps.selectedImplantId != null) {
			const im = ps.implants.find((im) => im.id === ps.selectedImplantId);
			if (im) {
				const len = Math.hypot(im.ax, im.ay);
				if (len > 0.05) {
					// plane containing the implant axis (and the z direction)
					origin = { x: im.x, y: im.y };
					dir = { x: im.ax / len, y: im.ay / len };
					tangent = { x: -dir.y, y: dir.x };
				}
			}
		}
		lastFrame = { origin, normal: dir, tangent };
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

		// axial slice reference line (cyan, like the axial view accent)
		const zPy = img.height - 1 - ps.cursor.z;
		const zy = t.oy + (zPy + 0.5) * t.scaleY;
		ctx.strokeStyle = 'rgba(47, 158, 199, 0.45)';
		ctx.beginPath();
		ctx.moveTo(t.ox, zy);
		ctx.lineTo(t.ox + img.width * t.scaleX, zy);
		ctx.stroke();
		ctx.setLineDash([]);

		if (orientation === 'cross') {
			overlayDraw?.(ctx, t, { stepMM, width: img.width, height: img.height }, effU, lastFrame);
		}

		ctx.fillStyle = 'rgba(216, 220, 228, 0.85)';
		ctx.font = '11px Inter, sans-serif';
		ctx.fillText(
			`@ ${effU.toFixed(1)} mm${uOffset ? ` (${uOffset > 0 ? '+' : ''}${uOffset})` : ''}${alignToImplant ? ' · implant axis' : ''}`,
			8,
			canvas.height - 8
		);
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
		void ps.cursor.z;
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
		// tools operate in the curve frame at ps.crossU — disable in offset/aligned variants
		if (!onToolPointer || uOffset !== 0 || alignToImplant) return false;
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
	{#if !compact}
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
			title="Snapshot → image library (Alt+click to download)"
			onclick={async (e) => {
				if (!canvas) return;
				if (await handleSnapshot(e, canvas, `${orientation}_${effU.toFixed(0)}mm`, ps.ds.case_id)) {
					snapSaved = true;
					setTimeout(() => (snapSaved = false), 1200);
				}
			}}>{snapSaved ? '✓' : '📷'}</button
		>
		{#if ps.selectedImplantId != null}
			<button
				class="orient-toggle align-pos"
				class:align-active={alignToImplant}
				title="Align section to the selected implant axis"
				onclick={() => (alignToImplant = !alignToImplant)}
			>
				⟂⌖
			</button>
		{/if}
	{/if}
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
	.align-pos {
		right: 58px;
		width: 30px;
		font-size: 10px;
	}
	.align-active {
		color: var(--accent-bright);
		border-color: var(--accent);
		opacity: 1 !important;
	}
</style>
