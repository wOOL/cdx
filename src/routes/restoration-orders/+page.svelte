<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { FDI_UPPER, FDI_LOWER } from '$lib/aiReviewMap';
	import { defaultSubtype, PROSTHESIS_SUBTYPES, type ProsthesisRole } from '$lib/restorationCatalog';
	import type { RestorationUnit } from '$lib/types';

	let { data } = $props();

	const caseId = $derived(data.case.id);

	// ---- new-order form state ----
	let dentist = $state('');
	let material = $state('');
	let shade = $state('');
	let anatomyFamily = $state('');
	let notes = $state('');
	// FDI → unit map (only teeth with a role are units)
	let units = $state<Record<number, { role: string; subtype: string }>>({});
	let bridges = $state<number[][]>([]);
	let selected = $state<Set<number>>(new Set());
	let pickerFdi = $state<number | null>(null);

	let busy = $state(false);
	let errorMsg = $state('');
	let message = $state('');

	function fdiLabel(fdi: number): string {
		return String(fdi);
	}

	function subtypesFor(role: string): string[] {
		return PROSTHESIS_SUBTYPES[role as ProsthesisRole] ?? [];
	}

	function isBridged(fdi: number): boolean {
		return bridges.some((g) => g.includes(fdi));
	}

	function toggleSelect(fdi: number) {
		const next = new Set(selected);
		if (next.has(fdi)) next.delete(fdi);
		else next.add(fdi);
		selected = next;
	}

	/** Open the role/subtype picker for a tooth (also adds it to the unit set). */
	function openPicker(fdi: number) {
		pickerFdi = fdi;
	}

	function setRole(fdi: number, role: string) {
		units = { ...units, [fdi]: { role, subtype: defaultSubtype(role) } };
	}

	function setSubtype(fdi: number, subtype: string) {
		const u = units[fdi];
		if (u) units = { ...units, [fdi]: { ...u, subtype } };
	}

	function removeUnit(fdi: number) {
		const next = { ...units };
		delete next[fdi];
		units = next;
		// drop from any bridge groups too
		bridges = bridges
			.map((g) => g.filter((n) => n !== fdi))
			.filter((g) => g.length >= 2);
		if (pickerFdi === fdi) pickerFdi = null;
	}

	function createBridge() {
		const group = [...selected].filter((fdi) => units[fdi]).sort((a, b) => a - b);
		if (group.length < 2) {
			errorMsg = 'Select at least two placed units to group into a bridge.';
			return;
		}
		errorMsg = '';
		bridges = [...bridges, group];
		selected = new Set();
	}

	function removeBridge(idx: number) {
		bridges = bridges.filter((_, i) => i !== idx);
	}

	function unitsArray(): RestorationUnit[] {
		return Object.entries(units).map(([fdi, u]) => ({
			fdi: Number(fdi),
			role: u.role,
			subtype: u.subtype
		}));
	}

	function resetForm() {
		dentist = '';
		material = '';
		shade = '';
		anatomyFamily = '';
		notes = '';
		units = {};
		bridges = [];
		selected = new Set();
		pickerFdi = null;
	}

	async function createOrder(e: SubmitEvent) {
		e.preventDefault();
		const u = unitsArray();
		if (u.length === 0) {
			errorMsg = 'Add at least one tooth unit (click a tooth and pick a role).';
			return;
		}
		busy = true;
		errorMsg = '';
		message = '';
		const r = await fetch(`/api/cases/${caseId}/restoration-orders`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				dentist,
				material,
				shade,
				anatomy_family: anatomyFamily,
				notes,
				units: u,
				bridges
			})
		});
		const body = await r.json().catch(() => ({}));
		if (!r.ok) {
			errorMsg = body?.message ?? `Create failed (${r.status})`;
		} else {
			message = `Created order ${body.order.order_number}.`;
			resetForm();
			await invalidateAll();
		}
		busy = false;
	}

	async function setStatus(id: number, status: string) {
		busy = true;
		errorMsg = '';
		const r = await fetch(`/api/restoration-orders/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ status })
		});
		if (!r.ok) errorMsg = `Update failed (${r.status})`;
		await invalidateAll();
		busy = false;
	}

	async function remove(id: number, num: string) {
		if (!confirm(`Delete restoration order ${num}?`)) return;
		busy = true;
		errorMsg = '';
		const r = await fetch(`/api/restoration-orders/${id}`, { method: 'DELETE' });
		if (!r.ok) errorMsg = `Delete failed (${r.status})`;
		await invalidateAll();
		busy = false;
	}

	function materialLabel(id: string): string {
		return data.catalog.materials.find((m) => m.id === id)?.label ?? id;
	}
	function anatomyLabel(id: string): string {
		return data.catalog.anatomyFamilies.find((a) => a.id === id)?.label ?? id;
	}
	function unitsSummary(list: RestorationUnit[]): string {
		return list
			.slice()
			.sort((a, b) => a.fdi - b.fdi)
			.map((u) => `${u.fdi} ${u.role}`)
			.join(', ');
	}
</script>

<svelte:head>
	<title>Restoration orders — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/cad?case={caseId}"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Restoration orders — {data.patientName} · {data.case.title}</div>
</header>

<div class="ro-wrap">
	<div class="panel">
		<div class="panel-header">Orders on this case</div>
		<table class="ro-table">
			<thead>
				<tr>
					<th>Order #</th><th>Status</th><th>Units</th><th>Material</th><th>Shade</th><th>Anatomy</th><th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.orders as o (o.id)}
					<tr>
						<td>{o.order_number}</td>
						<td>
							<select
								value={o.status}
								disabled={busy}
								onchange={(e) => setStatus(o.id, e.currentTarget.value)}
							>
								{#each data.catalog.statuses as s (s)}
									<option value={s}>{s}</option>
								{/each}
							</select>
						</td>
						<td class="ro-units">{unitsSummary(o.units) || '—'}{#if o.bridges.length} · {o.bridges.length} bridge{o.bridges.length > 1 ? 's' : ''}{/if}</td>
						<td>{o.material ? materialLabel(o.material) : '—'}</td>
						<td>{o.shade || '—'}</td>
						<td>{o.anatomy_family ? anatomyLabel(o.anatomy_family) : '—'}</td>
						<td class="ro-actions">
							<button class="btn danger" disabled={busy} title="Delete order" onclick={() => remove(o.id, o.order_number)}>
								<Icon name="trash" size={14} />
							</button>
						</td>
					</tr>
				{:else}
					<tr><td colspan="7" class="ro-none">No restoration orders on this case yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<form class="panel" onsubmit={createOrder}>
		<div class="panel-header">New order</div>
		<div class="ro-body">
			<div class="ro-form-row">
				<div class="ro-field">
					<label for="ro-dentist">Dentist</label>
					<input id="ro-dentist" placeholder="Referring dentist" bind:value={dentist} />
				</div>
				<div class="ro-field">
					<label for="ro-material">Material</label>
					<select id="ro-material" bind:value={material}>
						<option value="">—</option>
						{#each data.catalog.materials as m (m.id)}
							<option value={m.id}>{m.label}</option>
						{/each}
					</select>
				</div>
				<div class="ro-field">
					<label for="ro-shade">Shade</label>
					<select id="ro-shade" bind:value={shade}>
						<option value="">—</option>
						{#each data.catalog.shades as s (s)}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>
				<div class="ro-field">
					<label for="ro-anatomy">Anatomy family</label>
					<select id="ro-anatomy" bind:value={anatomyFamily}>
						<option value="">—</option>
						{#each data.catalog.anatomyFamilies as a (a.id)}
							<option value={a.id}>{a.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="ro-chart-head">
				<span class="muted">Click a tooth to select it; use the picker below to set its role &amp; subtype.</span>
				<button type="button" class="btn" disabled={selected.size < 2} onclick={createBridge}>
					<Icon name="plus" size={13} /> Create bridge
				</button>
			</div>

			<div class="ro-chart">
				{#each [FDI_UPPER, FDI_LOWER] as row, ri (ri)}
					<div class="ro-row">
						{#each row as fdi (fdi)}
							{@const u = units[fdi]}
							<button
								type="button"
								class="tooth"
								class:placed={!!u}
								class:sel={selected.has(fdi)}
								class:bridged={isBridged(fdi)}
								title={u ? `${fdi} — ${u.role} (${u.subtype})` : String(fdi)}
								onclick={() => toggleSelect(fdi)}
								ondblclick={() => openPicker(fdi)}
							>
								<span class="tooth-fdi">{fdiLabel(fdi)}</span>
								{#if u}<span class="tooth-role">{u.role.slice(0, 3)}</span>{/if}
							</button>
						{/each}
					</div>
				{/each}
			</div>

			<div class="ro-picker-row">
				{#if selected.size}
					<span class="muted">Selected: {[...selected].sort((a, b) => a - b).join(', ')}</span>
					{#each [...selected].sort((a, b) => a - b) as fdi (fdi)}
						<div class="ro-picker">
							<span class="ro-picker-fdi">{fdi}</span>
							<select value={units[fdi]?.role ?? ''} onchange={(e) => setRole(fdi, e.currentTarget.value)}>
								<option value="" disabled>role…</option>
								{#each data.catalog.roles as role (role)}
									<option value={role}>{role}</option>
								{/each}
							</select>
							{#if units[fdi]}
								<select value={units[fdi].subtype} onchange={(e) => setSubtype(fdi, e.currentTarget.value)}>
									{#each subtypesFor(units[fdi].role) as st (st)}
										<option value={st}>{st}</option>
									{/each}
								</select>
								<button type="button" class="btn danger sm" title="Remove unit" onclick={() => removeUnit(fdi)}>
									<Icon name="trash" size={12} />
								</button>
							{/if}
						</div>
					{/each}
				{:else}
					<span class="muted">No teeth selected.</span>
				{/if}
			</div>

			{#if bridges.length}
				<div class="ro-bridges">
					<span class="muted">Bridges:</span>
					{#each bridges as g, i (i)}
						<span class="ro-bridge-tag">
							{g.join('–')}
							<button type="button" onclick={() => removeBridge(i)} aria-label="Remove bridge">×</button>
						</span>
					{/each}
				</div>
			{/if}

			<div class="ro-field">
				<label for="ro-notes">Notes</label>
				<textarea id="ro-notes" rows="2" bind:value={notes}></textarea>
			</div>

			<div class="ro-form-row">
				<button class="btn primary" type="submit" disabled={busy}>
					<Icon name="import" size={14} /> Create order
				</button>
				{#if message}<p class="ro-ok"><Icon name="check" size={13} /> {message}</p>{/if}
				{#if errorMsg}<p class="ro-err"><Icon name="warning" size={13} /> {errorMsg}</p>{/if}
			</div>
		</div>
	</form>
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
	.ro-wrap {
		max-width: 980px;
		margin: 24px auto;
		padding: 0 16px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.ro-body {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.ro-form-row {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.ro-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ro-field label {
		font-size: 11px;
	}
	.ro-field textarea {
		width: 100%;
		resize: vertical;
	}
	.ro-ok {
		color: #3aa757;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.ro-err {
		color: #d4566a;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.ro-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.ro-table th,
	.ro-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 7px 12px;
		text-align: left;
	}
	.ro-units {
		max-width: 240px;
	}
	.ro-actions {
		text-align: right;
	}
	.ro-none {
		text-align: center;
		opacity: 0.6;
		padding: 18px;
	}
	.ro-chart-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.ro-chart {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: center;
	}
	.ro-row {
		display: flex;
		gap: 3px;
		flex-wrap: nowrap;
	}
	.tooth {
		width: 34px;
		height: 42px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		border: 1px solid var(--border-soft);
		border-radius: 5px;
		background: var(--bg-1);
		font-size: 11px;
		cursor: pointer;
		padding: 0;
	}
	.tooth:hover {
		border-color: var(--accent-dim);
	}
	.tooth.placed {
		background: var(--bg-3);
		border-color: var(--accent-dim);
	}
	.tooth.sel {
		outline: 2px solid var(--accent-bright);
		outline-offset: -1px;
	}
	.tooth.bridged {
		box-shadow: inset 0 -3px 0 var(--accent-2);
	}
	.tooth-fdi {
		font-weight: 600;
	}
	.tooth-role {
		font-size: 9px;
		color: var(--accent-2);
		text-transform: uppercase;
	}
	.ro-picker-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ro-picker {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.ro-picker-fdi {
		font-weight: 600;
		width: 24px;
	}
	.btn.sm {
		padding: 3px 6px;
	}
	.ro-bridges {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.ro-bridge-tag {
		font-size: 11px;
		padding: 2px 6px;
		border: 1px solid var(--accent-dim);
		border-radius: 4px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.ro-bridge-tag button {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		font-size: 13px;
		line-height: 1;
		padding: 0;
	}
</style>
