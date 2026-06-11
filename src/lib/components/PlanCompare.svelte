<script lang="ts">
	import { onMount } from 'svelte';
	import { toothLabel, type Notation } from '$lib/implantLibrary';
	import type { Implant, Plan } from '$lib/types';

	let {
		plans,
		currentPlanId,
		notation,
		onclose
	}: { plans: Plan[]; currentPlanId: number; notation: Notation; onclose: () => void } = $props();

	let planA = $state(currentPlanId);
	let planB = $state(plans.find((p) => p.id !== currentPlanId)?.id ?? currentPlanId);
	let implantsA = $state.raw<Implant[]>([]);
	let implantsB = $state.raw<Implant[]>([]);

	async function load() {
		const [ra, rb] = await Promise.all([
			fetch(`/api/plans/${planA}/implants`),
			fetch(`/api/plans/${planB}/implants`)
		]);
		implantsA = ra.ok ? (await ra.json()).implants : [];
		implantsB = rb.ok ? (await rb.json()).implants : [];
	}
	onMount(load);

	let rows = $derived.by(() => {
		const teeth = new Set<string>([
			...implantsA.map((i) => i.tooth || `#${i.id}`),
			...implantsB.map((i) => i.tooth || `#${i.id}`)
		]);
		return [...teeth].sort().map((tooth) => {
			const a = implantsA.find((i) => (i.tooth || `#${i.id}`) === tooth);
			const b = implantsB.find((i) => (i.tooth || `#${i.id}`) === tooth);
			let dPos: number | null = null;
			let dAngle: number | null = null;
			if (a && b) {
				dPos = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
				const dot = a.ax * b.ax + a.ay * b.ay + a.az * b.az;
				dAngle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
			}
			return { tooth, a, b, dPos, dAngle };
		});
	});

	const fmtImplant = (i?: Implant) =>
		i ? `${i.manufacturer} ⌀${i.diameter.toFixed(1)}×${i.length.toFixed(1)}` : '—';
</script>

<div class="pc-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="pc-dialog panel">
		<div class="dialog-title">Compare plans</div>
		<div class="pc-body">
			<div class="pc-selects">
				<select bind:value={planA} onchange={load}>
					{#each plans as p (p.id)}<option value={p.id}>A: {p.name}</option>{/each}
				</select>
				<span class="muted">vs</span>
				<select bind:value={planB} onchange={load}>
					{#each plans as p (p.id)}<option value={p.id}>B: {p.name}</option>{/each}
				</select>
			</div>
			<table class="pc-table">
				<thead>
					<tr>
						<th>Tooth</th>
						<th>Plan A</th>
						<th>Plan B</th>
						<th>Δ position</th>
						<th>Δ axis</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.tooth)}
						<tr>
							<td><strong>{toothLabel(r.tooth, notation)}</strong></td>
							<td>{fmtImplant(r.a)}</td>
							<td>{fmtImplant(r.b)}</td>
							<td class:pc-diff={r.dPos != null && r.dPos > 0.05}>
								{r.dPos != null ? `${r.dPos.toFixed(2)} mm` : r.a ? 'only in A' : 'only in B'}
							</td>
							<td class:pc-diff={r.dAngle != null && r.dAngle > 0.5}>
								{r.dAngle != null ? `${r.dAngle.toFixed(1)}°` : '—'}
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="muted">No implants in either plan.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="dialog-actions">
			<button class="btn primary" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.pc-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.pc-dialog {
		min-width: 560px;
		box-shadow: var(--shadow);
	}
	.pc-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-height: 60vh;
		overflow-y: auto;
	}
	.pc-selects {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.pc-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.pc-table th,
	.pc-table td {
		border: 1px solid var(--border-soft);
		padding: 5px 8px;
		text-align: left;
	}
	.pc-table th {
		background: var(--bg-3);
	}
	.pc-diff {
		color: var(--accent-2);
		font-weight: 600;
	}
</style>
