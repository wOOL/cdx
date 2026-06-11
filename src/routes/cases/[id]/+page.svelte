<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	const stages = [
		{ key: 'data', label: 'Data', icon: 'import' },
		{ key: 'align', label: 'Align', icon: 'rotate' },
		{ key: 'pano', label: 'Panoramic', icon: 'pano' },
		{ key: 'nerve', label: 'Nerve', icon: 'nerve' },
		{ key: 'implant', label: 'Implants', icon: 'implant' },
		{ key: 'sleeve', label: 'Sleeves', icon: 'volume' },
		{ key: 'guide', label: 'Guide', icon: 'guide' },
		{ key: 'report', label: 'Report', icon: 'report' }
	] as const;

	let stage = $state<(typeof stages)[number]['key']>('data');
	let hasVolume = $derived(data.datasets.length > 0);
</script>

<svelte:head>
	<title>{data.patient.last_name}, {data.patient.first_name} — {data.caseData.title}</title>
</svelte:head>

<header class="case-bar">
	<a class="btn ghost" href="/?sel={data.patient.id}" title="Back to patient database">
		<Icon name="back" size={18} />
	</a>
	<div class="case-id">
		<div class="case-patient">
			{data.patient.last_name}, {data.patient.first_name}
			<span class="faint">{data.patient.external_id ? `· ID ${data.patient.external_id}` : ''}</span>
		</div>
		<div class="case-title-row">
			<span class="muted">{data.caseData.title}</span>
			<span class="badge {data.caseData.status}">{data.caseData.status}</span>
		</div>
	</div>

	<nav class="stage-bar">
		{#each stages as s (s.key)}
			<button
				class="tool-btn"
				class:active={stage === s.key}
				disabled={s.key !== 'data' && !hasVolume}
				onclick={() => (stage = s.key)}
			>
				<Icon name={s.icon} size={20} />
				<span>{s.label}</span>
			</button>
		{/each}
	</nav>

	<div class="spacer"></div>
	<div class="plan-chip muted" title="Active plan">{data.plan.name}</div>
</header>

<div class="workspace">
	<aside class="object-tree panel">
		<div class="panel-header">Objects</div>
		<div class="tree">
			<div class="tree-group">
				<div class="tree-group-label">Volume data</div>
				{#each data.datasets as d (d.id)}
					<div class="tree-item">
						<Icon name="volume" size={14} />
						<span>{d.series_description || d.modality || 'CT'} ({d.cols}×{d.rows}×{d.slices})</span>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Models</div>
				{#each data.models as m (m.id)}
					<div class="tree-item"><Icon name="tooth" size={14} /><span>{m.name}</span></div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Implants</div>
				{#each data.implants as im (im.id)}
					<div class="tree-item">
						<Icon name="implant" size={14} />
						<span>{im.tooth ? `${im.tooth} — ` : ''}{im.manufacturer} ⌀{im.diameter}×{im.length}</span>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Nerves</div>
				{#each data.nerves as n (n.id)}
					<div class="tree-item"><Icon name="nerve" size={14} /><span>{n.name}</span></div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Measurements</div>
				{#each data.measurements as m (m.id)}
					<div class="tree-item"><Icon name="ruler" size={14} /><span>{m.label || m.type}</span></div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
		</div>
	</aside>

	<main class="view-area">
		{#if !hasVolume}
			<div class="import-prompt panel">
				<Icon name="import" size={48} />
				<h2>No volume data</h2>
				<p class="muted">
					Import a DICOM dataset (CT / CBCT) to start planning.<br />
					DICOM import will be available here shortly.
				</p>
			</div>
		{:else}
			<div class="view-grid">
				<div class="view panel"><div class="view-label">3D</div></div>
				<div class="view panel"><div class="view-label">Axial</div></div>
				<div class="view panel"><div class="view-label">Panoramic</div></div>
				<div class="view panel"><div class="view-label">Cross section</div></div>
			</div>
		{/if}
	</main>
</div>

<footer class="status-bar">
	<span class="faint">coDiagnostiX Web — planning workspace</span>
	<div class="spacer"></div>
	<span class="faint">{hasVolume ? `${data.datasets.length} dataset(s) loaded` : 'no data'}</span>
</footer>

<style>
	.case-bar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 12px;
		height: 64px;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.case-patient {
		font-weight: 600;
	}
	.case-title-row {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	.stage-bar {
		display: flex;
		gap: 2px;
		margin-left: 24px;
		border-left: 1px solid var(--border-soft);
		padding-left: 24px;
	}
	.spacer {
		flex: 1;
	}
	.plan-chip {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 3px 12px;
		font-size: 12px;
	}

	.workspace {
		flex: 1;
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 8px;
		padding: 8px;
		min-height: 0;
	}
	.object-tree {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.tree {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}
	.tree-group {
		margin-bottom: 10px;
	}
	.tree-group-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-faint);
		padding: 4px 6px;
	}
	.tree-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: var(--radius);
		font-size: 12px;
	}
	.tree-item:hover {
		background: var(--bg-3);
	}
	.tree-empty {
		padding: 2px 8px;
		font-size: 11px;
		color: var(--text-faint);
		font-style: italic;
	}

	.view-area {
		min-height: 0;
		display: flex;
	}
	.import-prompt {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--text-dim);
		text-align: center;
	}
	.view-grid {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 8px;
	}
	.view {
		position: relative;
		background: #000;
		overflow: hidden;
	}
	.view-label {
		position: absolute;
		top: 6px;
		left: 8px;
		font-size: 11px;
		color: var(--accent-bright);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		z-index: 2;
	}

	.status-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 26px;
		padding: 0 12px;
		background: var(--bg-0);
		border-top: 1px solid var(--border-soft);
		font-size: 11px;
		flex: none;
	}
</style>
