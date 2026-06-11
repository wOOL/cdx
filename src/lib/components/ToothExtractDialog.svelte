<script lang="ts">
	/**
	 * AI tooth extraction dialog (the AI assistant tutorial video: scan →
	 * "Tooth extraction"): pick one of the AI-segmented teeth, choose how the
	 * extraction site should look, optionally keep the extracted tooth as its
	 * own planning model, then POST /api/models/[scan]/extract-tooth. The
	 * source scan and tooth stay untouched — the result is a new model
	 * "<scan name> (tooth extraction)" under the model scans.
	 */

	interface ExtractResult {
		model: { id: number; name: string };
		toothModel?: { id: number; name: string };
		removedTriangles: number;
		addedTriangles: number;
		holesFilled: number;
	}

	let {
		caseId,
		scanModelId,
		teeth,
		onclose,
		ondone
	}: {
		caseId: number;
		scanModelId: number;
		/** AI tooth models of the case (id = model id, fdi = tooth number) */
		teeth: { id: number; fdi: number; label: string }[];
		onclose: () => void;
		ondone: (result: ExtractResult) => void;
	} = $props();

	type Mode = 'cut' | 'cut-close' | 'alveolus';
	const MODES: { value: Mode; label: string; hint: string }[] = [
		{
			value: 'cut',
			label: 'Cut out tooth',
			hint: 'Remove the tooth from the scan and leave the opening as it is.'
		},
		{
			value: 'cut-close',
			label: 'Cut out tooth and close the hole',
			hint: 'Remove the tooth and close the cut opening (healed-site look).'
		},
		{
			value: 'alveolus',
			label: 'Cut out tooth and keep the alveolus',
			hint: 'Remove the tooth but keep the socket walls (extraction socket).'
		}
	];

	let toothId = $state(teeth[0]?.id ?? 0);
	let mode = $state<Mode>('cut');
	let addTooth = $state(false);
	let busy = $state(false);
	let errorMsg = $state('');

	const selectedFdi = $derived(teeth.find((t) => t.id === toothId)?.fdi);

	async function doExtract(): Promise<void> {
		void caseId; // contract parity with the sibling dialogs; the endpoint is model-scoped
		if (busy || !toothId) return;
		busy = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/models/${scanModelId}/extract-tooth`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ toothModelId: toothId, mode, addTooth })
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				errorMsg = (b as { message?: string } | null)?.message ?? `Extraction failed (${res.status})`;
				return;
			}
			ondone(b as ExtractResult);
			onclose();
		} catch {
			errorMsg = 'Extraction request failed';
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="te-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && !busy && onclose()}
>
	<div class="te-dialog panel">
		<div class="dialog-title">Tooth extraction</div>
		<div class="te-body">
			<label class="te-label" for="te-tooth">Tooth to extract</label>
			<select id="te-tooth" bind:value={toothId} disabled={busy || teeth.length === 0}>
				{#each teeth as t (t.id)}
					<option value={t.id}>{t.label}</option>
				{/each}
			</select>
			{#if teeth.length === 0}
				<div class="te-hint">
					No AI-segmented tooth models in this case — run the AI assistant first.
				</div>
			{/if}

			<span class="te-label">Extraction site</span>
			<div class="te-modes" role="radiogroup" aria-label="Extraction site">
				{#each MODES as m (m.value)}
					<label class="te-mode" class:sel={mode === m.value}>
						<input type="radio" name="te-mode" value={m.value} bind:group={mode} disabled={busy} />
						<span class="te-mode-text">
							<span class="te-mode-label">{m.label}</span>
							<span class="te-mode-hint">{m.hint}</span>
						</span>
					</label>
				{/each}
			</div>

			<label class="te-add">
				<input type="checkbox" bind:checked={addTooth} disabled={busy} />
				Add extracted tooth to planning
				{#if selectedFdi != null}
					<span class="te-hint">— creates a separate model “Extracted tooth {selectedFdi}”</span>
				{/if}
			</label>

			<div class="te-hint">
				The scan is not modified — the result is added as a new model scan
				“&lt;scan name&gt; (tooth extraction)”.
			</div>

			{#if errorMsg}
				<div class="te-error">{errorMsg}</div>
			{/if}
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
			<button class="btn primary" onclick={doExtract} disabled={busy || teeth.length === 0}>
				{busy ? 'Extracting…' : 'Extract'}
			</button>
		</div>
	</div>
</div>

<style>
	.te-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.te-dialog {
		min-width: 440px;
		max-width: 540px;
		box-shadow: var(--shadow);
	}
	.te-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	.te-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		margin-top: 4px;
	}
	.te-body select {
		background: var(--bg-1);
		color: var(--text);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
	}
	.te-modes {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.te-mode {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 7px 10px;
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		background: var(--bg-1);
		cursor: pointer;
	}
	.te-mode.sel {
		border-color: var(--accent);
		background: var(--bg-3);
	}
	.te-mode input {
		margin-top: 2px;
	}
	.te-mode-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.te-mode-label {
		font-weight: 600;
	}
	.te-mode-hint,
	.te-hint {
		color: var(--text-dim);
		font-size: 11px;
	}
	.te-add {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		margin-top: 2px;
	}
	.te-error {
		color: #e06a6a;
	}
</style>
