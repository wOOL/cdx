<script lang="ts">
	/**
	 * Angle Between Abutments dialog (SPEC §6.6). Display only — no align
	 * actions. The caller passes only implants that have an abutment; each
	 * pair's axis angle is checked against an editable acceptable deviation
	 * (insertion-path tolerance of the abutment system).
	 */
	interface AbutmentRow {
		id: number;
		label: string;
		ax: number;
		ay: number;
		az: number;
		abutmentAngle?: number;
	}

	let {
		implants,
		accept = 15,
		onclose
	}: {
		implants: AbutmentRow[];
		accept?: number;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally -- `accept` only seeds the editable input
	let threshold = $state(accept);

	function angleDeg(a: AbutmentRow, b: AbutmentRow): number {
		const la = Math.hypot(a.ax, a.ay, a.az);
		const lb = Math.hypot(b.ax, b.ay, b.az);
		if (la < 1e-9 || lb < 1e-9) return 0;
		const dot = Math.max(
			-1,
			Math.min(1, (a.ax * b.ax + a.ay * b.ay + a.az * b.az) / (la * lb))
		);
		return (Math.acos(dot) * 180) / Math.PI;
	}

	const pairs = $derived.by(() => {
		const out: { a: AbutmentRow; b: AbutmentRow; angle: number }[] = [];
		for (let i = 0; i < implants.length; i++) {
			for (let j = i + 1; j < implants.length; j++) {
				out.push({ a: implants[i], b: implants[j], angle: angleDeg(implants[i], implants[j]) });
			}
		}
		return out;
	});
</script>

<div class="aba-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="aba-dialog panel">
		<div class="dialog-title">Angle between abutments</div>
		<div class="aba-body">
			<table class="aba-table">
				<thead>
					<tr><th>Implant</th><th>Abutment angle</th></tr>
				</thead>
				<tbody>
					{#each implants as im (im.id)}
						<tr>
							<td>{im.label}</td>
							<td class="aba-num">
								{im.abutmentAngle != null ? `${im.abutmentAngle.toFixed(1)}°` : 'straight'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<label class="aba-accept">
				Acceptable deviation
				<input type="number" min="0" max="90" step="0.5" bind:value={threshold} />
				°
			</label>

			<table class="aba-table">
				<thead>
					<tr><th>Abutment A</th><th>Abutment B</th><th>Angle</th><th>Status</th></tr>
				</thead>
				<tbody>
					{#each pairs as p (`${p.a.id}-${p.b.id}`)}
						<tr>
							<td>{p.a.label}</td>
							<td>{p.b.label}</td>
							<td class="aba-num">{p.angle.toFixed(1)}°</td>
							<td>
								{#if p.angle <= threshold}
									<span class="aba-ok">OK</span>
								{:else}
									<span class="aba-exceeds">EXCEEDS</span>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="4" class="aba-empty">At least two abutments are required.</td></tr>
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
	.aba-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.aba-dialog {
		min-width: 520px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
	}
	.aba-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
	}
	.aba-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.aba-table th,
	.aba-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 5px 8px;
		text-align: left;
	}
	.aba-num {
		font-family: var(--mono);
		text-align: right;
	}
	.aba-accept {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text);
		text-transform: none;
		letter-spacing: 0;
	}
	.aba-accept input {
		width: 64px;
	}
	.aba-ok {
		color: var(--green);
		font-weight: 600;
	}
	.aba-exceeds {
		color: var(--red);
		font-weight: 600;
	}
	.aba-empty {
		color: var(--text-dim);
	}
</style>
