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

	// ---- material labels ----
	function materialLabel(id: string): string {
		return data.materials.find((m) => m.id === id)?.label ?? (id || '—');
	}

	// ---- unit summary ----
	function unitsSummary(o: Order): string {
		if (!o.units.length) return '—';
		const fdis = o.units.map((u) => u.fdi).join(', ');
		return `${o.units.length} unit${o.units.length === 1 ? '' : 's'} (${fdis})`;
	}

	// ---- filter + group by status ----
	let q = $state('');
	let statusFilter = $state<string>('all');

	const PRODUCTION_FLOW = ['routed', 'in-production', 'produced'] as const;

	const filtered = $derived(
		data.orders.filter((o) => {
			if (statusFilter !== 'all' && o.status !== statusFilter) return false;
			const needle = q.trim().toLowerCase();
			if (!needle) return true;
			const hay =
				`${o.order_number} ${o.status} ${o.patient_name} ${o.case_title} ${materialLabel(o.material)} ${o.shade} ${o.subcontractor}`.toLowerCase();
			return hay.includes(needle);
		})
	);

	// status -> order rows, in lifecycle order then any others
	const STATUS_ORDER = ['draft', 'routed', 'designing', 'designed', 'in-production', 'produced'];
	const groups = $derived.by(() => {
		const map = new Map<string, Order[]>();
		for (const o of filtered) {
			const list = map.get(o.status);
			if (list) list.push(o);
			else map.set(o.status, [o]);
		}
		return [...map.entries()].sort((a, b) => {
			const ai = STATUS_ORDER.indexOf(a[0]);
			const bi = STATUS_ORDER.indexOf(b[0]);
			return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
		});
	});

	// counts per status for the filter chips
	const counts = $derived.by(() => {
		const c: Record<string, number> = {};
		for (const o of data.orders) c[o.status] = (c[o.status] ?? 0) + 1;
		return c;
	});

	// ---- production actions ----
	function nextStatus(o: Order): (typeof PRODUCTION_FLOW)[number] | null {
		const i = PRODUCTION_FLOW.indexOf(o.status as (typeof PRODUCTION_FLOW)[number]);
		if (i < 0) return 'routed'; // any design-state order can enter production at "routed"
		if (i >= PRODUCTION_FLOW.length - 1) return null; // already produced
		return PRODUCTION_FLOW[i + 1];
	}

	function advanceLabel(o: Order): string {
		const n = nextStatus(o);
		if (!n) return 'Produced';
		return n === 'routed' ? 'Route to production' : n === 'in-production' ? 'Start production' : 'Mark produced';
	}

	function advance(o: Order) {
		const status = nextStatus(o);
		if (!status) return;
		return api(`/api/restoration-orders/${o.id}/production`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'advance', status })
		});
	}

	// ---- subcontract ----
	let subcontractFor = $state<number | null>(null);
	let subcontractContact = $state<number | ''>('');

	function openSubcontract(o: Order) {
		subcontractFor = o.id;
		subcontractContact = o.subcontracted_to ?? '';
	}

	async function confirmSubcontract() {
		if (subcontractFor == null || subcontractContact === '') return;
		const ok = await api(`/api/restoration-orders/${subcontractFor}/production`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'subcontract', contactId: Number(subcontractContact) })
		});
		if (ok) {
			subcontractFor = null;
			subcontractContact = '';
		}
	}

	function fmtDate(s: string): string {
		const d = new Date(s.replace(' ', 'T') + 'Z');
		return isNaN(d.getTime()) ? s : d.toLocaleDateString();
	}
</script>

<svelte:head>
	<title>Production — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Production Management</div>
	<div class="spacer"></div>
	<a class="btn ghost" href="/orders"><Icon name="case" size={15} /> Orders</a>
	<a class="btn ghost" href="/contacts"><Icon name="patient" size={15} /> Contacts</a>
</header>

<div class="prod-wrap">
	<div class="panel">
		<div class="panel-header">Production queue</div>
		<div class="prod-toolbar">
			<label class="group-label" for="prod-status">Status</label>
			<select id="prod-status" bind:value={statusFilter}>
				<option value="all">All ({data.orders.length})</option>
				{#each data.statuses as s (s)}
					<option value={s}>{s} ({counts[s] ?? 0})</option>
				{/each}
			</select>
			<input
				type="search"
				placeholder="Search (order #, patient, case, material, lab)…"
				bind:value={q}
				style="flex:1; max-width:360px"
			/>
			<span class="muted count">{filtered.length} of {data.orders.length}</span>
		</div>

		{#if filtered.length}
			<table class="prod-table">
				<thead>
					<tr>
						<th>Order</th>
						<th>Patient</th>
						<th>Case</th>
						<th>Units</th>
						<th>Material</th>
						<th>Shade</th>
						<th>Status</th>
						<th>Subcontractor</th>
						<th>Created</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each groups as [status, rows] (status)}
						<tr class="group-row">
							<td colspan="10">{status} <span class="muted">({rows.length})</span></td>
						</tr>
						{#each rows as o (o.id)}
							<tr class="prod-row st-row-{o.status}">
								<td class="mono">{o.order_number}</td>
								<td>{o.patient_name || '—'}</td>
								<td>
									<a class="case-link" href="/restoration-orders?case={o.case_id}"
										>{o.case_title || `case ${o.case_id}`}</a
									>
								</td>
								<td>{unitsSummary(o)}</td>
								<td>{materialLabel(o.material)}</td>
								<td>{o.shade || '—'}</td>
								<td>
									<span class="state-chip st-{o.status}"
										><span class="state-bar"></span>{o.status}</span
									>
								</td>
								<td>{o.subcontractor || '—'}</td>
								<td class="muted">{fmtDate(o.created_at)}</td>
								<td class="row-actions">
									<button
										class="btn"
										onclick={() => advance(o)}
										disabled={busy || !nextStatus(o)}
										title={nextStatus(o)
											? `Advance to ${nextStatus(o)}`
											: 'Order is already produced'}>{advanceLabel(o)}</button
									>
									<button
										class="btn ghost"
										onclick={() => openSubcontract(o)}
										disabled={busy}
										title="Subcontract to a lab contact">Subcontract</button
									>
								</td>
							</tr>
							{#if subcontractFor === o.id}
								<tr class="subcontract-row">
									<td colspan="10">
										<div class="subcontract-form">
											<Icon name="export" size={14} />
											<span>Subcontract <strong>{o.order_number}</strong> to lab:</span>
											{#if data.labs.length}
												<select bind:value={subcontractContact}>
													<option value="">— choose lab contact —</option>
													{#each data.labs as lab (lab.id)}
														<option value={lab.id}>{lab.name}</option>
													{/each}
												</select>
												<button
													class="btn primary"
													onclick={confirmSubcontract}
													disabled={busy || subcontractContact === ''}>Send</button
												>
											{:else}
												<span class="muted"
													>No lab contacts yet — add one in
													<a href="/contacts">Contacts</a>.</span
												>
											{/if}
											<button
												class="btn ghost"
												onclick={() => {
													subcontractFor = null;
													subcontractContact = '';
												}}>Cancel</button
											>
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted empty">
				{data.orders.length
					? 'No orders match the current filter.'
					: 'No restoration orders yet — create one from a case (Restoration orders) to send it to production.'}
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
	.prod-wrap {
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

	.prod-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.prod-table th,
	.prod-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 6px 10px;
		text-align: left;
		vertical-align: middle;
	}
	.prod-table th {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--text-dim);
	}

	.prod-toolbar {
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
	.case-link {
		color: var(--accent-bright);
	}

	/* state chip with colored bar (mirrors /orders) */
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
	.st-routed {
		color: var(--accent-bright);
		border-color: var(--accent-dim);
	}
	.st-routed .state-bar {
		background: var(--accent-bright);
	}
	.st-in-production {
		color: var(--accent-2);
		border-color: var(--accent-2);
	}
	.st-in-production .state-bar {
		background: var(--accent-2);
	}
	.st-produced {
		color: var(--green);
		border-color: var(--green);
	}
	.st-produced .state-bar {
		background: var(--green);
	}

	.row-actions {
		white-space: nowrap;
		text-align: right;
	}
	.row-actions :global(.btn) {
		padding: 2px 8px;
		font-size: 11px;
	}

	.subcontract-row td {
		background: var(--bg-1);
	}
	.subcontract-form {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 4px;
		font-size: 12px;
		flex-wrap: wrap;
	}
	.empty {
		padding: 24px;
		text-align: center;
	}
</style>
