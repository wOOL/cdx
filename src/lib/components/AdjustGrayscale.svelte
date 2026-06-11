<script lang="ts">
	import { onMount } from 'svelte';
	import { PlanningState, WINDOW_PRESETS } from '$lib/client/planning.svelte';

	let { state: ps, onclose }: { state: PlanningState; onclose: () => void } = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let hist: { lo: number; hi: number; bins: number[] } | null = $state.raw(null);

	// window bounds derived from wc/ww
	let lo = $derived(ps.wc - ps.ww / 2);
	let hi = $derived(ps.wc + ps.ww / 2);

	onMount(async () => {
		const res = await fetch(`/api/datasets/${ps.ds.id}/histogram`);
		if (res.ok) hist = await res.json();
	});

	const W = 460;
	const H = 140;

	function xToHU(x: number): number {
		if (!hist) return 0;
		return hist.lo + (x / W) * (hist.hi - hist.lo);
	}
	function huToX(hu: number): number {
		if (!hist) return 0;
		return ((hu - hist.lo) / (hist.hi - hist.lo)) * W;
	}

	$effect(() => {
		if (!canvas || !hist) return;
		void ps.wc;
		void ps.ww;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#12151a';
		ctx.fillRect(0, 0, W, H);

		// log-scaled bars
		const max = Math.log10(Math.max(...hist.bins) + 1);
		ctx.fillStyle = '#3a4150';
		const bw = W / hist.bins.length;
		hist.bins.forEach((c, i) => {
			const h = (Math.log10(c + 1) / max) * (H - 16);
			ctx.fillRect(i * bw, H - h, bw - 0.5, h);
		});

		// window region + ramp
		const x1 = huToX(lo);
		const x2 = huToX(hi);
		ctx.fillStyle = 'rgba(47, 158, 199, 0.15)';
		ctx.fillRect(x1, 0, x2 - x1, H);
		ctx.strokeStyle = '#45b8e0';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(0, H - 2);
		ctx.lineTo(x1, H - 2);
		ctx.lineTo(x2, 8);
		ctx.lineTo(W, 8);
		ctx.stroke();

		// handles
		for (const x of [x1, x2]) {
			ctx.fillStyle = '#45b8e0';
			ctx.fillRect(x - 2, 0, 4, H);
		}
	});

	let dragging: 'lo' | 'hi' | null = null;

	function onPointerDown(e: PointerEvent) {
		if (!hist) return;
		canvas?.setPointerCapture(e.pointerId);
		const x = e.offsetX;
		dragging = Math.abs(x - huToX(lo)) < Math.abs(x - huToX(hi)) ? 'lo' : 'hi';
		onPointerMove(e);
	}
	function onPointerMove(e: PointerEvent) {
		if (!dragging || !hist) return;
		const hu = Math.round(xToHU(Math.max(0, Math.min(W, e.offsetX))));
		let nlo = lo;
		let nhi = hi;
		if (dragging === 'lo') nlo = Math.min(hu, nhi - 10);
		else nhi = Math.max(hu, nlo + 10);
		ps.wc = (nlo + nhi) / 2;
		ps.ww = nhi - nlo;
	}
	function onPointerUp() {
		dragging = null;
	}

	function setNum(field: 'lo' | 'hi' | 'wc' | 'ww', v: number) {
		if (!Number.isFinite(v)) return;
		if (field === 'wc') ps.wc = v;
		else if (field === 'ww') ps.ww = Math.max(10, v);
		else if (field === 'lo') {
			const nhi = Math.max(hi, v + 10);
			ps.wc = (v + nhi) / 2;
			ps.ww = nhi - v;
		} else {
			const nlo = Math.min(lo, v - 10);
			ps.wc = (nlo + v) / 2;
			ps.ww = v - nlo;
		}
	}
</script>

<div class="ag-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="ag-dialog panel">
		<div class="dialog-title">Adjust grayscale</div>
		<div class="ag-body">
			<canvas
				bind:this={canvas}
				width={W}
				height={H}
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
			></canvas>
			<div class="ag-row">
				<label for="ag-left">Left (HU)</label>
				<input id="ag-left" type="number" value={Math.round(lo)} onchange={(e) => setNum('lo', Number(e.currentTarget.value))} />
				<label for="ag-level">Level</label>
				<input id="ag-level" type="number" value={Math.round(ps.wc)} onchange={(e) => setNum('wc', Number(e.currentTarget.value))} />
				<label for="ag-width">Width</label>
				<input id="ag-width" type="number" value={Math.round(ps.ww)} onchange={(e) => setNum('ww', Number(e.currentTarget.value))} />
				<label for="ag-right">Right (HU)</label>
				<input id="ag-right" type="number" value={Math.round(hi)} onchange={(e) => setNum('hi', Number(e.currentTarget.value))} />
			</div>
			<div class="ag-presets">
				{#each WINDOW_PRESETS as p (p.name)}
					<button
						class="btn"
						onclick={() => {
							ps.wc = p.wc;
							ps.ww = p.ww;
						}}>{p.name}</button
					>
				{/each}
			</div>
		</div>
		<div class="dialog-actions">
			<button class="btn primary" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.ag-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.ag-dialog {
		min-width: 500px;
		box-shadow: var(--shadow);
	}
	.ag-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	canvas {
		border: 1px solid var(--border-soft);
		border-radius: 3px;
		cursor: ew-resize;
		touch-action: none;
	}
	.ag-row {
		display: grid;
		grid-template-columns: auto 1fr auto 1fr auto 1fr auto 1fr;
		gap: 6px;
		align-items: center;
	}
	.ag-row label {
		margin: 0;
	}
	.ag-row input {
		width: 70px;
	}
	.ag-presets {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
</style>
