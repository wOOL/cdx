<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	type Order = (typeof data.orders)[number];

	// ---- shared fetch helper ----
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

	// ---- provider registration ----
	let regName = $state('');
	let regServices = $state<string[]>([]);

	function toggleService(id: string) {
		regServices = regServices.includes(id)
			? regServices.filter((s) => s !== id)
			: [...regServices, id];
	}

	function register() {
		return api('/api/orders/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: regName, services: regServices })
		});
	}

	function confirm() {
		return api('/api/orders/confirm', { method: 'POST' });
	}

	function serviceLabel(id: string): string {
		return data.services.find((s) => s.id === id)?.label ?? id;
	}

	// ---- order list ----
	const SERVICE_CLASS: Record<string, string> = {
		'Digital surgical guide': 'guide',
		Custom: 'custom',
		'Bone block design': 'bone',
		'Radiographic assessment': 'radiographic'
	};
	function svcClass(service: string): string {
		return SERVICE_CLASS[service] ?? 'other';
	}

	let q = $state('');
	let groupBy = $state<'none' | 'contact' | 'patient' | 'service'>('none');

	const filtered = $derived(
		data.orders.filter((o) => {
			const needle = q.trim().toLowerCase();
			if (!needle) return true;
			const hay =
				`#${o.id} ${o.service} ${o.state} ${o.contact} ${o.patientAlias} ${o.caseTitle} ${o.createdAt}`.toLowerCase();
			return hay.includes(needle);
		})
	);

	const groups = $derived.by(() => {
		if (groupBy === 'none') return [{ label: '', rows: filtered }];
		const keyOf = (o: Order) =>
			groupBy === 'contact'
				? o.contact || 'Unknown contact'
				: groupBy === 'patient'
					? o.patientAlias || 'No patient'
					: o.service;
		const map = new Map<string, Order[]>();
		for (const o of filtered) {
			const k = keyOf(o);
			const list = map.get(k);
			if (list) list.push(o);
			else map.set(k, [o]);
		}
		return [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([label, rows]) => ({ label, rows }));
	});

	// ---- sequence-controlled actions ----
	function actionTitle(o: Order, action: string): string {
		switch (action) {
			case 'process':
				return o.state === 'new'
					? 'Start processing this order (opens the service for work)'
					: `Order is already ${o.state} — only new orders can be processed`;
			case 'finish':
				return o.state === 'processing'
					? 'Mark the current service as finished'
					: o.state === 'new'
						? 'Process the order first — services are sequence-controlled'
						: `Order is already ${o.state}`;
			case 'reject':
				return o.state === 'new' || o.state === 'processing'
					? 'Reject this service request (minus icon on the sender side)'
					: `Order is already ${o.state}`;
			default:
				return o.state === 'finished' || o.state === 'rejected'
					? 'Remove this order from the list'
					: 'Only finished or rejected orders can be removed';
		}
	}

	function can(o: Order, action: string): boolean {
		if (action === 'process') return o.state === 'new';
		if (action === 'finish') return o.state === 'processing';
		if (action === 'reject') return o.state === 'new' || o.state === 'processing';
		return o.state === 'finished' || o.state === 'rejected';
	}

	function act(o: Order, action: string) {
		if (action === 'remove' && !window.confirm(`Remove order #${o.id} (${o.service})?`)) return;
		return api(`/api/orders/${o.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action })
		});
	}

	function fmtDate(s: string): string {
		const d = new Date(s.replace(' ', 'T') + 'Z');
		return isNaN(d.getTime()) ? s : d.toLocaleDateString();
	}
</script>

<svelte:head>
	<title>Order Management — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Order Management</div>
	<div class="spacer"></div>
	<a class="btn ghost" href="/inbox"><Icon name="import" size={15} /> Inbox</a>
	<a class="btn ghost" href="/contacts"><Icon name="patient" size={15} /> Contacts</a>
</header>

<div class="orders-wrap">
	<!-- provider registration -->
	<div class="panel">
		<div class="panel-header">Provider profile</div>
		{#if data.profile?.registered}
			<div class="reg-body">
				<div class="reg-summary">
					<span class="reg-name"><Icon name="check" size={15} /> {data.profile.name}</span>
					<span class="muted">registered provider — listed in the lab directory</span>
				</div>
				<div class="svc-chips">
					{#each data.profile.services as s (s)}
						<span class="chip svc-chip">{serviceLabel(s)}</span>
					{/each}
				</div>
			</div>
		{:else if data.profile?.confirmationPending}
			<div class="reg-body">
				<div class="pending-banner">
					<Icon name="warning" size={16} />
					<span>
						<strong>Confirmation pending</strong> — a confirmation email was sent for
						“{data.profile.name}”. The profile is listed in the directory once confirmed.
					</span>
					<button class="btn primary" onclick={confirm} disabled={busy}
						title="Simulates following the link in the confirmation email">Confirm registration</button>
				</div>
			</div>
		{:else}
			<div class="reg-body">
				<p class="muted">
					Register this installation as an order-management provider to be listed in the lab
					directory and receive service requests from clinicians.
				</p>
				<div class="reg-form">
					<div class="reg-field">
						<label for="reg-name">Provider / lab name</label>
						<input id="reg-name" bind:value={regName} placeholder="e.g. Riverside Guide Lab" />
					</div>
					<fieldset class="reg-services">
						<legend>Offered services</legend>
						{#each data.services as s (s.id)}
							<label class="svc-check">
								<input
									type="checkbox"
									checked={regServices.includes(s.id)}
									onchange={() => toggleService(s.id)}
								/>
								{s.label}
							</label>
						{/each}
					</fieldset>
					<button
						class="btn primary"
						onclick={register}
						disabled={busy || !regName.trim() || !regServices.length}
						title={!regName.trim() || !regServices.length
							? 'Enter a name and pick at least one service'
							: 'Submit registration (confirmation email follows)'}>Register</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- lab directory -->
	<div class="panel">
		<div class="panel-header">Lab directory</div>
		<table class="dir-table">
			<thead>
				<tr><th>Provider</th><th>Services offered</th></tr>
			</thead>
			<tbody>
				{#each data.labs as lab (lab.name)}
					<tr class:self={lab.self}>
						<td>
							{lab.name}
							{#if lab.self}<span class="chip you">your lab</span>{/if}
						</td>
						<td>
							<div class="svc-chips">
								{#each lab.services as s (s)}
									<span class="chip svc-chip">{serviceLabel(s)}</span>
								{/each}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- order list -->
	<div class="panel">
		<div class="panel-header">Orders</div>
		<div class="orders-toolbar">
			<label class="group-label" for="ord-group">Group by</label>
			<select id="ord-group" bind:value={groupBy}>
				<option value="none">— no grouping —</option>
				<option value="contact">Contact</option>
				<option value="patient">Patient</option>
				<option value="service">Service</option>
			</select>
			<input
				type="search"
				placeholder="Search orders (contact, patient, case, service, state)…"
				bind:value={q}
				style="flex:1; max-width:360px"
			/>
			<span class="muted count">{filtered.length} of {data.orders.length}</span>
		</div>

		{#if filtered.length}
			<table class="orders-table">
				<thead>
					<tr>
						<th>Order</th>
						<th>Service</th>
						<th>Contact</th>
						<th>Patient</th>
						<th>Case</th>
						<th>State</th>
						<th>Received</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each groups as g (g.label)}
						{#if groupBy !== 'none'}
							<tr class="group-row">
								<td colspan="8">{g.label} <span class="muted">({g.rows.length})</span></td>
							</tr>
						{/if}
						{#each g.rows as o (o.id)}
							<tr class="order-row svc-{svcClass(o.service)}">
								<td class="mono">#{o.id}</td>
								<td><span class="svc-dot svc-{svcClass(o.service)}"></span>{o.service}</td>
								<td>{o.contact || '—'}</td>
								<td>{o.patientAlias || '—'}</td>
								<td>{o.caseTitle || '—'}</td>
								<td>
									<span class="state-chip st-{o.state}"><span class="state-bar"></span>{o.state}</span>
								</td>
								<td class="muted">{fmtDate(o.createdAt)}</td>
								<td class="row-actions">
									<button class="btn" onclick={() => act(o, 'process')} disabled={busy || !can(o, 'process')} title={actionTitle(o, 'process')}>Process</button>
									<button class="btn" onclick={() => act(o, 'finish')} disabled={busy || !can(o, 'finish')} title={actionTitle(o, 'finish')}>Finish</button>
									<button class="btn danger" onclick={() => act(o, 'reject')} disabled={busy || !can(o, 'reject')} title={actionTitle(o, 'reject')}>Reject</button>
									<button class="btn ghost" onclick={() => act(o, 'remove')} disabled={busy || !can(o, 'remove')} title={actionTitle(o, 'remove')}>
										<Icon name="trash" size={13} />
									</button>
								</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted empty">
				{data.orders.length
					? 'No orders match the current search.'
					: 'No orders yet — incoming service requests from clinicians appear here.'}
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
	.orders-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 1180px;
		margin: 0 auto;
		width: 100%;
	}

	/* registration */
	.reg-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.reg-summary {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.reg-name {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 700;
		color: var(--green);
	}
	.pending-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--accent-2);
		border-radius: var(--radius);
		background: var(--bg-1);
		color: var(--accent-2);
		font-size: 12px;
	}
	.pending-banner .btn {
		margin-left: auto;
		white-space: nowrap;
	}
	.reg-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 560px;
	}
	.reg-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.reg-services {
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.reg-services legend {
		font-size: 11px;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.4px;
		padding: 0 4px;
	}
	.svc-check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.reg-form .btn {
		align-self: flex-start;
	}

	/* directory */
	.dir-table,
	.orders-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.dir-table th,
	.dir-table td,
	.orders-table th,
	.orders-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 6px 10px;
		text-align: left;
		vertical-align: middle;
	}
	.dir-table th,
	.orders-table th {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--text-dim);
	}
	tr.self td {
		background: color-mix(in srgb, var(--accent-dim) 14%, transparent);
	}
	.chip {
		display: inline-block;
		padding: 1px 9px;
		border-radius: 10px;
		font-size: 11px;
		border: 1px solid var(--border);
		background: var(--bg-3);
		color: var(--text-dim);
	}
	.chip.you {
		margin-left: 8px;
		color: var(--accent-bright);
		border-color: var(--accent-dim);
	}
	.svc-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	/* order list */
	.orders-toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border-soft);
	}
	.group-label {
		font-size: 11px;
		color: var(--text-dim);
	}
	.count {
		font-size: 11px;
		margin-left: auto;
		white-space: nowrap;
	}
	.group-row td {
		background: var(--bg-1);
		font-weight: 700;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}
	.mono {
		font-family: var(--mono);
		white-space: nowrap;
	}

	/* per-service color coding: left border + dot */
	.order-row {
		border-left: 3px solid transparent;
	}
	.order-row.svc-guide {
		border-left-color: var(--accent-bright);
	}
	.order-row.svc-custom {
		border-left-color: var(--accent-2);
	}
	.order-row.svc-bone {
		border-left-color: var(--green);
	}
	.order-row.svc-radiographic {
		border-left-color: #9c7bd0;
	}
	.order-row.svc-other {
		border-left-color: var(--text-dim);
	}
	.svc-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 7px;
		background: var(--text-dim);
		vertical-align: middle;
	}
	.svc-dot.svc-guide {
		background: var(--accent-bright);
	}
	.svc-dot.svc-custom {
		background: var(--accent-2);
	}
	.svc-dot.svc-bone {
		background: var(--green);
	}
	.svc-dot.svc-radiographic {
		background: #9c7bd0;
	}

	/* state chip with colored bar */
	.state-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 1px 9px 1px 5px;
		border-radius: 10px;
		font-size: 11px;
		border: 1px solid var(--border);
		background: var(--bg-3);
		color: var(--text-dim);
		text-transform: capitalize;
	}
	.state-bar {
		width: 4px;
		height: 12px;
		border-radius: 2px;
		background: var(--text-dim);
	}
	.st-new {
		color: var(--accent-bright);
		border-color: var(--accent-dim);
	}
	.st-new .state-bar {
		background: var(--accent-bright);
	}
	.st-processing {
		color: var(--accent-2);
		border-color: var(--accent-2);
	}
	.st-processing .state-bar {
		background: var(--accent-2);
	}
	.st-finished {
		color: var(--green);
		border-color: var(--green);
	}
	.st-finished .state-bar {
		background: var(--green);
	}
	.st-rejected {
		color: var(--red);
		border-color: var(--red);
	}
	.st-rejected .state-bar {
		background: var(--red);
	}

	.row-actions {
		white-space: nowrap;
		text-align: right;
	}
	.row-actions :global(.btn) {
		padding: 2px 8px;
		font-size: 11px;
	}
	.empty {
		padding: 24px;
		text-align: center;
	}
</style>
