<script lang="ts">
	/**
	 * AI segmentation review dialog (SPEC §10.6): checkmark list of the
	 * generated objects. Error/empty models (ok:false) are unselectable and
	 * struck through. The case page imports the selected ids and deletes the
	 * unimported model rows.
	 */
	let {
		models,
		onimport,
		onclose
	}: {
		models: { id: number; name: string; ok: boolean }[];
		onimport: (ids: number[]) => void;
		onclose: () => void;
	} = $props();

	// ok models start selected; track deselections so props stay the source of truth
	let excluded = $state<Record<number, boolean>>({});
	const selectedIds = $derived(models.filter((m) => m.ok && !excluded[m.id]).map((m) => m.id));
</script>

<div
	class="ar-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="ar-dialog panel">
		<div class="dialog-title">Review AI segmentation</div>

		<div class="ar-body">
			<p>Select the objects to import into the case.</p>
			<ul class="ar-list">
				{#each models as m (m.id)}
					<li>
						<label class="ar-row" class:disabled={!m.ok}>
							<input
								type="checkbox"
								disabled={!m.ok}
								checked={m.ok && !excluded[m.id]}
								onchange={(e) => (excluded[m.id] = !e.currentTarget.checked)}
							/>
							<span class="ar-name" class:struck={!m.ok}>{m.name}</span>
							{#if !m.ok}
								<span class="ar-warn" title="No surface was generated for this object">
									⚠ empty / error
								</span>
							{/if}
						</label>
					</li>
				{/each}
			</ul>
		</div>

		<div class="dialog-actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button
				class="btn primary"
				type="button"
				disabled={selectedIds.length === 0}
				onclick={() => onimport(selectedIds)}
			>
				Import selected ({selectedIds.length})
			</button>
		</div>
	</div>
</div>

<style>
	.ar-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.ar-dialog {
		min-width: 380px;
		max-width: 520px;
		max-height: 80vh;
		overflow: auto;
		box-shadow: var(--shadow);
	}
	.ar-body {
		padding: 14px 16px;
		font-size: 12px;
	}
	.ar-body p {
		margin: 0 0 10px;
	}
	.ar-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ar-row {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}
	.ar-row.disabled {
		cursor: not-allowed;
		opacity: 0.7;
	}
	.ar-name.struck {
		text-decoration: line-through;
		opacity: 0.6;
	}
	.ar-warn {
		color: #e0a04d;
		font-size: 11px;
	}
</style>
