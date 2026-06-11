<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Prosthetic design import wizard (SPEC §2.4): upload an order package
	 * (zip with scan.stl / restoration.stl / proposals.json), preview the
	 * manifest, then import. "From device or service" is the order-inbox
	 * integration stub — the select stays disabled while the GET endpoint
	 * reports no sources.
	 */

	interface ProposalRow {
		tooth: string;
		manufacturer: string;
		line: string;
		diameter: number;
		length: number;
		known: boolean;
	}
	interface Manifest {
		scan: { present: boolean; triangles: number };
		restoration: { present: boolean; triangles: number };
		proposals: ProposalRow[];
	}

	let {
		caseId,
		onclose,
		ondone
	}: { caseId: number; onclose: () => void; ondone: () => void } = $props();

	let sources = $state.raw<{ id: string; label: string }[]>([]);
	let file = $state.raw<File | null>(null);
	let manifest = $state.raw<Manifest | null>(null);
	let acceptProposals = $state(true);
	let busy = $state(false);
	let errorMsg = $state('');

	onMount(async () => {
		try {
			const r = await fetch(`/api/cases/${caseId}/import-package`);
			if (r.ok) sources = ((await r.json()).sources ?? []) as { id: string; label: string }[];
		} catch {
			// source list is an optional stub — the upload path still works
		}
	});

	async function readError(res: Response, fallback: string): Promise<string> {
		try {
			return ((await res.json()) as { message?: string }).message ?? fallback;
		} catch {
			return fallback;
		}
	}

	async function send(preview: boolean): Promise<Response | null> {
		if (!file) return null;
		const form = new FormData();
		form.append('file', file);
		if (preview) form.append('preview', 'true');
		else if (acceptProposals) form.append('acceptProposals', 'true');
		return fetch(`/api/cases/${caseId}/import-package`, { method: 'POST', body: form });
	}

	async function pickFile(e: Event): Promise<void> {
		const input = e.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
		manifest = null;
		errorMsg = '';
		if (!file) return;
		busy = true;
		try {
			const res = await send(true);
			if (!res) return;
			if (!res.ok) throw new Error(await readError(res, `Preview failed (${res.status})`));
			manifest = ((await res.json()) as { manifest: Manifest }).manifest;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Preview failed';
			file = null;
			input.value = '';
		} finally {
			busy = false;
		}
	}

	async function doImport(): Promise<void> {
		if (!manifest || busy) return;
		busy = true;
		errorMsg = '';
		try {
			const res = await send(false);
			if (!res) return;
			if (!res.ok) throw new Error(await readError(res, `Import failed (${res.status})`));
			ondone();
			onclose();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Import failed';
		} finally {
			busy = false;
		}
	}

	let proposalCount = $derived(manifest?.proposals.length ?? 0);
	let unknownCount = $derived(manifest?.proposals.filter((p) => !p.known).length ?? 0);
</script>

<div
	class="pi-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && !busy && onclose()}
>
	<div class="pi-dialog panel">
		<div class="dialog-title">Import prosthetic design</div>
		<div class="pi-body">
			<label class="pi-label" for="pi-source">From device or service…</label>
			<!-- order-inbox integration stub: enabled once GET /import-package lists sources -->
			<select id="pi-source" disabled title="No connected devices or services">
				{#if sources.length === 0}
					<option>No devices or services connected</option>
				{:else}
					{#each sources as s (s.id)}
						<option value={s.id}>{s.label}</option>
					{/each}
				{/if}
			</select>

			<label class="pi-label" for="pi-file">Order package (.zip)</label>
			<input id="pi-file" type="file" accept=".zip" disabled={busy} onchange={pickFile} />
			<div class="pi-hint">
				Expected contents: scan.stl, restoration.stl, proposals.json — any subset.
			</div>

			{#if errorMsg}
				<div class="pi-error">{errorMsg}</div>
			{/if}

			{#if manifest}
				<ul class="pi-manifest">
					<li class:pi-missing={!manifest.scan.present}>
						<span class="pi-mark">{manifest.scan.present ? '✓' : '—'}</span>
						Model scan
						{#if manifest.scan.present}({manifest.scan.triangles} triangles){:else}not in
							package{/if}
					</li>
					<li class:pi-missing={!manifest.restoration.present}>
						<span class="pi-mark">{manifest.restoration.present ? '✓' : '—'}</span>
						Restoration (wax-up)
						{#if manifest.restoration.present}({manifest.restoration.triangles} triangles){:else}not
							in package{/if}
					</li>
					{#each manifest.proposals as p, i (i)}
						<li class:pi-warn={!p.known}>
							<span class="pi-mark">{p.known ? '✓' : '⚠'}</span>
							Implant proposal — tooth {p.tooth || '?'}: {p.manufacturer}
							{p.line} ⌀{p.diameter.toFixed(1)} × {p.length.toFixed(1)} mm
							{#if !p.known}<span class="pi-warn-note">not in implant library</span>{/if}
						</li>
					{/each}
					{#if proposalCount === 0}
						<li class="pi-missing"><span class="pi-mark">—</span> No implant proposals</li>
					{/if}
				</ul>
				{#if proposalCount > 0}
					<label class="pi-accept">
						<input type="checkbox" bind:checked={acceptProposals} />
						Add {proposalCount} implant proposal{proposalCount === 1 ? '' : 's'} to the master plan
						{#if unknownCount > 0}({unknownCount} unknown article{unknownCount === 1 ? '' : 's'}){/if}
					</label>
				{/if}
			{/if}
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
			<button class="btn primary" onclick={doImport} disabled={!manifest || busy}>
				{busy ? 'Working…' : 'Import'}
			</button>
		</div>
	</div>
</div>

<style>
	.pi-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.pi-dialog {
		min-width: 460px;
		max-width: 560px;
		box-shadow: var(--shadow);
	}
	.pi-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	.pi-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		margin-top: 4px;
	}
	.pi-body select,
	.pi-body input[type='file'] {
		background: var(--bg-1);
		color: var(--text);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 12px;
	}
	.pi-body select:disabled {
		opacity: 0.55;
	}
	.pi-hint {
		color: var(--text-dim);
		font-size: 11px;
	}
	.pi-error {
		color: #e06a6a;
	}
	.pi-manifest {
		list-style: none;
		margin: 4px 0 0;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 5px;
		background: var(--bg-1);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
	}
	.pi-mark {
		display: inline-block;
		width: 16px;
		color: var(--accent-bright);
	}
	.pi-missing {
		color: var(--text-dim);
	}
	.pi-missing .pi-mark {
		color: var(--text-dim);
	}
	.pi-warn .pi-mark {
		color: var(--accent-2);
	}
	.pi-warn-note {
		color: var(--accent-2);
		margin-left: 6px;
		font-size: 11px;
	}
	.pi-accept {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
</style>
