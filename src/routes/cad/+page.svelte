<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	let frame: HTMLIFrameElement | undefined = $state();
	let bridgeReady = $state(false);
	let status = $state('Loading CAD workstation…');
	let busy = $state(false);
	let designName = $state('CAD design');

	function post(msg: Record<string, unknown>) {
		frame?.contentWindow?.postMessage(msg, window.location.origin);
	}

	function onMessage(e: MessageEvent) {
		if (e.origin !== window.location.origin) return;
		const msg = e.data as { type?: string; url?: string; name?: string; bytes?: ArrayBuffer; reason?: string };
		if (msg?.type === 'cdx-cad-ready') {
			bridgeReady = true;
			status = 'CAD ready';
		} else if (msg?.type === 'cdx-loaded') {
			busy = false;
			status = 'Model loaded into the CAD document';
		} else if (msg?.type === 'cdx-export-failed') {
			busy = false;
			status = `Export failed: ${msg.reason ?? 'unknown'}`;
		} else if (msg?.type === 'cdx-design' && msg.bytes) {
			void ingestDesign(msg.name ?? designName, msg.bytes);
		}
	}

	function openModel(m: { id: number; name: string }) {
		if (!bridgeReady) return;
		busy = true;
		status = `Loading "${m.name}"…`;
		const safe = m.name.replace(/[^\w\-. ]+/g, '_') || 'model';
		post({ type: 'cdx-load', url: `/api/models/${m.id}/cad/${encodeURIComponent(safe)}.stl` });
	}

	function requestDesign() {
		if (!bridgeReady) return;
		busy = true;
		status = 'Exporting design from CAD…';
		post({ type: 'cdx-export' });
	}

	async function ingestDesign(name: string, bytes: ArrayBuffer) {
		try {
			const form = new FormData();
			form.append('file', new File([bytes], `${designName || name}.stl`), `${designName || name}.stl`);
			form.append('kind', 'waxup');
			form.append('name', `${designName || name} (CAD)`);
			const res = await fetch(`/api/cases/${data.caseId}/models`, { method: 'POST', body: form });
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				status = `Attach failed: ${b?.message ?? res.status}`;
				return;
			}
			status = `Design attached to the case as "${designName || name} (CAD)"`;
			await invalidateAll();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>CAD workstation — coDiagnostiX Web</title>
</svelte:head>

<svelte:window onmessage={onMessage} />

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">CAD workstation — Chili3D</div>
	<div class="spacer"></div>
	<span class="agpl-note">
		Embedded <a href="https://github.com/xiangechen/chili3d" target="_blank" rel="noopener noreferrer">Chili3D</a>
		(AGPL-3.0) — <a href="/cad/source" title="Corresponding source of the embedded version">source</a>
	</span>
</header>

<div class="cad-layout">
	<aside class="cad-side panel">
		<div class="panel-header">Case</div>
		<div class="side-body">
			<select
				value={data.caseId}
				onchange={(e) => goto(`/cad?case=${e.currentTarget.value}`, { invalidateAll: true })}
				style="width:100%"
			>
				{#each data.cases as c (c.id)}
					<option value={c.id}>{c.patient} — {c.title}</option>
				{/each}
			</select>

			<div class="panel-header inner">Send to CAD</div>
			{#each data.models as m (m.id)}
				<button class="model-row" disabled={!bridgeReady || busy} onclick={() => openModel(m)}>
					<Icon name="volume" size={14} />
					<span class="model-name">{m.name}</span>
					<span class="faint">{m.kind}</span>
				</button>
			{:else}
				<p class="muted">No mesh models on this case yet.</p>
			{/each}

			<div class="panel-header inner">Return design</div>
			<label for="design-name">Design name</label>
			<input id="design-name" bind:value={designName} style="width:100%" />
			<button class="btn primary" disabled={!bridgeReady || busy} onclick={requestDesign} style="width:100%">
				<Icon name="import" size={14} /> Attach CAD design to case
			</button>
			<p class="faint">
				Exports every visible body of the CAD document as STL and attaches it to the selected
				case as a wax-up model (audited, revision-named).
			</p>

			<div class="status" class:ok={bridgeReady}>{status}</div>
		</div>
	</aside>

	<main class="cad-main panel">
		<iframe
			bind:this={frame}
			src="/cad-app/index.html"
			title="Chili3D CAD workstation"
			class="cad-frame"
		></iframe>
	</main>
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
	.agpl-note {
		font-size: 11px;
		color: var(--text-dim);
	}
	.cad-layout {
		flex: 1;
		display: flex;
		gap: 12px;
		padding: 12px;
		overflow: hidden;
	}
	.cad-side {
		width: 280px;
		flex: none;
		overflow-y: auto;
	}
	.side-body {
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.panel-header.inner {
		margin: 8px -10px 0;
	}
	.model-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 8px;
		border-radius: var(--radius);
		border: 1px solid var(--border-soft);
		background: var(--bg-1);
		text-align: left;
	}
	.model-row:hover:not(:disabled) {
		background: var(--bg-3);
		border-color: var(--accent-dim);
	}
	.model-row:disabled {
		opacity: 0.5;
	}
	.model-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.status {
		margin-top: 8px;
		padding: 7px 9px;
		border-radius: var(--radius);
		background: var(--bg-1);
		border: 1px solid var(--border-soft);
		font-size: 12px;
		color: var(--text-dim);
	}
	.status.ok {
		border-color: var(--accent-dim);
		color: var(--text);
	}
	.cad-main {
		flex: 1;
		overflow: hidden;
	}
	.cad-frame {
		width: 100%;
		height: 100%;
		border: none;
		background: #fff;
	}
</style>
