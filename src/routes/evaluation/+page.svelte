<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import HelpOverlay from '$lib/components/HelpOverlay.svelte';

	let { data } = $props();

	interface CaseOption {
		id: number;
		title: string;
		patient: string;
	}
	interface PlanOption {
		id: number;
		name: string;
	}
	interface ModelOption {
		id: number;
		name: string;
		kind: string;
	}

	let helpOpen = $state(false);
	let cases = $state<CaseOption[]>([]);
	let plans = $state<PlanOption[]>([]);
	let models = $state<ModelOption[]>([]);

	let name = $state('');
	let caseId = $state('');
	let planId = $state('');
	let modelId = $state('');
	let type = $state<'scanbody' | 'postopCT'>('postopCT');

	let creating = $state(false);
	let runningId = $state('');
	let deletingId = $state('');
	let expandedId = $state('');
	let errorMsg = $state('');

	$effect(() => {
		fetch('/api/cases-list')
			.then((r) => r.json())
			.then((b) => (cases = b.cases ?? []))
			.catch(() => (cases = []));
	});

	async function onCaseChange() {
		planId = '';
		modelId = '';
		plans = [];
		models = [];
		if (!caseId) return;
		try {
			const r = await fetch(`/api/evaluation/options?caseId=${caseId}`);
			if (!r.ok) return;
			const b = await r.json();
			plans = b.plans ?? [];
			models = b.models ?? [];
			if (plans.length === 1) planId = String(plans[0].id);
		} catch {
			// leave the pickers empty
		}
	}

	async function createStudy(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		if (!name.trim() || !caseId || !planId || !modelId) {
			errorMsg = 'Fill in name, case, plan and post-op model.';
			return;
		}
		creating = true;
		try {
			const r = await fetch('/api/evaluation', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					caseId: Number(caseId),
					planId: Number(planId),
					type,
					modelId: Number(modelId)
				})
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				errorMsg = body?.message ?? `Create failed (${r.status})`;
			} else {
				name = '';
				await invalidateAll();
			}
		} catch {
			errorMsg = 'Create failed — network error.';
		}
		creating = false;
	}

	async function runStudy(id: string) {
		errorMsg = '';
		runningId = id;
		try {
			const r = await fetch(`/api/evaluation/${id}/run`, { method: 'POST' });
			const body = await r.json().catch(() => ({}));
			if (!r.ok) {
				errorMsg = body?.message ?? `Run failed (${r.status})`;
			} else {
				expandedId = id;
				await invalidateAll();
			}
		} catch {
			errorMsg = 'Run failed — network error.';
		}
		runningId = '';
	}

	async function removeStudy(id: string, studyName: string) {
		if (!confirm(`Delete study "${studyName}"? The post-op model itself is not affected.`)) return;
		errorMsg = '';
		deletingId = id;
		try {
			const r = await fetch(`/api/evaluation/${id}`, { method: 'DELETE' });
			if (!r.ok) errorMsg = `Delete failed (${r.status})`;
			if (expandedId === id) expandedId = '';
			await invalidateAll();
		} catch {
			errorMsg = 'Delete failed — network error.';
		}
		deletingId = '';
	}

	function typeLabel(t: string): string {
		return t === 'scanbody' ? 'Scanbody scan' : 'Post-op CT';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'F1') {
			e.preventDefault();
			helpOpen = !helpOpen;
		}
	}
</script>

<svelte:head>
	<title>Treatment evaluation — coDiagnostiX Web</title>
</svelte:head>

<svelte:window {onkeydown} />

<header class="appbar">
	<a class="btn ghost" href="/" aria-label="Back to start"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Treatment evaluation</div>
	<div class="appbar-spacer"></div>
	<button class="btn ghost help-btn" title="Help (F1)" aria-label="Help" onclick={() => (helpOpen = true)}>?</button>
</header>

<div class="ev-wrap">
	<form class="panel" onsubmit={createStudy}>
		<div class="panel-header">New study</div>
		<div class="ev-body">
			<p class="ev-muted">
				Compare planned implant positions with the positions achieved after surgery. Pick the case,
				the plan to evaluate and the postoperative model (scanbody scan or CT-derived surface) of
				that case, then run the study to compute per-implant deviations.
			</p>
			<div class="ev-form-row">
				<div class="ev-field">
					<label for="ev-name">Study name</label>
					<input id="ev-name" placeholder="e.g. Post-op control 46" bind:value={name} />
				</div>
				<div class="ev-field">
					<label for="ev-case">Case</label>
					<select id="ev-case" bind:value={caseId} onchange={onCaseChange}>
						<option value="">— select case —</option>
						{#each cases as c (c.id)}
							<option value={String(c.id)}>{c.patient ? `${c.patient} — ` : ''}{c.title}</option>
						{/each}
					</select>
				</div>
				<div class="ev-field">
					<label for="ev-plan">Plan</label>
					<select id="ev-plan" bind:value={planId} disabled={!caseId}>
						<option value="">— select plan —</option>
						{#each plans as p (p.id)}
							<option value={String(p.id)}>{p.name}</option>
						{/each}
					</select>
				</div>
				<div class="ev-field">
					<label for="ev-type">Study type</label>
					<select id="ev-type" bind:value={type}>
						<option value="postopCT">Post-op CT</option>
						<option value="scanbody">Scanbody scan</option>
					</select>
				</div>
				<div class="ev-field">
					<label for="ev-model">Post-op model</label>
					<select id="ev-model" bind:value={modelId} disabled={!caseId}>
						<option value="">— select model —</option>
						{#each models as m (m.id)}
							<option value={String(m.id)}>{m.name} ({m.kind})</option>
						{/each}
					</select>
				</div>
				<button class="btn primary" type="submit" disabled={creating}>
					<Icon name="plus" size={14} /> Create study
				</button>
			</div>
			{#if errorMsg}<p class="ev-err"><Icon name="warning" size={13} /> {errorMsg}</p>{/if}
		</div>
	</form>

	<div class="panel">
		<div class="panel-header">Studies</div>
		<table class="ev-table">
			<thead>
				<tr>
					<th></th>
					<th>Name</th>
					<th>Case</th>
					<th>Plan</th>
					<th>Type</th>
					<th>Status</th>
					<th>RMS (mm)</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.studies as s (s.id)}
					<tr>
						<td>
							<button
								class="btn ghost ev-expand"
								aria-label={expandedId === s.id ? 'Collapse results' : 'Expand results'}
								onclick={() => (expandedId = expandedId === s.id ? '' : s.id)}
							>
								<Icon name={expandedId === s.id ? 'chevron-down' : 'chevron'} size={14} />
							</button>
						</td>
						<td>{s.name}</td>
						<td>{s.patient ? `${s.patient} — ` : ''}{s.caseTitle}</td>
						<td>{s.planName}</td>
						<td>{typeLabel(s.type)}</td>
						<td>
							{#if s.result}
								<span class="tag tag-on">evaluated</span>
							{:else}
								<span class="tag">not run</span>
							{/if}
						</td>
						<td>{s.result ? s.result.rms.toFixed(2) : '—'}</td>
						<td class="ev-actions">
							<button class="btn" disabled={runningId === s.id} onclick={() => runStudy(s.id)}>
								{runningId === s.id ? 'Running…' : 'Run'}
							</button>
							{#if s.result}
								<a class="btn" href={`/api/evaluation/${s.id}/csv`} download>CSV</a>
							{/if}
							<button
								class="btn danger"
								title="Delete study"
								disabled={deletingId === s.id}
								onclick={() => removeStudy(s.id, s.name)}
							>
								<Icon name="trash" size={14} />
							</button>
						</td>
					</tr>
					{#if expandedId === s.id}
						<tr class="ev-detail-row">
							<td colspan="8">
								{#if s.result}
									<div class="ev-detail">
										<div class="ev-detail-meta">
											Model: {s.modelName} · Registration RMS (ICP):
											{s.result.alignedRmsICP.toFixed(2)} mm · Run: {new Date(
												s.result.ranAt
											).toLocaleString()}
										</div>
										<table class="ev-subtable">
											<thead>
												<tr>
													<th>Tooth</th>
													<th>Entry deviation (mm)</th>
													<th>Apex deviation (mm)</th>
													<th>Angular deviation (°)</th>
													<th>Samples</th>
												</tr>
											</thead>
											<tbody>
												{#each s.result.implants as d (d.tooth + String(d.samples))}
													<tr>
														<td>{d.tooth || 'XX'}</td>
														{#if typeof d.entryMM === 'number'}
															<td>{d.entryMM.toFixed(2)}</td>
															<td>{d.apexMM?.toFixed(2) ?? '—'}</td>
															<td>{d.angleDeg?.toFixed(2) ?? '—'}</td>
														{:else}
															<td colspan="3" class="ev-insufficient">insufficient data</td>
														{/if}
														<td>{d.samples}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{:else}
									<div class="ev-detail ev-muted">
										No results yet — run the study to compute the deviation report.
									</div>
								{/if}
							</td>
						</tr>
					{/if}
				{:else}
					<tr><td colspan="8" class="ev-none">No evaluation studies yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

{#if helpOpen}
	<HelpOverlay topic="evaluation" onclose={() => (helpOpen = false)} />
{/if}

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
	.appbar-spacer {
		flex: 1;
	}
	.help-btn {
		font-weight: 700;
		font-size: 14px;
		width: 30px;
		justify-content: center;
	}
	.ev-wrap {
		max-width: 1100px;
		width: 100%;
		margin: 24px auto;
		padding: 0 16px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		overflow-y: auto;
	}
	.ev-body {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ev-muted {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.ev-form-row {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.ev-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 150px;
	}
	.ev-field label {
		font-size: 11px;
	}
	.ev-err {
		color: #d4566a;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 0;
	}
	.ev-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.ev-table th,
	.ev-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 7px 12px;
		text-align: left;
	}
	.ev-expand {
		padding: 2px 6px;
	}
	.ev-actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	.ev-detail-row td {
		background: var(--bg-1);
	}
	.ev-detail {
		padding: 6px 4px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ev-detail-meta {
		color: var(--text-dim);
		font-size: 11px;
	}
	.ev-subtable {
		width: 100%;
		max-width: 640px;
		border-collapse: collapse;
		font-size: 12px;
	}
	.ev-subtable th,
	.ev-subtable td {
		border-bottom: 1px solid var(--border-soft);
		padding: 5px 10px;
		text-align: left;
	}
	.ev-insufficient {
		color: var(--yellow);
		font-style: italic;
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
	.ev-none {
		text-align: center;
		opacity: 0.6;
		padding: 18px;
	}
</style>
