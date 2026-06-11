<script lang="ts">
	import { onMount } from 'svelte';
	import type { PlanningState } from '$lib/client/planning.svelte';
	import { nerveMaxRadius } from '$lib/client/planning.svelte';
	import { add, scale, segPolylineDistance, type Vec3 } from '$lib/geometry';
	import Icon from '$lib/components/Icon.svelte';

	let {
		state: ps,
		kind,
		onclose
	}: { state: PlanningState; kind: 'nerve' | 'implant'; onclose: () => void } = $props();

	let el: HTMLDivElement | undefined = $state();

	const selected = $derived(ps.implants.find((i) => i.id === ps.selectedImplantId) ?? null);

	interface Row {
		id: number;
		label: string;
		distance: number;
		limit: number;
	}

	/** surface clearances, computed exactly like PlanningState.liveDistances:
	 *  segment-to-polyline distance minus both radii */
	const rows = $derived.by((): Row[] => {
		const im = selected;
		if (!im) return [];
		const head: Vec3 = { x: im.x, y: im.y, z: im.z };
		const apex = add(head, scale({ x: im.ax, y: im.ay, z: im.az }, im.length));
		if (kind === 'nerve') {
			return ps.nerves
				.filter((n) => n.points.length > 0)
				.map((n) => ({
					id: n.id,
					label: n.name,
					distance: segPolylineDistance(head, apex, n.points) - im.diameter / 2 - nerveMaxRadius(n),
					limit: ps.nerveSafety
				}));
		}
		return ps.implants
			.filter((o) => o.id !== im.id)
			.map((o) => {
				const oHead: Vec3 = { x: o.x, y: o.y, z: o.z };
				const oApex = add(oHead, scale({ x: o.ax, y: o.ay, z: o.az }, o.length));
				return {
					id: o.id,
					label: o.tooth ? `Tooth ${o.tooth} · ${o.article}` : o.article || `Implant ${o.id}`,
					distance:
						segPolylineDistance(head, apex, [oHead, oApex]) - im.diameter / 2 - o.diameter / 2,
					limit: ps.implantSafety
				};
			});
	});

	onMount(() => {
		const handler = (e: PointerEvent) => {
			if (el && !el.contains(e.target as Node)) onclose();
		};
		// defer so the click that opened the popover doesn't immediately close it
		const t = setTimeout(() => document.addEventListener('pointerdown', handler), 0);
		return () => {
			clearTimeout(t);
			document.removeEventListener('pointerdown', handler);
		};
	});
</script>

<div class="dist-popover panel" bind:this={el}>
	<div class="dp-header">
		<span>
			{kind === 'nerve' ? 'Nerve clearances' : 'Implant clearances'}
			{#if selected?.tooth}— tooth {selected.tooth}{/if}
		</span>
		<button class="btn ghost dp-close" title="Close" onclick={onclose}>
			<Icon name="close" size={12} />
		</button>
	</div>
	<div class="dp-body">
		{#if !selected}
			<div class="muted">No implant selected.</div>
		{:else if rows.length === 0}
			<div class="muted">No {kind === 'nerve' ? 'nerves' : 'other implants'} in this plan.</div>
		{:else}
			<ul class="dp-list">
				{#each rows as r (r.id)}
					<li>
						<span class="dp-label" title={r.label}>{r.label}</span>
						<span class="dp-dist" class:dp-bad={r.distance < r.limit}>
							{r.distance.toFixed(1)} mm
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.dist-popover {
		position: fixed;
		left: 12px;
		bottom: 34px;
		z-index: 60;
		min-width: 230px;
		max-width: 320px;
		box-shadow: var(--shadow);
	}
	.dp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 8px 6px 10px;
		border-bottom: 1px solid var(--border-soft);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.dp-close {
		padding: 2px 4px;
	}
	.dp-body {
		padding: 8px 10px;
		font-size: 12px;
	}
	.dp-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.dp-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.dp-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dp-dist {
		font-family: var(--mono);
		color: var(--green);
		flex: none;
	}
	.dp-dist.dp-bad {
		color: var(--red);
	}
</style>
