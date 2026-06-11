<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	let name = $state('');
	let version = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false);
	let message = $state('');
	let errorMsg = $state('');

	async function upload(e: SubmitEvent) {
		e.preventDefault();
		const file = fileInput?.files?.[0];
		if (!file) {
			errorMsg = 'Choose a catalog JSON file first.';
			return;
		}
		busy = true;
		errorMsg = '';
		message = '';
		const form = new FormData();
		form.set('file', file);
		form.set('name', name);
		form.set('version', version);
		try {
			const r = await fetch('/api/catalogs', { method: 'POST', body: form });
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				errorMsg = body?.message ?? `Upload failed (${r.status})`;
			} else {
				message = `Imported "${body.catalog.name}" v${body.catalog.version} — ${body.catalog.count} lines.`;
				name = '';
				version = '';
				if (fileInput) fileInput.value = '';
				await invalidateAll();
			}
		} catch {
			errorMsg = 'Upload failed — network error.';
		}
		busy = false;
	}

	async function patch(id: number, fields: { active?: boolean; outdated?: boolean }) {
		busy = true;
		errorMsg = '';
		const r = await fetch(`/api/catalogs/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(fields)
		});
		if (!r.ok) errorMsg = `Update failed (${r.status})`;
		await invalidateAll();
		busy = false;
	}

	async function remove(id: number, catName: string) {
		if (!confirm(`Delete catalog "${catName}"? Planned implants are not affected.`)) return;
		busy = true;
		errorMsg = '';
		const r = await fetch(`/api/catalogs/${id}`, { method: 'DELETE' });
		if (!r.ok) errorMsg = `Delete failed (${r.status})`;
		await invalidateAll();
		busy = false;
	}
</script>

<svelte:head>
	<title>Implant catalogs — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Implant catalogs</div>
</header>

<div class="cat-wrap">
	<form class="panel" onsubmit={upload}>
		<div class="panel-header">Import catalog version</div>
		<div class="cat-body">
			<p class="muted">
				Upload a JSON array of implant lines (manufacturer, line, diameters[], lengths[], taper,
				optional kind / region / techInfo / docUrl / article). Active catalogs are merged into the
				implant picker; planned implants are copied into the plan and never change retroactively.
			</p>
			<div class="cat-form-row">
				<div class="cat-field">
					<label for="c-file">Catalog file (.json)</label>
					<input id="c-file" type="file" accept=".json,application/json" bind:this={fileInput} />
				</div>
				<div class="cat-field">
					<label for="c-name">Name</label>
					<input id="c-name" placeholder="e.g. MyDent 2026" bind:value={name} />
				</div>
				<div class="cat-field">
					<label for="c-version">Version</label>
					<input id="c-version" placeholder="1" bind:value={version} />
				</div>
				<button class="btn primary" type="submit" disabled={busy}>
					<Icon name="import" size={14} /> Import
				</button>
			</div>
			{#if message}<p class="cat-ok"><Icon name="check" size={13} /> {message}</p>{/if}
			{#if errorMsg}<p class="cat-err"><Icon name="warning" size={13} /> {errorMsg}</p>{/if}
		</div>
	</form>

	<div class="panel">
		<div class="panel-header">Catalog versions</div>
		<table class="cat-table">
			<thead>
				<tr>
					<th>Name</th><th>Version</th><th>Lines</th><th>Uploaded</th><th>Status</th><th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.catalogs as c (c.id)}
					<tr class:inactive={!c.active}>
						<td>{c.name}</td>
						<td>{c.version}</td>
						<td>{c.count}</td>
						<td>{c.uploaded_at}</td>
						<td>
							{#if c.outdated}<span class="tag tag-old">outdated</span>{/if}
							<span class="tag" class:tag-on={c.active}>{c.active ? 'active' : 'inactive'}</span>
						</td>
						<td class="cat-actions">
							<button class="btn" disabled={busy} onclick={() => patch(c.id, { active: !c.active })}>
								{c.active ? 'Deactivate' : 'Activate'}
							</button>
							<button class="btn" disabled={busy} onclick={() => patch(c.id, { outdated: !c.outdated })}>
								{c.outdated ? 'Clear outdated' : 'Mark outdated'}
							</button>
							<button class="btn danger" disabled={busy} title="Delete catalog" onclick={() => remove(c.id, c.name)}>
								<Icon name="trash" size={14} />
							</button>
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="cat-none">No catalogs uploaded yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.appbar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 16px;
		height: 48px;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.brand {
		font-size: 17px;
		font-weight: 700;
	}
	.brand-x {
		color: var(--accent-bright);
		font-weight: 400;
	}
	.brand-web {
		font-size: 10px;
		color: var(--accent-2);
		vertical-align: super;
		margin-left: 3px;
		font-weight: 600;
		text-transform: uppercase;
	}
	.appbar-sub {
		color: var(--text-dim);
		border-left: 1px solid var(--border);
		padding-left: 14px;
	}
	.cat-wrap {
		max-width: 980px;
		margin: 24px auto;
		padding: 0 16px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.cat-body {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.cat-form-row {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.cat-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.cat-field label {
		font-size: 11px;
	}
	.cat-ok {
		color: #3aa757;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.cat-err {
		color: #d4566a;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.cat-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.cat-table th,
	.cat-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 7px 12px;
		text-align: left;
	}
	.cat-table tr.inactive td {
		opacity: 0.55;
	}
	.cat-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	.tag {
		font-size: 10px;
		padding: 2px 6px;
		border: 1px solid var(--border-soft);
		border-radius: 4px;
	}
	.tag-on {
		color: #3aa757;
		border-color: #3aa757;
	}
	.tag-old {
		color: #d4566a;
		border-color: #d4566a;
	}
	.cat-none {
		text-align: center;
		opacity: 0.6;
		padding: 18px;
	}
</style>
