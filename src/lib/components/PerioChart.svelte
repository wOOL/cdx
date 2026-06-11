<script lang="ts">
	import { toothLabel, type Notation } from '$lib/implantLibrary';

	/** Six measurement directions per tooth, buccal arc then lingual arc. */
	const DIRECTIONS = ['MB', 'B', 'DB', 'ML', 'L', 'DL'] as const;

	export type PerioData = Record<string, (number | null)[]>;

	let {
		notation,
		initial,
		onsave,
		onclose
	}: {
		notation: Notation;
		initial: PerioData;
		onsave: (data: PerioData) => void;
		onclose: () => void;
	} = $props();

	const FDI_ALL = [
		18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42,
		41, 31, 32, 33, 34, 35, 36, 37, 38
	];

	let data = $state<PerioData>(JSON.parse(JSON.stringify(initial ?? {})));
	let newTooth = $state('36');

	let rows = $derived(
		Object.keys(data)
			.map(Number)
			.sort((a, b) => FDI_ALL.indexOf(a) - FDI_ALL.indexOf(b))
	);

	function addTooth() {
		if (!data[newTooth]) data[newTooth] = [null, null, null, null, null, null];
	}

	function removeTooth(t: number) {
		delete data[String(t)];
	}

	function mean(vals: (number | null)[]): number | null {
		const v = vals.filter((x): x is number => x != null);
		return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
	}

	function severity(v: number | null): string {
		if (v == null) return '';
		if (v < 3) return 'ok';
		if (v <= 5) return 'warn';
		return 'bad';
	}

	function downloadCsv() {
		const lines = ['tooth,MB,B,DB,ML,L,DL,mean'];
		for (const t of rows) {
			const vals = data[String(t)];
			lines.push(
				`${toothLabel(t, notation)},${vals.map((v) => (v == null ? '' : v.toFixed(1))).join(',')},${
					mean(vals)?.toFixed(1) ?? ''
				}`
			);
		}
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
		a.download = 'perio-chart.csv';
		a.click();
		URL.revokeObjectURL(a.href);
	}
</script>

<div class="backdrop" role="presentation" onclick={onclose}>
	<div
		class="panel perio-dialog"
		role="dialog"
		aria-label="Periodontal chart"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="dialog-title">Periodontal chart — bone loss (mm)</div>
		<div class="dialog-body">
			<p class="muted">
				Record the distance between cemento-enamel junction and bone level in six directions per
				tooth, measured with the distance tool on the cross-section views (chapter 7.1 of the
				manual). Values &lt; 3 mm are shown green, 3–5 mm yellow, &gt; 5 mm red.
			</p>
			<div class="perio-caution">
				⚠ Bone-loss values are calculated planning aids derived from the points you set — they are
				not diagnostic results. Confirm actual probing depths by physical examination.
			</div>
			<table class="perio-table">
				<thead>
					<tr>
						<th>Tooth</th>
						{#each DIRECTIONS as d (d)}<th>{d}</th>{/each}
						<th>Mean</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as t (t)}
						<tr>
							<td><strong>{toothLabel(t, notation)}</strong></td>
							{#each DIRECTIONS as d, i (d)}
								<td>
									<input
										class="perio-val {severity(data[String(t)][i])}"
										type="number"
										step="0.1"
										min="0"
										max="20"
										value={data[String(t)][i]}
										onchange={(e) => {
											const v = e.currentTarget.value;
											data[String(t)][i] = v === '' ? null : Number(v);
										}}
									/>
								</td>
							{/each}
							<td class="perio-mean {severity(mean(data[String(t)]))}">
								{mean(data[String(t)])?.toFixed(1) ?? '—'}
							</td>
							<td>
								<button class="btn ghost" title="Remove tooth" onclick={() => removeTooth(t)}>×</button>
							</td>
						</tr>
					{:else}
						<tr><td colspan="9" class="muted">No teeth charted yet — add one below.</td></tr>
					{/each}
				</tbody>
			</table>
			<div class="perio-add">
				<select bind:value={newTooth}>
					{#each FDI_ALL as t (t)}
						<option value={String(t)}>{toothLabel(t, notation)}</option>
					{/each}
				</select>
				<button class="btn" onclick={addTooth}>Add tooth</button>
			</div>
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={downloadCsv}>Download CSV</button>
			<button class="btn" onclick={onclose}>Cancel</button>
			<button
				class="btn primary"
				onclick={() => {
					onsave(JSON.parse(JSON.stringify(data)));
				}}
			>
				Save chart
			</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 120;
	}
	.perio-dialog {
		width: 620px;
		max-height: 86vh;
		display: flex;
		flex-direction: column;
	}
	.dialog-body {
		overflow-y: auto;
	}
	.perio-caution {
		background: #3a3220;
		border: 1px solid #8a5a1e;
		color: var(--yellow);
		border-radius: 4px;
		padding: 8px 10px;
		font-size: 12px;
	}
	.perio-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.perio-table th,
	.perio-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 3px 4px;
		text-align: center;
	}
	.perio-val {
		width: 52px;
		text-align: center;
		padding: 3px 4px;
	}
	.perio-val.ok {
		border-color: #2a6e3c;
	}
	.perio-val.warn {
		border-color: #8a5a1e;
		color: var(--yellow);
	}
	.perio-val.bad {
		border-color: var(--red);
		color: var(--red);
	}
	.perio-mean.ok {
		color: var(--green);
	}
	.perio-mean.warn {
		color: var(--yellow);
	}
	.perio-mean.bad {
		color: var(--red);
	}
	.perio-add {
		display: flex;
		gap: 8px;
		align-items: center;
	}
</style>
