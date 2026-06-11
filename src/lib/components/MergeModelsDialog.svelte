<script lang="ts">
	/**
	 * "Create merged AI model" (desktop AI assistant): pick several models —
	 * typically AI teeth and a jaw — and merge them into one exportable mesh.
	 * Quick-picks select tooth models by FDI arch from their names.
	 */
	let {
		caseId,
		models,
		onclose,
		ondone
	}: {
		caseId: number;
		models: { id: number; name: string; kind: string }[];
		onclose: () => void;
		ondone: (modelId: number) => void;
	} = $props();

	let picked = $state<Set<number>>(new Set());
	let name = $state('Merged AI model');
	let busy = $state(false);
	let err = $state('');

	function fdiOf(m: { name: string }): number | null {
		const match = /tooth[_ ]?(\d{2})/i.exec(m.name);
		if (!match) return null;
		const n = Number(match[1]);
		return n >= 11 && n <= 48 ? n : null;
	}

	function toggle(id: number) {
		const next = new Set(picked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		picked = next;
	}

	function pickArch(upper: boolean) {
		const next = new Set(picked);
		for (const m of models) {
			const fdi = fdiOf(m);
			if (fdi != null && (fdi < 30 === upper)) next.add(m.id);
		}
		picked = next;
	}

	async function merge() {
		err = '';
		busy = true;
		try {
			const res = await fetch(`/api/cases/${caseId}/merge-models`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ modelIds: [...picked], name })
			});
			if (!res.ok) {
				err = (await res.text()).slice(0, 200);
				return;
			}
			const { model } = await res.json();
			ondone(model.id);
		} finally {
			busy = false;
		}
	}
</script>

<div class="modal-backdrop" role="presentation" onclick={onclose}>
	<div class="modal-card" role="dialog" aria-label="Merge models" onclick={(e) => e.stopPropagation()}>
		<div class="dialog-title">Create merged model</div>
		<div class="dialog-hint">
			Pick the models to combine into one mesh (e.g. AI teeth + jaw) — the merged copy is a
			normal model you can export or edit.
		</div>
		<div class="mm-quick">
			<button class="btn" onclick={() => pickArch(true)}>+ Upper teeth</button>
			<button class="btn" onclick={() => pickArch(false)}>+ Lower teeth</button>
			<button class="btn" onclick={() => (picked = new Set(models.map((m) => m.id)))}>All</button>
			<button class="btn" onclick={() => (picked = new Set())}>None</button>
		</div>
		<div class="mm-list">
			{#each models as m (m.id)}
				<label class="checkbox-row">
					<input type="checkbox" checked={picked.has(m.id)} onchange={() => toggle(m.id)} />
					{m.name} <span class="mm-kind">{m.kind}</span>
				</label>
			{/each}
		</div>
		<label class="mp-row">
			<span>Name</span>
			<input type="text" bind:value={name} />
		</label>
		{#if err}<div class="warn-text">{err}</div>{/if}
		<div class="dialog-actions">
			<button class="btn" onclick={onclose}>Cancel</button>
			<button class="btn primary" disabled={picked.size < 2 || busy} onclick={merge}>
				{busy ? 'Merging…' : `Merge ${picked.size} models`}
			</button>
		</div>
	</div>
</div>

<style>
	.mm-quick {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.mm-list {
		max-height: 280px;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mm-kind {
		opacity: 0.55;
		font-size: 11px;
	}
	.warn-text {
		color: #d05050;
		font-size: 12px;
	}
</style>
