<script lang="ts">
	/**
	 * Virtual Planning Export wizard (Plan → Virtual Planning Export):
	 * 1. export format (STL) → 2. source model + mode → 3. per-tooth-position
	 * scanbody/level table → 4. 3D preview + single/multi-file export.
	 */
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import VpePreview from './VpePreview.svelte';
	import { abutmentLabel, type StoredAbutment } from '$lib/implantLibrary';
	import {
		implantPlatform,
		scanbodiesForPlatform,
		type ScanbodyEntry,
		type VpePreviewPayload
	} from '$lib/vpeCatalog';

	interface ModelDto {
		id: number;
		name: string;
		kind: string;
	}
	interface ImplantDto {
		id: number;
		tooth: string;
		manufacturer: string;
		line: string;
		article: string;
		diameter: number;
		abutment: StoredAbutment | null;
	}
	interface Row {
		im: ImplantDto;
		options: ScanbodyEntry[];
		state: 'exclude' | 'implant' | 'abutment';
		scanbodyId: string | null;
	}

	let {
		caseId,
		planId = null,
		onclose
	}: {
		caseId: number;
		planId?: number | null;
		onclose: () => void;
	} = $props();

	const STEP_TITLES = [
		'Export format',
		'Source & mode',
		'Tooth positions & scanbodies',
		'Preview & export'
	];

	let step = $state(1);
	let format = $state<'stl' | 'cares'>('stl');
	let mode = $state<'untouched' | 'analogs'>('untouched');
	let sourceId = $state<number | null>(null);
	let models = $state<ModelDto[]>([]);
	let rows = $state<Row[]>([]);
	let pickerFor = $state<number | null>(null);
	let errorMsg = $state('');
	let busy = $state(false);
	let single = $state(true);
	let preview = $state<{ positions: Float32Array; parts: VpePreviewPayload['parts'] } | null>(null);
	let exportedFile = $state('');

	const scanModels = $derived(models.filter((m) => m.kind !== 'segmentation'));
	const segModels = $derived(models.filter((m) => m.kind === 'segmentation'));
	const includedCount = $derived(rows.filter((r) => r.state !== 'exclude').length);

	onMount(async () => {
		try {
			const res = await fetch(`/api/cases/${caseId}/vpe${planId ? `?plan=${planId}` : ''}`);
			if (!res.ok) {
				errorMsg = `Could not load case data (${res.status})`;
				return;
			}
			const data = (await res.json()) as { models: ModelDto[]; implants: ImplantDto[] };
			models = data.models;
			sourceId = data.models[0]?.id ?? null;
			rows = data.implants.map((im): Row => {
				const options = scanbodiesForPlatform(implantPlatform(im));
				return { im, options, state: options.length ? 'implant' : 'exclude', scanbodyId: null };
			});
		} catch {
			errorMsg = 'Could not load case data';
		}
	});

	function payload(forPreview: boolean) {
		const src = models.find((m) => m.id === sourceId);
		return {
			format: 'stl',
			mode,
			source: { kind: src?.kind === 'segmentation' ? 'segmentation' : 'model', id: sourceId },
			items: rows.map((r) => ({
				implantId: r.im.id,
				level: r.state === 'abutment' ? 'abutment' : 'implant',
				scanbodyId: r.scanbodyId,
				include: r.state !== 'exclude'
			})),
			single,
			...(planId ? { planId } : {}),
			...(forPreview ? { preview: true } : {})
		};
	}

	async function post(forPreview: boolean): Promise<Response> {
		return fetch(`/api/cases/${caseId}/vpe`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload(forPreview))
		});
	}

	async function loadPreview() {
		busy = true;
		errorMsg = '';
		preview = null;
		try {
			const res = await post(true);
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				errorMsg = b?.message ?? `Preview failed (${res.status})`;
				return;
			}
			const data = (await res.json()) as VpePreviewPayload;
			preview = { positions: Float32Array.from(data.positions), parts: data.parts };
		} catch {
			errorMsg = 'Preview request failed';
		} finally {
			busy = false;
		}
	}

	async function doExport() {
		busy = true;
		errorMsg = '';
		exportedFile = '';
		try {
			const res = await post(false);
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				errorMsg = b?.message ?? `Export failed (${res.status})`;
				return;
			}
			const blob = await res.blob();
			const dispo = res.headers.get('Content-Disposition') ?? '';
			const name = /filename="([^"]+)"/.exec(dispo)?.[1] ?? `vpe_${caseId}.${single ? 'stl' : 'zip'}`;
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name;
			a.click();
			URL.revokeObjectURL(a.href);
			exportedFile = name;
		} catch {
			errorMsg = 'Export request failed';
		} finally {
			busy = false;
		}
	}

	function next() {
		errorMsg = '';
		if (step === 2 && sourceId == null) {
			errorMsg = 'Select a model or segmentation to export';
			return;
		}
		step++;
		if (step === 4) loadPreview();
	}

	function back() {
		errorMsg = '';
		pickerFor = null;
		if (step === 4) preview = null;
		step--;
	}

	function setLevel(r: Row, state: Row['state']) {
		r.state = state;
		if (state === 'exclude') pickerFor = null;
	}

	function rowDescription(r: Row): string {
		const art = r.im.article || `${r.im.manufacturer} ${r.im.line}`.trim();
		if (r.state === 'abutment' && r.im.abutment) {
			return `${art} — abutment ${abutmentLabel(r.im.abutment).toLowerCase()}`;
		}
		return art || '—';
	}

	function scanbodyName(r: Row): string {
		return r.options.find((s) => s.id === r.scanbodyId)?.name ?? '';
	}
</script>

<div
	class="vpe-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="vpe-dialog panel">
		<div class="dialog-title">
			Virtual Planning Export
			<span class="vpe-step">Step {step} of 4 — {STEP_TITLES[step - 1]}</span>
		</div>
		<div class="vpe-sub">Export model scan and implant positions for processing in CAD/CAM systems.</div>

		<div class="vpe-body">
			{#if step === 1}
				<label class="vpe-field">
					<span>Export format</span>
					<select bind:value={format}>
						<option value="stl">STL file</option>
						<option value="cares" disabled>CARES proprietary (not applicable to the web edition)</option>
					</select>
				</label>
				<div class="vpe-hint">
					<strong>Hint</strong><br />
					Export the selected model scans or segmentations as an STL file.
				</div>
			{:else if step === 2}
				<div class="vpe-group-title">Model scans and 3D models</div>
				{#if scanModels.length === 0}
					<div class="faint">No model scans in this case</div>
				{/if}
				{#each scanModels as m (m.id)}
					<label class="vpe-radio">
						<input type="radio" name="vpe-source" value={m.id} bind:group={sourceId} />
						<span>{m.name}</span>
						<span class="faint">{m.kind}</span>
					</label>
				{/each}
				<div class="vpe-group-title">Segmentations</div>
				{#if segModels.length === 0}
					<div class="faint">No segmentation models in this case</div>
				{/if}
				{#each segModels as m (m.id)}
					<label class="vpe-radio">
						<input type="radio" name="vpe-source" value={m.id} bind:group={sourceId} />
						<span>{m.name}</span>
					</label>
				{/each}

				<div class="vpe-group-title">Mode</div>
				<label class="vpe-radio vpe-mode">
					<input type="radio" name="vpe-mode" value="untouched" bind:group={mode} />
					<span>
						<strong>Untouched export</strong><br />
						<span class="faint">
							Export the selected model scan or segmentation with no further processing,
							optionally with scanbodies.
						</span>
					</span>
				</label>
				<label class="vpe-radio vpe-mode">
					<input type="radio" name="vpe-mode" value="analogs" bind:group={mode} />
					<span>
						<strong>Insert implant analogs</strong><br />
						<span class="faint">
							Generate a closed model based on the selected model scan or segmentation and
							insert the planned implant positions as analogs.
						</span>
					</span>
				</label>
			{:else if step === 3}
				{#if rows.length === 0}
					<div class="faint">No implants planned — the model will be exported without scanbodies.</div>
				{:else}
					<table class="vpe-table">
						<thead>
							<tr><th>Tooth position</th><th></th><th>Description</th><th>Scanbody</th></tr>
						</thead>
						<tbody>
							{#each rows as r (r.im.id)}
								<tr class:vpe-excluded={r.state === 'exclude'}>
									<td class="vpe-tooth">{r.im.tooth || '—'}</td>
									<td class="vpe-toggles">
										<button
											class="vpe-toggle"
											class:active={r.state === 'exclude'}
											title="Exclude this position from the export"
											onclick={() => setLevel(r, 'exclude')}
										>
											<Icon name="close" size={13} />
										</button>
										<button
											class="vpe-toggle"
											class:active={r.state === 'implant'}
											title="Export on implant level (scanbody on the implant platform)"
											onclick={() => setLevel(r, 'implant')}
										>
											<Icon name="implant" size={13} />
										</button>
										<button
											class="vpe-toggle"
											class:active={r.state === 'abutment'}
											title={r.im.abutment
												? 'Export on abutment level (scanbody on the abutment)'
												: 'No abutment planned for this position'}
											disabled={!r.im.abutment}
											onclick={() => setLevel(r, 'abutment')}
										>
											<!-- abutment glyph: tapered post on a shoulder -->
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
												<path d="M10 3h4l2 8H8l2-8ZM7 11h10v4H7z" />
											</svg>
										</button>
									</td>
									<td class="vpe-desc">{rowDescription(r)}</td>
									<td class="vpe-sbcell">
										{#if r.options.length === 0}
											<span class="faint">No scanbodies available</span>
										{:else}
											<button
												class="btn ghost vpe-sbpick"
												disabled={r.state === 'exclude'}
												onclick={() => (pickerFor = pickerFor === r.im.id ? null : r.im.id)}
											>
												{r.scanbodyId ? scanbodyName(r) : 'Add scanbody'}
											</button>
											{#if pickerFor === r.im.id}
												<div class="vpe-picker panel">
													{#each r.options as sb (sb.id)}
														<button
															class="vpe-pick"
															class:active={r.scanbodyId === sb.id}
															onclick={() => {
																r.scanbodyId = sb.id;
																pickerFor = null;
															}}
														>
															{sb.name}
															<span class="faint">Ø{sb.bodyDiameter.toFixed(1)} × {(sb.collarHeight + sb.bodyHeight).toFixed(1)} mm</span>
														</button>
													{/each}
													<button
														class="vpe-pick faint"
														onclick={() => {
															r.scanbodyId = null;
															pickerFor = null;
														}}>No scanbody</button
													>
												</div>
											{/if}
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<div class="faint">
						{includedCount} of {rows.length} positions included —
						{mode === 'analogs' ? 'analogs are inserted at every included implant' : 'scanbodies are optional'}.
					</div>
				{/if}
			{:else}
				<div class="vpe-preview-grid">
					<div class="vpe-preview-canvas">
						{#if busy && !preview}
							<div class="vpe-loading faint">Computing preview…</div>
						{:else if preview}
							<VpePreview positions={preview.positions} parts={preview.parts} />
						{/if}
					</div>
					<div class="vpe-export-opts">
						<div class="vpe-group-title">Export granularity</div>
						<label class="vpe-radio">
							<input type="radio" name="vpe-single" value={false} bind:group={single} />
							<span>Multi-file <span class="faint">(zip, one STL per part)</span></span>
						</label>
						<label class="vpe-radio">
							<input type="radio" name="vpe-single" value={true} bind:group={single} />
							<span>Single file <span class="faint">(one combined STL)</span></span>
						</label>
						{#if preview}
							<div class="vpe-parts faint">
								{preview.parts.length} part{preview.parts.length === 1 ? '' : 's'}:
								{preview.parts.map((p) => p.name).join(', ')}
							</div>
						{/if}
						{#if exportedFile}
							<div class="vpe-done">Exported {exportedFile}</div>
						{/if}
					</div>
				</div>
			{/if}

			{#if errorMsg}
				<div class="vpe-error">{errorMsg}</div>
			{/if}
		</div>

		<div class="dialog-actions">
			<button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
			{#if step > 1}
				<button class="btn" onclick={back} disabled={busy}>Previous</button>
			{/if}
			{#if step < 4}
				<button class="btn primary" onclick={next}>Next</button>
			{:else}
				<button class="btn primary" onclick={doExport} disabled={busy || !preview}>
					{busy ? 'Working…' : 'Export'}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.vpe-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.vpe-dialog {
		min-width: 620px;
		max-width: 820px;
		max-height: 90vh;
		overflow: auto;
		box-shadow: var(--shadow);
	}
	.vpe-step {
		float: right;
		font-size: 11px;
		opacity: 0.75;
		font-weight: normal;
	}
	.vpe-sub {
		padding: 0 16px;
		font-size: 11px;
		opacity: 0.7;
	}
	.vpe-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 12px;
		min-height: 220px;
	}
	.vpe-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 360px;
	}
	.vpe-hint {
		border-left: 3px solid var(--border-soft, #444);
		padding: 6px 10px;
		opacity: 0.85;
	}
	.vpe-group-title {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.7;
		border-bottom: 1px solid var(--border-soft, #333);
		padding-bottom: 3px;
		margin-top: 4px;
	}
	.vpe-radio {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 3px 2px;
		cursor: pointer;
	}
	.vpe-mode {
		align-items: flex-start;
	}
	.vpe-table {
		width: 100%;
		border-collapse: collapse;
	}
	.vpe-table th,
	.vpe-table td {
		border-bottom: 1px solid var(--border-soft, #333);
		padding: 5px 8px;
		text-align: left;
		vertical-align: middle;
	}
	.vpe-table th {
		font-size: 11px;
		opacity: 0.7;
	}
	.vpe-tooth {
		font-weight: 600;
		width: 60px;
	}
	.vpe-excluded .vpe-desc,
	.vpe-excluded .vpe-tooth,
	.vpe-excluded .vpe-sbcell {
		opacity: 0.45;
	}
	.vpe-toggles {
		white-space: nowrap;
		width: 90px;
	}
	.vpe-toggle {
		background: none;
		border: 1px solid var(--border-soft, #444);
		border-radius: 3px;
		color: inherit;
		padding: 2px 4px;
		margin-right: 2px;
		cursor: pointer;
		opacity: 0.6;
	}
	.vpe-toggle.active {
		opacity: 1;
		border-color: #4da3ff;
		color: #4da3ff;
	}
	.vpe-toggle:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.vpe-sbcell {
		position: relative;
		min-width: 200px;
	}
	.vpe-sbpick {
		font-size: 12px;
	}
	.vpe-picker {
		position: absolute;
		left: 0;
		top: 100%;
		z-index: 10;
		min-width: 300px;
		box-shadow: var(--shadow);
		display: flex;
		flex-direction: column;
	}
	.vpe-pick {
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		padding: 6px 10px;
		cursor: pointer;
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
	}
	.vpe-pick:hover,
	.vpe-pick.active {
		background: rgba(77, 163, 255, 0.15);
	}
	.vpe-preview-grid {
		display: grid;
		grid-template-columns: 1fr 240px;
		gap: 12px;
		align-items: stretch;
	}
	.vpe-preview-canvas {
		height: 360px;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid var(--border-soft, #333);
		border-radius: 4px;
		display: grid;
	}
	.vpe-loading {
		place-self: center;
	}
	.vpe-export-opts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.vpe-parts {
		font-size: 11px;
		word-break: break-word;
	}
	.vpe-done {
		color: #7ed18a;
		font-size: 12px;
	}
	.vpe-error {
		color: #e07a7a;
		font-size: 12px;
	}
</style>
