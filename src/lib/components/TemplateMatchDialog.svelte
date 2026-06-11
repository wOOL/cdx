<script lang="ts">
	interface MarkerDto {
		x: number;
		y: number;
		z: number;
		radiusMM: number;
		voxels: number;
		score: number;
		kind: 'sphere' | 'blob';
	}
	interface PairDto {
		si: number;
		di: number;
		residualMM: number;
	}
	interface MatchPayload {
		markersPatient: MarkerDto[];
		markersTemplate: MarkerDto[];
		pairs: PairDto[];
		rmsMM: number | null;
		confidence: 'good' | 'low' | 'failed';
		reason?: string;
	}

	let {
		caseId,
		datasets,
		onapplied,
		onclose
	}: {
		caseId: number;
		datasets: { id: number; label: string }[];
		onapplied: (modelId: number) => void;
		onclose: () => void;
	} = $props();

	let patientId = $state(datasets[0]?.id ?? 0);
	let templateId = $state(datasets[1]?.id ?? datasets[0]?.id ?? 0);
	let surfaceThreshold = $state(-300);
	let busy = $state(false);
	let result = $state<MatchPayload | null>(null);
	let errorMsg = $state('');

	const sameDataset = $derived(patientId === templateId);
	const unmatchedTemplate = $derived(
		result ? result.markersTemplate.length - result.pairs.length : 0
	);
	const unmatchedPatient = $derived(
		result ? result.markersPatient.length - result.pairs.length : 0
	);

	function residualClass(mm: number): string {
		if (mm < 0.3) return 'res-good';
		if (mm < 0.6) return 'res-warn';
		return 'res-bad';
	}

	async function post(apply: boolean): Promise<Response> {
		return fetch(`/api/cases/${caseId}/template-match`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				patientDatasetId: patientId,
				templateDatasetId: templateId,
				surfaceThreshold,
				...(apply ? { apply: true } : {})
			})
		});
	}

	async function detect() {
		busy = true;
		errorMsg = '';
		result = null;
		try {
			const res = await post(false);
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				errorMsg = body?.message ?? `Detection failed (${res.status})`;
				return;
			}
			result = (await res.json()) as MatchPayload;
		} catch {
			errorMsg = 'Detection request failed';
		} finally {
			busy = false;
		}
	}

	async function accept() {
		if (!result || result.confidence === 'failed') return;
		busy = true;
		errorMsg = '';
		try {
			const res = await post(true);
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				errorMsg = body?.message ?? `Apply failed (${res.status})`;
				return;
			}
			const payload = (await res.json()) as MatchPayload & { model: { id: number } };
			onapplied(payload.model.id);
			onclose();
		} catch {
			errorMsg = 'Apply request failed';
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="tm-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="tm-dialog panel">
		<div class="dialog-title">Dual scan template matching</div>
		<div class="tm-body">
			<div class="tm-grid">
				<label class="tm-field">
					<span>Patient scan (template in mouth)</span>
					<select bind:value={patientId} disabled={busy}>
						{#each datasets as ds (ds.id)}
							<option value={ds.id}>{ds.label}</option>
						{/each}
					</select>
				</label>
				<label class="tm-field">
					<span>Template scan (template alone)</span>
					<select bind:value={templateId} disabled={busy}>
						{#each datasets as ds (ds.id)}
							<option value={ds.id}>{ds.label}</option>
						{/each}
					</select>
				</label>
				<label class="tm-field">
					<span>Template surface threshold (HU)</span>
					<input type="number" step="50" min="-1000" max="3000" bind:value={surfaceThreshold} disabled={busy} />
				</label>
			</div>

			{#if sameDataset}
				<div class="tm-error">Select two different datasets for patient and template scan.</div>
			{/if}
			{#if errorMsg}
				<div class="tm-error">{errorMsg}</div>
			{/if}

			<div>
				<button class="btn primary" onclick={detect} disabled={busy || sameDataset}>
					{busy ? 'Working…' : 'Detect & match'}
				</button>
			</div>

			{#if result}
				<div class="tm-summary">
					<span class="tm-badge badge-{result.confidence}">{result.confidence}</span>
					<span>
						Total RMS:
						{result.rmsMM != null ? `${result.rmsMM.toFixed(3)} mm` : '—'}
					</span>
					<span>
						{result.pairs.length} pair{result.pairs.length === 1 ? '' : 's'}
					</span>
				</div>
				{#if result.reason}
					<div class="tm-reason">{result.reason}</div>
				{/if}
				<div class="tm-counts">
					Markers: template {result.markersTemplate.length} ({unmatchedTemplate} unmatched) ·
					patient {result.markersPatient.length} ({unmatchedPatient} unmatched)
				</div>
				{#if result.pairs.length > 0}
					<table class="tm-table">
						<thead>
							<tr><th>Template marker</th><th>Patient marker</th><th>Residual</th></tr>
						</thead>
						<tbody>
							{#each result.pairs as pair (pair.si + '-' + pair.di)}
								<tr>
									<td>#{pair.si + 1} ({result.markersTemplate[pair.si]?.kind ?? '?'})</td>
									<td>#{pair.di + 1} ({result.markersPatient[pair.di]?.kind ?? '?'})</td>
									<td class={residualClass(pair.residualMM)}>{pair.residualMM.toFixed(3)} mm</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			{/if}

			<div class="tm-note">
				Verify the congruency in all views after applying — automatic matching never replaces the
				visual check. Manual point-pair + ICP remains available at any time.
			</div>
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose} disabled={busy}>Close</button>
			<button
				class="btn primary"
				onclick={accept}
				disabled={busy || !result || result.confidence === 'failed'}
			>
				Accept &amp; create matched template model
			</button>
		</div>
	</div>
</div>

<style>
	.tm-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.tm-dialog {
		min-width: 520px;
		max-width: 640px;
		max-height: 85vh;
		overflow-y: auto;
		box-shadow: var(--shadow);
	}
	.tm-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.tm-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.tm-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}
	.tm-field select,
	.tm-field input {
		padding: 4px 6px;
	}
	.tm-error {
		color: #e07a7a;
		font-size: 12px;
	}
	.tm-summary {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 12px;
	}
	.tm-badge {
		padding: 2px 10px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.badge-good {
		background: rgba(90, 180, 100, 0.25);
		color: #7ed18a;
	}
	.badge-low {
		background: rgba(220, 180, 60, 0.25);
		color: #e3c35c;
	}
	.badge-failed {
		background: rgba(220, 90, 90, 0.25);
		color: #e07a7a;
	}
	.tm-reason {
		font-size: 12px;
		color: #e3c35c;
	}
	.tm-counts {
		font-size: 12px;
		opacity: 0.85;
	}
	.tm-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.tm-table th,
	.tm-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 5px 8px;
		text-align: left;
	}
	.res-good {
		color: #7ed18a;
	}
	.res-warn {
		color: #e3c35c;
	}
	.res-bad {
		color: #e07a7a;
	}
	.tm-note {
		font-size: 12px;
		opacity: 0.8;
		border-left: 3px solid var(--border-soft);
		padding-left: 10px;
	}
</style>
