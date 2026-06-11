<script lang="ts">
	/**
	 * Augmentation wizard (SPEC §5.5). The case page owns the outline drawing
	 * (its existing boundary tool); this dialog reads the current outline set
	 * via getOutlines() and posts it to /api/datasets/[id]/augment.
	 */
	let {
		caseId,
		datasetId,
		getOutlines,
		onclose,
		ondone
	}: {
		caseId: number;
		datasetId: number;
		getOutlines: () => Record<string, { x: number; y: number }[][]>;
		onclose: () => void;
		ondone: (modelId: number) => void;
	} = $props();

	let step = $state(1);
	let density = $state(1);
	let color = $state('#c08a3a');
	let name = $state('Augmentation');
	let outlineCount = $state(0);
	let sliceCount = $state(0);
	let applying = $state(false);
	let errorMsg = $state('');
	let resultMl = $state<number | null>(null);
	let resultModelId = $state<number | null>(null);

	function refreshOutlines(): void {
		let polys = 0;
		const slices = new Set<string>();
		const set = getOutlines() ?? {};
		for (const [k, list] of Object.entries(set)) {
			for (const poly of list ?? []) {
				if (Array.isArray(poly) && poly.length >= 3) {
					polys++;
					slices.add(k);
				}
			}
		}
		outlineCount = polys;
		sliceCount = slices.size;
	}
	refreshOutlines();

	async function apply(): Promise<void> {
		applying = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/datasets/${datasetId}/augment`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					outlines: getOutlines(),
					density,
					color,
					name: name.trim() || 'Augmentation'
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data?.message ?? 'Augmentation failed');
			resultMl = data.ml;
			resultModelId = data.model?.id ?? null;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Augmentation failed';
		} finally {
			applying = false;
		}
	}

	function done(): void {
		if (resultModelId != null) ondone(resultModelId);
		onclose();
	}
</script>

<div
	class="aw-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="aw-dialog panel">
		<div class="dialog-title">
			Add augmentation — case {caseId}
			<span class="aw-step">Step {step} of 2 — {step === 1 ? 'Outlines' : 'Result'}</span>
		</div>

		<div class="aw-body">
			{#if step === 1}
				<p>
					Draw one or more <strong>closed outlines</strong> on the axial slices with the boundary
					tool (left-click adds points, right-click closes the outline). Outline the graft region
					on at least one slice; outline several slices to shape the body — slices in between are
					interpolated automatically.
				</p>
				<p class="aw-note">
					The augmentation is an approximate volume evaluation only, not a final graft shape.
				</p>
				<div class="aw-status" class:bad={outlineCount === 0}>
					{#if outlineCount > 0}
						{outlineCount} closed outline{outlineCount === 1 ? '' : 's'} on {sliceCount} slice{sliceCount ===
						1
							? ''
							: 's'}
					{:else}
						No closed outlines yet — draw at least one to continue.
					{/if}
					<button class="btn" type="button" onclick={refreshOutlines}>Re-check outlines</button>
				</div>
			{:else}
				<div class="aw-field">
					<label for="aw-name">Name</label>
					<input id="aw-name" bind:value={name} placeholder="Augmentation" />
				</div>
				<div class="aw-field">
					<label for="aw-density">
						Filling material — {Math.round(density * 100)}%
					</label>
					<input id="aw-density" type="range" min="0" max="1" step="0.05" bind:value={density} />
				</div>
				<div class="aw-field aw-color">
					<label for="aw-color">Color</label>
					<input id="aw-color" type="color" bind:value={color} />
				</div>
				<div class="aw-summary">
					<span>{name.trim() || 'Augmentation'}</span>
					{#if resultMl != null}
						<span class="aw-ml">Volume: {resultMl.toFixed(2)} ml</span>
					{:else}
						<span class="aw-ml muted">Apply to compute the volume</span>
					{/if}
				</div>
				{#if errorMsg}
					<div class="aw-error">{errorMsg}</div>
				{/if}
			{/if}
		</div>

		<div class="dialog-actions">
			<button class="btn" type="button" onclick={onclose} disabled={applying}>Cancel</button>
			{#if step === 1}
				<button
					class="btn primary"
					type="button"
					disabled={outlineCount === 0}
					onclick={() => (step = 2)}
				>
					Next
				</button>
			{:else}
				<button class="btn" type="button" onclick={() => (step = 1)} disabled={applying}>
					Back
				</button>
				<button class="btn" type="button" onclick={apply} disabled={applying}>
					{applying ? 'Applying…' : 'Apply'}
				</button>
				<button class="btn primary" type="button" onclick={done} disabled={resultModelId == null}>
					Done
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.aw-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.aw-dialog {
		min-width: 440px;
		max-width: 560px;
		max-height: 90vh;
		overflow: auto;
		box-shadow: var(--shadow);
	}
	.aw-step {
		float: right;
		font-size: 11px;
		opacity: 0.75;
		font-weight: normal;
	}
	.aw-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 12px;
	}
	.aw-body p {
		margin: 0;
	}
	.aw-note {
		opacity: 0.75;
		font-style: italic;
	}
	.aw-status {
		display: flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--border-soft, #444);
		border-radius: 4px;
		padding: 8px 10px;
	}
	.aw-status.bad {
		color: #e0a04d;
	}
	.aw-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.aw-color input {
		width: 60px;
		height: 26px;
		padding: 0;
	}
	.aw-summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-top: 1px dashed var(--border-soft, #444);
		padding-top: 8px;
	}
	.aw-ml {
		font-weight: 600;
	}
	.aw-ml.muted {
		font-weight: normal;
		opacity: 0.6;
	}
	.aw-error {
		color: #e06a6a;
	}
</style>
