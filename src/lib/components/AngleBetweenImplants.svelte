<script lang="ts">
	/**
	 * Angle Between Implants dialog (SPEC §6.6).
	 * Lives as long as the parent keeps it mounted: align actions call back
	 * into the parent, the parent updates the `implants` prop, and all angles
	 * re-derive live — the dialog stays open after aligning.
	 */
	interface ImplantRow {
		id: number;
		label: string;
		ax: number;
		ay: number;
		az: number;
	}

	let {
		implants,
		onalign,
		onclose
	}: {
		implants: ImplantRow[];
		onalign: (ids: number[], axis: { x: number; y: number; z: number }) => Promise<void>;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally -- initial selection is intentionally a snapshot
	let selected = $state<Set<number>>(new Set(implants.map((i) => i.id)));
	let masterId = $state<number | null>(null);
	let busy = $state(false);

	function unit(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
		const l = Math.hypot(v.x, v.y, v.z);
		return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : null;
	}

	function angleDeg(a: ImplantRow, b: ImplantRow): number {
		const ua = unit({ x: a.ax, y: a.ay, z: a.az });
		const ub = unit({ x: b.ax, y: b.ay, z: b.az });
		if (!ua || !ub) return 0;
		const dot = Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z));
		return (Math.acos(dot) * 180) / Math.PI;
	}

	const master = $derived(implants.find((i) => i.id === masterId) ?? null);

	const pairs = $derived.by(() => {
		const out: { a: ImplantRow; b: ImplantRow; angle: number }[] = [];
		for (let i = 0; i < implants.length; i++) {
			for (let j = i + 1; j < implants.length; j++) {
				out.push({ a: implants[i], b: implants[j], angle: angleDeg(implants[i], implants[j]) });
			}
		}
		return out;
	});

	const selectedIds = $derived(implants.filter((i) => selected.has(i.id)).map((i) => i.id));

	function toggle(id: number, on: boolean): void {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		selected = next;
	}

	async function alignToMaster(): Promise<void> {
		const m = master;
		if (!m || busy) return;
		const axis = unit({ x: m.ax, y: m.ay, z: m.az });
		const ids = selectedIds.filter((id) => id !== m.id);
		if (!axis || !ids.length) return;
		busy = true;
		try {
			await onalign(ids, axis);
		} finally {
			busy = false;
		}
	}

	async function alignToMean(): Promise<void> {
		if (busy) return;
		const involved = implants.filter((i) => selected.has(i.id));
		if (!involved.length) return;
		const sum = involved.reduce(
			(a, i) => ({ x: a.x + i.ax, y: a.y + i.ay, z: a.z + i.az }),
			{ x: 0, y: 0, z: 0 }
		);
		const axis = unit(sum);
		if (!axis) return;
		busy = true;
		try {
			await onalign(involved.map((i) => i.id), axis);
		} finally {
			busy = false;
		}
	}
</script>

<div class="abi-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="abi-dialog panel">
		<div class="dialog-title">Angle between implants</div>
		<div class="abi-body">
			<table class="abi-table">
				<thead>
					<tr>
						<th></th>
						<th>Implant</th>
						<th>Master</th>
						{#if master}<th>Deviation from master</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each implants as im (im.id)}
						<tr>
							<td>
								<input
									type="checkbox"
									checked={selected.has(im.id)}
									onchange={(e) => toggle(im.id, e.currentTarget.checked)}
								/>
							</td>
							<td>{im.label}</td>
							<td>
								<input
									type="radio"
									name="abi-master"
									checked={masterId === im.id}
									onchange={() => (masterId = im.id)}
								/>
							</td>
							{#if master}
								<td class="abi-num">
									{im.id === master.id ? '—' : `${angleDeg(im, master).toFixed(1)}°`}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="abi-subhead">Angles between implant pairs</div>
			<table class="abi-table">
				<thead>
					<tr><th>Implant A</th><th>Implant B</th><th>Angle</th></tr>
				</thead>
				<tbody>
					{#each pairs as p (`${p.a.id}-${p.b.id}`)}
						<tr>
							<td>{p.a.label}</td>
							<td>{p.b.label}</td>
							<td class="abi-num">{p.angle.toFixed(1)}°</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="abi-empty">At least two implants are required.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="dialog-actions">
			<button
				class="btn"
				disabled={busy || !master || !selectedIds.some((id) => id !== masterId)}
				onclick={alignToMaster}
			>
				Align selected to master
			</button>
			<button class="btn" disabled={busy || !selectedIds.length} onclick={alignToMean}>
				Align to mean direction
			</button>
			<button class="btn primary" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.abi-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.abi-dialog {
		min-width: 520px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
	}
	.abi-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
	}
	.abi-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.abi-table th,
	.abi-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 5px 8px;
		text-align: left;
	}
	.abi-num {
		font-family: var(--mono);
		text-align: right;
	}
	.abi-subhead {
		font-size: 11px;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.abi-empty {
		color: var(--text-dim);
	}
</style>
