<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	type TransferRow = (typeof data.transfers)[number];

	const SERVICE_TYPES = [
		'Digital surgical guide',
		'Custom',
		'Bone block design',
		'Radiographic assessment'
	];
	const STATES = ['uploaded', 'downloaded', 'imported', 'finished', 'rejected'];
	const TABS = [
		{ val: 'all', label: 'All' },
		{ val: 'in', label: 'Incoming' },
		{ val: 'out', label: 'Outgoing' }
	] as const;

	// rows that were unread when the page opened stay bold for this visit
	const unreadAtOpen = new Set(
		data.transfers.filter((t) => t.direction === 'in' && t.unread).map((t) => t.id)
	);

	let tab: 'all' | 'in' | 'out' = $state('all');
	let stateFilter = $state('');
	let q = $state('');

	const filtered = $derived(
		data.transfers.filter((t) => {
			if (tab !== 'all' && t.direction !== tab) return false;
			if (stateFilter && t.state !== stateFilter) return false;
			const needle = q.trim().toLowerCase();
			if (needle) {
				const hay = `${t.number} ${t.contact_name} ${t.comment}`.toLowerCase();
				if (!hay.includes(needle)) return false;
			}
			return true;
		})
	);

	// ---- backup nudge (P4) ----
	let nudgeDismissed = $state(true);
	onMount(() => {
		nudgeDismissed = sessionStorage.getItem('cdx-backup-nudge') === '1';
		// opening the inbox marks incoming transfers as read
		if (unreadAtOpen.size) fetch('/api/transfers', { method: 'PATCH' });
	});
	function dismissNudge() {
		sessionStorage.setItem('cdx-backup-nudge', '1');
		nudgeDismissed = true;
	}

	// ---- row actions ----
	let busy = $state(false);

	async function api(path: string, init: RequestInit): Promise<unknown | null> {
		busy = true;
		try {
			const res = await fetch(path, init);
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				alert((body as { message?: string } | null)?.message ?? 'Request failed');
				return null;
			}
			await invalidateAll();
			return body;
		} finally {
			busy = false;
		}
	}

	function patchState(id: number, state: string) {
		return api(`/api/transfers/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ state })
		});
	}

	function removeTransfer(t: TransferRow) {
		if (!confirm(`Delete transfer ${t.number}?`)) return;
		api(`/api/transfers/${t.id}`, { method: 'DELETE' });
	}

	async function tidyUp() {
		if (!confirm('Remove finished and rejected transfers older than 30 days?')) return;
		const body = (await api('/api/transfers', { method: 'DELETE' })) as { removed: number } | null;
		if (body) alert(body.removed ? `${body.removed} transfer(s) removed.` : 'Nothing to tidy up.');
	}

	// ---- import into case ----
	let cases: { id: number; title: string; patient: string }[] = $state([]);
	let casesLoaded = false;
	let importFor: number | null = $state(null);
	let importCaseId = $state('');

	async function openImport(t: TransferRow) {
		if (!casesLoaded) {
			const res = await fetch('/api/cases-list');
			cases = (await res.json()).cases;
			casesLoaded = true;
		}
		importFor = t.id;
		importCaseId = cases.length ? String(cases[0].id) : '';
	}

	async function confirmImport(t: TransferRow) {
		if (!importCaseId) return;
		const body = (await api(`/api/transfers/${t.id}/import-to`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ caseId: Number(importCaseId) })
		})) as { planId: number } | null;
		if (body) importFor = null;
	}

	// ---- service requests ----
	let requestOpen = $state(false);
	let plans: { id: number; name: string; case_title: string }[] = $state([]);
	let plansLoaded = false;
	let reqService = $state(SERVICE_TYPES[0]);
	let reqContactId = $state('');
	let reqPlanId = $state('');
	let reqText = $state('');

	async function openRequest() {
		if (!plansLoaded) {
			const res = await fetch('/api/plans-list');
			plans = (await res.json()).plans;
			plansLoaded = true;
		}
		reqContactId = data.contacts.length ? String(data.contacts[0].id) : '';
		requestOpen = true;
	}

	async function submitRequest() {
		if (!reqContactId) {
			alert('Add a contact first — service requests need a recipient.');
			return;
		}
		// with a plan attached this is a plan send carrying the service; otherwise a plan-less request row
		const path = reqPlanId ? `/api/plans/${reqPlanId}/send` : '/api/transfers';
		const ok = await api(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ contactId: Number(reqContactId), service: reqService, comment: reqText })
		});
		if (ok) {
			requestOpen = false;
			reqText = '';
			reqPlanId = '';
		}
	}

	function fmtAge(s: string): string {
		const d = new Date(s.replace(' ', 'T') + 'Z');
		if (isNaN(d.getTime())) return '—';
		const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
		if (sec < 60) return 'just now';
		if (sec < 3600) return `${Math.floor(sec / 60)} min`;
		if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
		return `${Math.floor(sec / 86400)} d`;
	}
</script>

<svelte:head>
	<title>Inbox — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Collaboration inbox</div>
	<div class="spacer"></div>
	<a class="btn ghost" href="/contacts"><Icon name="patient" size={15} /> Contacts</a>
	<button class="btn" onclick={tidyUp} disabled={busy} title="Remove finished/rejected transfers older than 30 days">Tidy up</button>
	<button class="btn primary" onclick={openRequest} disabled={busy}><Icon name="plus" size={14} /> New service request</button>
</header>

<div class="inbox-wrap">
	{#if data.staleCases > 0 && !nudgeDismissed}
		<div class="nudge">
			<Icon name="warning" size={16} />
			<span>
				{data.staleCases}
				{data.staleCases === 1 ? 'case has' : 'cases have'} not been exported recently — consider a case archive backup.
			</span>
			<button class="btn ghost nudge-close" onclick={dismissNudge} title="Dismiss for this session"><Icon name="close" size={14} /></button>
		</div>
	{/if}

	{#if requestOpen}
		<div class="panel request-panel">
			<div class="panel-header">New service request</div>
			<div class="request-body">
				<div class="field-row">
					<div>
						<label for="rq-service">Service type</label>
						<select id="rq-service" bind:value={reqService} style="width:100%">
							{#each SERVICE_TYPES as s (s)}<option value={s}>{s}</option>{/each}
						</select>
					</div>
					<div>
						<label for="rq-contact">Send to</label>
						<select id="rq-contact" bind:value={reqContactId} style="width:100%">
							{#each data.contacts as c (c.id)}<option value={String(c.id)}>{c.name} ({c.kind})</option>{/each}
						</select>
					</div>
					<div>
						<label for="rq-plan">Attach plan (optional)</label>
						<select id="rq-plan" bind:value={reqPlanId} style="width:100%">
							<option value="">— no plan —</option>
							{#each plans as p (p.id)}<option value={String(p.id)}>{p.case_title} — {p.name}</option>{/each}
						</select>
					</div>
				</div>
				<div>
					<label for="rq-text">Requirements</label>
					<textarea id="rq-text" rows="3" bind:value={reqText} style="width:100%" placeholder="Describe what the provider should deliver…"></textarea>
				</div>
				<p class="muted">This is a non-binding request — the provider will confirm scope, price and delivery separately.</p>
			</div>
			<div class="request-actions">
				<button class="btn" onclick={() => (requestOpen = false)}>Cancel</button>
				<button class="btn primary" onclick={submitRequest} disabled={busy}>Send request</button>
			</div>
		</div>
	{/if}

	<div class="panel">
		<div class="inbox-toolbar">
			<div class="tabs">
				{#each TABS as tdef (tdef.val)}
					<button class="tab" class:active={tab === tdef.val} onclick={() => (tab = tdef.val)}>{tdef.label}</button>
				{/each}
			</div>
			<select bind:value={stateFilter} title="Filter by state">
				<option value="">Any state</option>
				{#each STATES as s (s)}<option value={s}>{s}</option>{/each}
			</select>
			<input type="search" placeholder="Search number, contact, comment…" bind:value={q} style="flex:1; max-width:320px" />
			<span class="muted count">{filtered.length} of {data.transfers.length}</span>
		</div>

		{#if filtered.length}
			<table class="inbox-table">
				<thead>
					<tr>
						<th>Number</th>
						<th></th>
						<th>Contact</th>
						<th>Service</th>
						<th>State</th>
						<th>Comment</th>
						<th>Age</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as t (t.id)}
						<tr class:unread={t.direction === 'in' && (t.unread === 1 || unreadAtOpen.has(t.id))}>
							<td class="mono">{t.number}</td>
							<td class="dir {t.direction}" title={t.direction === 'in' ? 'Incoming' : 'Outgoing'}>
								{t.direction === 'in' ? '↓' : '↑'}
							</td>
							<td>{t.contact_name || '—'}</td>
							<td>{t.service || '—'}</td>
							<td><span class="chip {t.state}">{t.state}</span></td>
							<td class="comment" title={t.comment}>{t.comment || '—'}</td>
							<td class="muted">{fmtAge(t.created_at)}</td>
							<td class="row-actions">
								{#if importFor === t.id}
									<select bind:value={importCaseId}>
										{#each cases as c (c.id)}
											<option value={String(c.id)}>{c.patient} — {c.title}</option>
										{/each}
									</select>
									<button class="btn primary" onclick={() => confirmImport(t)} disabled={busy || !importCaseId}>Import</button>
									<button class="btn" onclick={() => (importFor = null)}>Cancel</button>
								{:else}
									{#if t.state === 'uploaded'}
										<button class="btn" onclick={() => patchState(t.id, 'downloaded')} disabled={busy}>Downloaded</button>
									{/if}
									{#if t.direction === 'in' && t.payload_path && (t.state === 'uploaded' || t.state === 'downloaded')}
										<button class="btn" onclick={() => openImport(t)} disabled={busy}>Import…</button>
									{/if}
									{#if t.state !== 'finished' && t.state !== 'rejected'}
										<button class="btn" onclick={() => patchState(t.id, 'finished')} disabled={busy}>Finish</button>
										<button class="btn danger" onclick={() => patchState(t.id, 'rejected')} disabled={busy}>Reject</button>
									{/if}
									<button class="btn ghost" onclick={() => removeTransfer(t)} disabled={busy} title="Delete transfer"><Icon name="trash" size={13} /></button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted empty">
				{data.transfers.length
					? 'No transfers match the current filter.'
					: 'No transfers yet — send a plan to a contact from a case, or create a service request.'}
			</p>
		{/if}
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
	.spacer {
		flex: 1;
	}
	.inbox-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 1100px;
		margin: 0 auto;
		width: 100%;
	}
	.nudge {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border: 1px solid var(--accent-2);
		border-radius: var(--radius);
		background: var(--bg-2);
		color: var(--accent-2);
		font-size: 12px;
	}
	.nudge-close {
		margin-left: auto;
	}
	.request-panel {
		border-color: var(--accent-dim);
	}
	.request-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.request-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding: 12px 14px;
		border-top: 1px solid var(--border-soft);
	}
	.inbox-toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border-soft);
	}
	.tabs {
		display: flex;
		gap: 2px;
		background: var(--bg-0);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2px;
	}
	.tab {
		border: 0;
		background: transparent;
		color: var(--text-dim);
		padding: 4px 12px;
		border-radius: var(--radius);
		font-size: 12px;
	}
	.tab.active {
		background: var(--bg-3);
		color: var(--text);
	}
	.count {
		font-size: 11px;
		margin-left: auto;
		white-space: nowrap;
	}
	.inbox-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.inbox-table th,
	.inbox-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 6px 10px;
		text-align: left;
		vertical-align: middle;
	}
	.inbox-table th {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--text-dim);
	}
	tr.unread td {
		font-weight: 700;
	}
	.mono {
		font-family: var(--mono);
		white-space: nowrap;
	}
	.dir {
		font-weight: 700;
		width: 18px;
	}
	.dir.in {
		color: var(--accent-2);
	}
	.dir.out {
		color: var(--accent-bright);
	}
	.comment {
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip {
		display: inline-block;
		padding: 1px 9px;
		border-radius: 10px;
		font-size: 11px;
		border: 1px solid var(--border);
		background: var(--bg-3);
		color: var(--text-dim);
		text-transform: capitalize;
	}
	.chip.downloaded {
		color: var(--accent-bright);
		border-color: var(--accent-dim);
	}
	.chip.imported,
	.chip.finished {
		color: var(--green);
		border-color: var(--green);
	}
	.chip.rejected {
		color: var(--red);
		border-color: var(--red);
	}
	.row-actions {
		white-space: nowrap;
		text-align: right;
	}
	.row-actions :global(.btn) {
		padding: 2px 8px;
		font-size: 11px;
	}
	.row-actions select {
		font-size: 11px;
		max-width: 200px;
	}
	.empty {
		padding: 24px;
		text-align: center;
	}
</style>
