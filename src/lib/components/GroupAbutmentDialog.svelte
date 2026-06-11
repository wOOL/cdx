<script lang="ts">
	import { norm } from '$lib/geometry';
	import { chooseAngulation, computeAbutmentAlignment, residualDeviation } from '$lib/abutmentMath';

	interface ImplantRow {
		id: number;
		label: string;
		ax: number;
		ay: number;
		az: number;
		abutment?: { preset: string; angle: number; rotation: number } | null;
	}
	interface PresetRow {
		name: string;
		angles: number[];
	}

	let {
		implants,
		presets,
		onassign,
		onclose
	}: {
		implants: ImplantRow[];
		presets: PresetRow[];
		onassign: (
			rows: { id: number; abutment: { preset: string; angle: number; rotation: number } }[]
		) => Promise<void>;
		onclose: () => void;
	} = $props();

	let selected = $state<Set<number>>(new Set(implants.map((i) => i.id)));
	let targetMode = $state<'mean' | 'vertical'>('mean');
	let presetName = $state(presets[0]?.name ?? '');
	let busy = $state(false);
	let errorMsg = $state('');

	const preset = $derived(presets.find((p) => p.name === presetName) ?? presets[0]);
	const maxAngle = $derived(preset ? Math.max(...preset.angles) : 0);

	const target = $derived.by(() => {
		if (targetMode === 'vertical') return { x: 0, y: 0, z: -1 };
		const sel = implants.filter((i) => selected.has(i.id));
		if (!sel.length) return { x: 0, y: 0, z: -1 };
		return norm(
			sel.reduce((a, i) => ({ x: a.x + i.ax, y: a.y + i.ay, z: a.z + i.az }), { x: 0, y: 0, z: 0 })
		);
	});

	interface RowResult {
		implant: ImplantRow;
		tiltDeg: number;
		azimuthDeg: number;
		angle: number | null;
		residual: number;
	}
	const rows = $derived.by<RowResult[]>(() =>
		implants.map((im) => {
			const { tiltDeg, azimuthDeg } = computeAbutmentAlignment(
				{ x: im.ax, y: im.ay, z: im.az },
				target
			);
			const angle = preset ? chooseAngulation(tiltDeg, preset.angles) : null;
			return { implant: im, tiltDeg, azimuthDeg, angle, residual: residualDeviation(tiltDeg, angle) };
		})
	);

	const assignable = $derived(rows.filter((r) => selected.has(r.implant.id) && r.angle != null));
	const overLimit = $derived(rows.filter((r) => selected.has(r.implant.id) && r.angle == null));

	function toggle(id: number, on: boolean) {
		const next = new Set(selected);
		if (on) next.add(id);
		else next.delete(id);
		selected = next;
	}

	async function assign() {
		if (!preset || !assignable.length || busy) return;
		busy = true;
		errorMsg = '';
		try {
			await onassign(
				assignable.map((r) => ({
					id: r.implant.id,
					abutment: { preset: preset.name, angle: r.angle as number, rotation: r.azimuthDeg }
				}))
			);
			onclose();
		} catch {
			errorMsg = 'Assignment failed — please try again.';
		}
		busy = false;
	}
</script>

<div class="ga-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="ga-dialog panel">
		<div class="dialog-title">Group abutment assignment</div>
		<div class="ga-body">
			<p class="ga-hint">
				All-on-4/6: select the implants of the restoration, choose a common prosthetic direction,
				and the smallest angulated abutment that parallelizes each implant axis is picked
				automatically. The rotation tips each abutment toward the common direction.
			</p>
			<div class="ga-controls">
				<label class="ga-radio">
					<input type="radio" name="ga-target" value="mean" bind:group={targetMode} />
					Mean direction of the selected implants
				</label>
				<label class="ga-radio">
					<input type="radio" name="ga-target" value="vertical" bind:group={targetMode} />
					Vertical (0, 0, −1)
				</label>
				<label class="ga-preset">
					Abutment line
					<select bind:value={presetName}>
						{#each presets as p (p.name)}
							<option value={p.name}>{p.name} ({p.angles.map((a) => `${a}°`).join(' / ')})</option>
						{/each}
					</select>
				</label>
			</div>
			<table class="ga-table">
				<thead>
					<tr>
						<th></th>
						<th>Implant</th>
						<th>Needed angle</th>
						<th>Chosen abutment</th>
						<th>Residual deviation</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.implant.id)}
						<tr class:ga-warn={r.angle == null && selected.has(r.implant.id)}>
							<td>
								<input
									type="checkbox"
									checked={selected.has(r.implant.id)}
									onchange={(e) => toggle(r.implant.id, e.currentTarget.checked)}
								/>
							</td>
							<td>{r.implant.label}</td>
							<td>{r.tiltDeg.toFixed(1)}°</td>
							<td>
								{#if r.angle != null}
									{preset?.name} — {r.angle === 0 ? 'straight 0°' : `angled ${r.angle}°`}
								{:else}
									exceeds max {maxAngle}°
								{/if}
							</td>
							<td>{r.residual.toFixed(1)}°</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if overLimit.length}
				<p class="ga-err">
					{overLimit.length} implant{overLimit.length > 1 ? 's' : ''} need{overLimit.length > 1
						? ''
						: 's'} more angulation than this line offers (max {maxAngle}°) — re-angle the implant
					or pick another line. These rows will be skipped.
				</p>
			{/if}
			{#if errorMsg}<p class="ga-err">{errorMsg}</p>{/if}
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose}>Cancel</button>
			<button class="btn primary" disabled={busy || !assignable.length} onclick={assign}>
				Assign {assignable.length} abutment{assignable.length === 1 ? '' : 's'}
			</button>
		</div>
	</div>
</div>

<style>
	.ga-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.ga-dialog {
		min-width: 620px;
		max-width: 760px;
		box-shadow: var(--shadow);
	}
	.ga-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ga-hint {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim, #9aa4b0);
	}
	.ga-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
	}
	.ga-radio,
	.ga-preset {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}
	.ga-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.ga-table th,
	.ga-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 5px 8px;
		text-align: left;
	}
	.ga-warn td {
		color: #e06c6c;
	}
	.ga-err {
		margin: 0;
		font-size: 12px;
		color: #e06c6c;
	}
</style>
