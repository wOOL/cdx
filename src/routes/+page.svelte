<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import ImagesLink from '$lib/components/ImagesLink.svelte';
	import type { Patient } from '$lib/types';

	let { data, form } = $props();

	let patientDialog: HTMLDialogElement | undefined = $state();
	let editingPatient: Patient | null = $state(null);
	let caseDialog: HTMLDialogElement | undefined = $state();
	let searchValue = $state(data.search);

	function openNewPatient() {
		editingPatient = null;
		patientDialog?.showModal();
	}
	function openEditPatient() {
		if (!data.selected) return;
		editingPatient = data.selected;
		patientDialog?.showModal();
	}

	function fmtDate(s: string): string {
		if (!s) return '—';
		return s;
	}

	function age(dob: string): string {
		if (!dob) return '';
		const d = new Date(dob);
		if (isNaN(d.getTime())) return '';
		const diff = Date.now() - d.getTime();
		return `${Math.floor(diff / 3.15576e10)} y`;
	}

	let importInput: HTMLInputElement | undefined = $state();
	let importing = $state(false);

	async function importCase(file: File) {
		importing = true;
		try {
			const form = new FormData();
			form.append('file', file);
			const res = await fetch('/api/import-case', { method: 'POST', body: form });
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				alert(body?.message ?? 'Import failed');
				return;
			}
			await goto(`/cases/${body.caseId}`);
		} finally {
			importing = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			const params = new URLSearchParams();
			if (searchValue) params.set('q', searchValue);
			if (data.selected) params.set('sel', String(data.selected.id));
			goto(`/?${params}`, { keepFocus: true, noScroll: true });
		}, 250);
	}
</script>

<header class="appbar">
	<div class="brand">
		<span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span>
	</div>
	<div class="appbar-sub">Patient database</div>
	<div class="spacer"></div>
	{#if data.user}
		<div class="mode-toggle" title="Work mode: EXPERT shows all tools; EASY guides step by step">
			{#each ['expert', 'easy'] as m (m)}
				<button
					class:mode-active={data.user.work_mode === m}
					onclick={async () => {
						await fetch('/api/me', {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ work_mode: m })
						});
						await invalidateAll();
					}}
				>
					{m.toUpperCase()}
				</button>
			{/each}
		</div>
		<span class="muted user-chip" title={data.user.email}>
			<Icon name="patient" size={14} />
			{data.user.name || data.user.email}
		</span>
	{/if}
	<a class="btn ghost" href="/settings" title="Settings"><Icon name="settings" /></a>
	<form method="POST" action="/logout">
		<button class="btn ghost" title="Sign out"><Icon name="export" size={16} /></button>
	</form>
</header>

<div class="db-layout">
	<!-- left: patient list -->
	<aside class="patients panel">
		<div class="db-toolbar">
			<button class="tool-btn" onclick={openNewPatient}>
				<Icon name="patient-add" size={22} />
				<span>New</span>
			</button>
			<button class="tool-btn" disabled={!data.selected} onclick={openEditPatient}>
				<Icon name="edit" size={22} />
				<span>Edit</span>
			</button>
			<form
				method="POST"
				action="?/deletePatient"
				use:enhance={({ cancel }) => {
					if (
						!confirm(
							`Delete patient "${data.selected?.last_name}, ${data.selected?.first_name}" and all of their cases?`
						)
					)
						cancel();
				}}
			>
				<input type="hidden" name="id" value={data.selected?.id ?? ''} />
				<button class="tool-btn" disabled={!data.selected}>
					<Icon name="trash" size={22} />
					<span>Delete</span>
				</button>
			</form>
			<button class="tool-btn" onclick={() => importInput?.click()} title="Import a case archive (.zip)">
				<Icon name="import" size={22} />
				<span>{importing ? '…' : 'Import'}</span>
			</button>
			<input
				type="file"
				accept=".zip"
				hidden
				bind:this={importInput}
				onchange={(e) => e.currentTarget.files?.[0] && importCase(e.currentTarget.files[0])}
			/>
		</div>

		<div class="search-row">
			<Icon name="search" size={16} />
			<input
				type="text"
				placeholder="Search patients…"
				bind:value={searchValue}
				oninput={onSearchInput}
			/>
		</div>

		<div class="patient-list">
			{#each data.patients as p (p.id)}
				<a
					class="patient-row"
					class:selected={data.selected?.id === p.id}
					href="/?sel={p.id}{searchValue ? `&q=${encodeURIComponent(searchValue)}` : ''}"
				>
					<Icon name="patient" size={18} />
					<div class="patient-row-main">
						<div class="patient-name">{p.last_name}{p.last_name && p.first_name ? ', ' : ''}{p.first_name}</div>
						<div class="patient-meta faint">
							{p.external_id ? `ID ${p.external_id}` : `#${p.id}`}
							{p.date_of_birth ? ` · ${p.date_of_birth}` : ''}
						</div>
					</div>
				</a>
			{:else}
				<div class="empty-hint">
					{data.search ? 'No patients match your search.' : 'No patients yet. Create the first one.'}
				</div>
			{/each}
		</div>
	</aside>

	<!-- right: selected patient + cases -->
	<main class="cases-pane">
		{#if data.selected}
			<div class="patient-card panel">
				<div class="patient-card-head">
					<div class="patient-avatar"><Icon name="patient" size={28} /></div>
					<div>
						<h2>
							{data.selected.last_name}{data.selected.last_name && data.selected.first_name
								? ', '
								: ''}{data.selected.first_name}
						</h2>
						<div class="muted">
							{data.selected.external_id ? `ID ${data.selected.external_id} · ` : ''}
							{data.selected.sex || '—'} · born {fmtDate(data.selected.date_of_birth)}
							{age(data.selected.date_of_birth) ? ` (${age(data.selected.date_of_birth)})` : ''}
						</div>
					</div>
				</div>
				{#if data.selected.notes}
					<div class="patient-notes muted">{data.selected.notes}</div>
				{/if}
				<form method="POST" action="?/toggleAnonymize" class="anon-row" use:enhance>
					<input type="hidden" name="id" value={data.selected.id} />
					<button class="btn ghost" type="submit" title="Reversibly replace the identity with a pseudonym">
						{data.selected.real_data ? '🔓 De-anonymize patient' : '🕶 Anonymize patient'}
					</button>
					{#if data.selected.real_data}
						<span class="badge planning">anonymized</span>
					{/if}
				</form>
			</div>

			<div class="cases-head">
				<h3>Cases</h3>
				<button class="btn primary" onclick={() => caseDialog?.showModal()}>
					<Icon name="plus" size={14} /> New case
				</button>
			</div>



			<div class="case-grid">
				{#each data.cases as c (c.id)}
					<div class="case-tile panel">
						<a class="case-tile-body" href="/cases/{c.id}">
							<Icon name="case" size={26} />
							<div class="case-title">{c.title}</div>
							<div class="faint">
								{c.datasetCount} dataset{c.datasetCount === 1 ? '' : 's'} · {c.created_at.slice(0, 10)}
							</div>
							<span class="badge {c.status}">{c.status}</span>
						</a>
						<form
							method="POST"
							action="?/deleteCase"
							class="case-delete"
							use:enhance={({ cancel }) => {
								if (!confirm(`Delete case "${c.title}"?`)) cancel();
							}}
						>
							<input type="hidden" name="id" value={c.id} />
							<input type="hidden" name="patient_id" value={data.selected.id} />
							<button class="btn ghost danger" title="Delete case"><Icon name="trash" size={14} /></button>
						</form>
					</div>
				{:else}
					<div class="empty-hint">No cases for this patient yet.</div>
				{/each}
			</div>

			{#if data.images.length}
				<div class="cases-head"><h3>Image library</h3><ImagesLink patientId={data.selected.id} count={data.images.length} /></div>
				<div class="image-grid">
					{#each data.images as img (img.id)}
						<figure class="image-tile panel">
							<a href="/api/images/{img.id}" target="_blank" rel="noopener">
								<img src="/api/images/{img.id}" alt={img.name} loading="lazy" />
							</a>
							<figcaption>
								<span class="image-name" title={img.name}>{img.name}</span>
								<a class="tree-eye" href="/api/images/{img.id}?download=1" title="Download">
									<Icon name="export" size={13} />
								</a>
								<button
									class="tree-eye"
									title="Delete"
									onclick={async () => {
										if (!confirm(`Delete snapshot "${img.name}"?`)) return;
										await fetch(`/api/images/${img.id}`, { method: 'DELETE' });
										await invalidateAll();
									}}
								>
									<Icon name="trash" size={13} />
								</button>
							</figcaption>
						</figure>
					{/each}
				</div>
			{/if}		{:else}
			<div class="welcome">
				<div class="welcome-logo"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
				<p class="muted">
					Dental implant planning and surgical guide design.<br />
					Create a patient to get started.
				</p>
				<button class="btn primary" onclick={openNewPatient}>
					<Icon name="patient-add" size={16} /> New patient
				</button>
				<form method="POST" action="?/createDemo" use:enhance>
					<button class="btn" type="submit">
						<Icon name="tooth" size={16} /> Create demo case (synthetic CBCT)
					</button>
				</form>
				{#if form?.error}<div class="form-error">{form.error}</div>{/if}
			</div>
		{/if}
	</main>
</div>

<!-- patient create/edit dialog -->
<dialog bind:this={patientDialog}>
	<form
		method="POST"
		action={editingPatient ? '?/updatePatient' : '?/createPatient'}
		use:enhance={() => {
			patientDialog?.close();
			return async ({ update }) => update();
		}}
	>
		<div class="dialog-title">{editingPatient ? 'Edit patient' : 'New patient'}</div>
		<div class="dialog-body">
			{#if form?.error}<div class="form-error">{form.error}</div>{/if}
			{#if editingPatient}<input type="hidden" name="id" value={editingPatient.id} />{/if}
			<div class="field-row">
				<div>
					<label for="p-last">Last name</label>
					<input id="p-last" name="last_name" value={editingPatient?.last_name ?? ''} style="width:100%" />
				</div>
				<div>
					<label for="p-first">First name</label>
					<input id="p-first" name="first_name" value={editingPatient?.first_name ?? ''} style="width:100%" />
				</div>
			</div>
			<div class="field-row">
				<div>
					<label for="p-dob">Date of birth</label>
					<input id="p-dob" name="date_of_birth" type="date" value={editingPatient?.date_of_birth ?? ''} style="width:100%" />
				</div>
				<div>
					<label for="p-sex">Sex</label>
					<select id="p-sex" name="sex" value={editingPatient?.sex ?? ''} style="width:100%">
						<option value="">—</option>
						<option value="F">Female</option>
						<option value="M">Male</option>
						<option value="O">Other</option>
					</select>
				</div>
				<div>
					<label for="p-ext">Patient ID</label>
					<input id="p-ext" name="external_id" value={editingPatient?.external_id ?? ''} style="width:100%" />
				</div>
			</div>
			<div>
				<label for="p-notes">Notes</label>
				<textarea id="p-notes" name="notes" rows="3" style="width:100%">{editingPatient?.notes ?? ''}</textarea>
			</div>
		</div>
		<div class="dialog-actions">
			<button type="button" class="btn" onclick={() => patientDialog?.close()}>Cancel</button>
			<button type="submit" class="btn primary">{editingPatient ? 'Save' : 'Create'}</button>
		</div>
	</form>
</dialog>

<!-- new case dialog -->
<dialog bind:this={caseDialog}>
	<form
		method="POST"
		action="?/createCase"
		use:enhance={() => {
			caseDialog?.close();
			return async ({ update }) => update();
		}}
	>
		<div class="dialog-title">New case</div>
		<div class="dialog-body">
			<input type="hidden" name="patient_id" value={data.selected?.id ?? ''} />
			<div>
				<label for="c-title">Case title</label>
				<input id="c-title" name="title" placeholder="e.g. Implant 36, single tooth" style="width:100%" />
			</div>
		</div>
		<div class="dialog-actions">
			<button type="button" class="btn" onclick={() => caseDialog?.close()}>Cancel</button>
			<button type="submit" class="btn primary">Create & open</button>
		</div>
	</form>
</dialog>

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
		letter-spacing: 0.01em;
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
	.user-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.mode-toggle {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.mode-toggle button {
		padding: 3px 10px;
		font-size: 10px;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		background: var(--bg-1);
	}
	.mode-toggle .mode-active {
		background: var(--accent-dim);
		color: #fff;
	}

	.db-layout {
		flex: 1;
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 10px;
		padding: 10px;
		min-height: 0;
	}

	.patients {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.db-toolbar {
		display: flex;
		gap: 2px;
		padding: 6px;
		border-bottom: 1px solid var(--border-soft);
	}
	.search-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-bottom: 1px solid var(--border-soft);
		color: var(--text-dim);
	}
	.search-row input {
		flex: 1;
		border: none;
		background: transparent;
		padding: 2px;
	}
	.patient-list {
		flex: 1;
		overflow-y: auto;
	}
	.patient-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		color: var(--text);
		border-bottom: 1px solid var(--border-soft);
		cursor: pointer;
	}
	.patient-row:hover {
		background: var(--bg-3);
	}
	.patient-row.selected {
		background: var(--accent-dim);
	}
	.patient-row.selected .faint {
		color: #cfe8f2;
	}
	.patient-name {
		font-weight: 600;
	}
	.patient-meta {
		font-size: 11px;
	}

	.cases-pane {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
		overflow-y: auto;
	}
	.patient-card {
		padding: 14px 16px;
	}
	.patient-card-head {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.patient-avatar {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: var(--bg-3);
		display: grid;
		place-items: center;
		color: var(--accent-bright);
	}
	.patient-notes {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--border-soft);
		white-space: pre-wrap;
	}
	.anon-row {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cases-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.case-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 10px;
	}
	.case-tile {
		position: relative;
	}
	.case-tile-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-start;
		padding: 14px;
		color: var(--text);
	}
	.case-tile:hover {
		border-color: var(--accent-dim);
		background: var(--bg-3);
	}
	.case-title {
		font-weight: 600;
	}
	.case-delete {
		position: absolute;
		top: 6px;
		right: 6px;
		opacity: 0;
	}
	.case-tile:hover .case-delete {
		opacity: 1;
	}

	.empty-hint {
		padding: 24px;
		text-align: center;
		color: var(--text-faint);
	}
	.image-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
	}
	.image-tile {
		margin: 0;
		overflow: hidden;
	}
	.image-tile img {
		display: block;
		width: 100%;
		height: 96px;
		object-fit: cover;
		background: #000;
	}
	.image-tile figcaption {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		font-size: 11px;
	}
	.image-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-dim);
	}
	.tree-eye {
		color: var(--text-dim);
		display: inline-flex;
	}
	.tree-eye:hover {
		color: var(--text);
	}
	.welcome {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		text-align: center;
	}
	.welcome-logo {
		font-size: 32px;
		font-weight: 700;
	}
	.form-error {
		color: var(--red);
		font-size: 12px;
	}
</style>
