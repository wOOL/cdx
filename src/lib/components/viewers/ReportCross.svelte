<script lang="ts">
	import { onMount } from 'svelte';
	import type { PlanningState, ImplantData } from '$lib/client/planning.svelte';
	import { crossFrame, drawCrossOverlay } from '$lib/client/planTools';
	import { fitTransform, windowInto, type RawImage } from '$lib/client/render2d';

	let { state: ps, implant }: { state: PlanningState; implant: ImplantData } = $props();

	let canvas: HTMLCanvasElement | undefined = $state();

	onMount(async () => {
		const head = { x: implant.x, y: implant.y, z: implant.z };
		const u = ps.toPano(head)?.u;
		const frame = crossFrame(ps, u);
		if (!canvas || !frame || u == null) return;

		const res = await fetch(`/api/datasets/${ps.ds.id}/cross`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ origin: frame.origin, dir: frame.normal, halfWidth: 14, step: 0.25 })
		});
		if (!res.ok) return;
		const width = Number(res.headers.get('X-Width'));
		const height = Number(res.headers.get('X-Height'));
		const stepMM = Number(res.headers.get('X-Step')) || 0.25;
		const img: RawImage = { width, height, data: new Int16Array(await res.arrayBuffer()) };

		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		const off = document.createElement('canvas');
		windowInto(off, img, ps.wc, ps.ww);
		const t = fitTransform(canvas.width, canvas.height, img, stepMM, ps.ds.spacing_z);
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(off, t.ox, t.oy, img.width * t.scaleX, img.height * t.scaleY);
		drawCrossOverlay(ps, ctx, t, { stepMM, width, height }, u);
	});
</script>

<canvas bind:this={canvas} width="280" height="260"></canvas>

<style>
	canvas {
		width: 100%;
		background: #000;
		border-radius: 2px;
	}
</style>
