<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	type ContactRow = (typeof data.contacts)[number];

	const groups = $derived([
		{ title: 'Clinicians', items: data.contacts.filter((c) => c.kind === 'clinician') },
		{ title: 'Labs', items: data.contacts.filter((c) => c.kind === 'lab') }
	]);

	let busy = $state(false);
	let addName = $state('');
	let addEmail = $state('');
	let addKind = $state('clinician');
	let pairCode = $state('');
	let pairName = $state('');

	async function api(path: string, init: RequestInit): Promise<boolean> {
		busy = true;
		try {
			const res = await fetch(path, init);
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				alert(body?.message ?? 'Request failed');
				return false;
			}
			await invalidateAll();
			return true;
		} finally {
			busy = false;
		}
	}

	async function addContact() {
		if (!addName.trim()) {
			alert('Contact name is required');
			return;
		}
		const ok = await api('/api/contacts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: addName.trim(), email: addEmail.trim(), kind: addKind })
		});
		if (ok) {
			addName = '';
			addEmail = '';
		}
	}

	async function pair() {
		if (!/^\d{7}$/.test(pairCode.trim())) {
			alert('Pairing code must be 7 digits');
			return;
		}
		const ok = await api('/api/contacts/pair', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ code: pairCode.trim(), name: pairName.trim() })
		});
		if (ok) {
			pairCode = '';
			pairName = '';
		}
	}

	function removeContact(c: ContactRow) {
		if (
			!confirm(
				`Delete contact "${c.name}"?\n\nTransfers exchanged with this contact stay in the inbox but will no longer show their name (history is hidden).`
			)
		)
			return;
		api(`/api/contacts/${c.id}`, { method: 'DELETE' });
	}
</script>

<svelte:head>
	<title>Contacts — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Contacts</div>
	<div class="spacer"></div>
	<a class="btn ghost" href="/inbox"><Icon name="import" size={15} /> Inbox</a>
</header>

<div class="contacts-wrap">
	<div class="panel">
		<div class="panel-header">My practice</div>
		<div class="body code-body">
			<div>
				<div class="muted small">Share this pairing code with partners so they can add your practice:</div>
				<div class="practice-code">{data.practiceCode}</div>
			</div>
		</div>
	</div>

	<div class="panel">
		<div class="panel-header">Add contact</div>
		<div class="body">
			<div class="field-row">
				<div>
					<label for="ct-name">Name</label>
					<input id="ct-name" bind:value={addName} style="width:100%" placeholder="Dr. Jane Doe / Apex Dental Lab" />
				</div>
				<div>
					<label for="ct-email">Email</label>
					<input id="ct-email" type="email" bind:value={addEmail} style="width:100%" />
				</div>
				<div>
					<label for="ct-kind">Kind</label>
					<select id="ct-kind" bind:value={addKind} style="width:100%">
						<option value="clinician">Clinician</option>
						<option value="lab">Lab</option>
					</select>
				</div>
			</div>
			<div class="actions">
				<button class="btn primary" onclick={addContact} disabled={busy}><Icon name="plus" size={14} /> Add contact</button>
			</div>
		</div>
	</div>

	<div class="panel">
		<div class="panel-header">Pair by code</div>
		<div class="body">
			<p class="muted">Enter the 7-digit pairing code of a partner practice to connect with it.</p>
			<div class="field-row">
				<div>
					<label for="pr-code">Pairing code</label>
					<input id="pr-code" bind:value={pairCode} maxlength="7" inputmode="numeric" pattern="[0-9]*" style="width:100%" placeholder="1234567" />
				</div>
				<div>
					<label for="pr-name">Name (optional)</label>
					<input id="pr-name" bind:value={pairName} style="width:100%" />
				</div>
			</div>
			<div class="actions">
				<button class="btn primary" onclick={pair} disabled={busy}>Pair</button>
			</div>
		</div>
	</div>

	{#each groups as group (group.title)}
		<div class="panel">
			<div class="panel-header">{group.title} ({group.items.length})</div>
			{#if group.items.length}
				<table class="contact-table">
					<thead>
						<tr><th>Name</th><th>Email</th><th>Code</th><th>Added</th><th></th></tr>
					</thead>
					<tbody>
						{#each group.items as c (c.id)}
							<tr>
								<td>{c.name}</td>
								<td>{c.email || '—'}</td>
								<td class="mono">{c.code}</td>
								<td class="muted">{c.created_at.slice(0, 10)}</td>
								<td class="row-actions">
									<button class="btn ghost" onclick={() => removeContact(c)} disabled={busy} title="Delete contact"><Icon name="trash" size={13} /></button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="muted empty">No {group.title.toLowerCase()} yet.</p>
			{/if}
		</div>
	{/each}
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
	.spacer {
		flex: 1;
	}
	.contacts-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 720px;
		margin: 0 auto;
		width: 100%;
	}
	.body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.code-body {
		align-items: flex-start;
	}
	.practice-code {
		font-family: var(--mono);
		font-size: 28px;
		letter-spacing: 6px;
		color: var(--accent-bright);
		background: var(--bg-0);
		border: 1px dashed var(--accent-dim);
		border-radius: var(--radius);
		padding: 8px 16px;
		margin-top: 8px;
		display: inline-block;
	}
	.small {
		font-size: 12px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
	.contact-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.contact-table th,
	.contact-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 6px 12px;
		text-align: left;
	}
	.contact-table th {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--text-dim);
	}
	.mono {
		font-family: var(--mono);
	}
	.row-actions {
		text-align: right;
	}
	.empty {
		padding: 16px;
	}
</style>
