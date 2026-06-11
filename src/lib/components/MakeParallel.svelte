<script lang="ts">
	import { onMount } from 'svelte';
	import type { PlanningState } from '$lib/client/planning.svelte';
	import { norm } from '$lib/geometry';
	import { toothLabel, type Notation } from '$lib/implantLibrary';

	let {
		state: ps,
		notation,
		onclose
	}: { state: PlanningState; notation: Notation; onclose: () => void } = $props();

	let selected = $state<Set<number>>(new Set(ps.implants.map((i) => i.id)));
	let mode = $state<'master' | 'mean'>('master');
	let masterId = $state<number>(ps.selectedImplantId ?? ps.implants[0]?.id ?? 0);

	// stash original axes for live preview / reset
	const original = new Map(ps.implants.map((i) => [i.id, { ax: i.ax, ay: i.ay, az: i.az }]));
	let previewed = $state(false);

	// record the undo snapshot BEFORE any preview mutation happens
	onMount(() => ps.markEdit());

	function targetAxis(): { x: number; y: number; z: number } | null {
		if (mode === 'master') {
			const m = ps.implants.find((i) => i.id === masterId);
			return m ? { x: m.ax, y: m.ay, z: m.az } : null;
		}
		const involved = ps.implants.filter((i) => selected.has(i.id));
		if (!involved.length) return null;
		const sum = involved.reduce(
			(a, i) => {
				const o = original.get(i.id)!;
				return { x: a.x + o.ax, y: a.y + o.ay, z: a.z + o.az };
			},
			{ x: 0, y: 0, z: 0 }
		);
		return norm(sum);
	}

	function apply(save: boolean) {
		const axis = targetAxis();
		if (!axis) return;
		for (const im of ps.implants) {
			if (!selected.has(im.id)) continue;
			if (mode === 'master' && im.id === masterId) continue;
			im.ax = axis.x;
			im.ay = axis.y;
			im.az = axis.z;
			if (save) ps.saveImplant(im.id);
		}
		previewed = !save;
		if (save) onclose();
	}

	function reset() {
		for (const im of ps.implants) {
			const o = original.get(im.id);
			if (o) {
				im.ax = o.ax;
				im.ay = o.ay;
				im.az = o.az;
			}
		}
		previewed = false;
	}

	function cancel() {
		if (previewed) reset();
		onclose();
	}
</script>

<div class="mp-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && cancel()}>
	<div class="mp-dialog panel">
		<div class="dialog-title">Make implants parallel</div>
		<div class="mp-body">
			<table class="mp-table">
				<thead>
					<tr><th></th><th>Implant</th><th>Master</th></tr>
				</thead>
				<tbody>
					{#each ps.implants as im (im.id)}
						<tr>
							<td>
								<input
									type="checkbox"
									checked={selected.has(im.id)}
									onchange={(e) => {
										const next = new Set(selected);
										if (e.currentTarget.checked) next.add(im.id);
										else next.delete(im.id);
										selected = next;
										if (previewed) {
											reset();
											apply(false);
										}
									}}
								/>
							</td>
							<td>
								{im.tooth ? `Tooth ${toothLabel(im.tooth, notation)}` : `Implant #${im.id}`} —
								{im.manufacturer} ⌀{im.diameter.toFixed(1)}×{im.length.toFixed(1)}
							</td>
							<td>
								<input
									type="radio"
									name="master"
									disabled={mode !== 'master'}
									checked={masterId === im.id}
									onchange={() => {
										masterId = im.id;
										if (previewed) {
											reset();
											apply(false);
										}
									}}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div class="mp-mode">
				<label class="mp-radio">
					<input type="radio" name="mode" value="master" bind:group={mode} />
					Align to the master implant's axis
				</label>
				<label class="mp-radio">
					<input type="radio" name="mode" value="mean" bind:group={mode} />
					Align all to the mean direction
				</label>
			</div>
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={() => (previewed ? reset() : apply(false))}>
				{previewed ? 'Reset preview' : 'Preview'}
			</button>
			<button class="btn" onclick={cancel}>Cancel</button>
			<button class="btn primary" onclick={() => apply(true)}>Apply</button>
		</div>
	</div>
</div>

<style>
	.mp-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.mp-dialog {
		min-width: 480px;
		box-shadow: var(--shadow);
	}
	.mp-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.mp-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.mp-table th,
	.mp-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 5px 8px;
		text-align: left;
	}
	.mp-mode {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mp-radio {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text);
		text-transform: none;
		letter-spacing: 0;
	}
</style>
