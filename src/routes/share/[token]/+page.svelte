<script lang="ts">
	import {
		abutmentLabel,
		drillLength,
		toothLabel,
		type AbutmentSpec,
		type Notation,
		type SleeveSpec
	} from '$lib/implantLibrary';

	let { data } = $props();

	let notation = $derived(
		(data.settings.notation === 'universal' ? 'universal' : 'fdi') as Notation
	);

	function parseJson<T>(s: string): T | null {
		try {
			return s ? (JSON.parse(s) as T) : null;
		} catch {
			return null;
		}
	}
</script>

<svelte:head>
	<title>Shared plan — {data.plan.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="share-shell">
	<article class="share-doc">
		<header>
			<div class="share-badge">READ-ONLY SHARED PLAN</div>
			<h1>{data.plan.name}</h1>
			<div class="muted">
				Patient {data.patientName} · case “{data.caseTitle}”
				{data.plan.approved ? ' · plan approved ✓' : ' · not yet approved'}
				· jaw: {data.plan.jaw}
			</div>
		</header>

		<h2>Implants ({data.implants.length})</h2>
		{#if data.implants.length}
			<table>
				<thead>
					<tr>
						<th>Tooth</th>
						<th>System</th>
						<th>⌀ × L</th>
						<th>Sleeve</th>
						<th>Drill length</th>
						<th>Abutment</th>
					</tr>
				</thead>
				<tbody>
					{#each data.implants as im (im.id)}
						{@const sleeve = parseJson<SleeveSpec>(im.sleeve)}
						{@const abutment = parseJson<AbutmentSpec>(im.abutment)}
						<tr>
							<td><strong>{im.tooth ? toothLabel(im.tooth, notation) : '—'}</strong></td>
							<td>{im.manufacturer} {im.line}</td>
							<td>⌀{im.diameter.toFixed(1)} × {im.length.toFixed(1)} mm</td>
							<td>{sleeve ? `${sleeve.system} ⌀${sleeve.diameter.toFixed(1)}` : '—'}</td>
							<td>{sleeve ? `${drillLength(im.length, sleeve).toFixed(1)} mm` : '—'}</td>
							<td>{abutmentLabel(abutment)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="muted">No implants planned.</p>
		{/if}

		{#if data.nerves.length}
			<h2>Marked nerves</h2>
			<ul>
				{#each data.nerves as n (n.id)}
					<li>{n.name} — ⌀{n.diameter.toFixed(1)} mm, {JSON.parse(n.points || '[]').length} points</li>
				{/each}
			</ul>
		{/if}

		<footer class="muted">
			Shared from coDiagnostiX Web for review purposes. This document is read-only; values must be
			verified by the treating practitioner before surgery.
		</footer>
	</article>
</div>

<style>
	.share-shell {
		flex: 1;
		overflow-y: auto;
		display: grid;
		place-items: start center;
		padding: 32px 16px;
	}
	.share-doc {
		max-width: 760px;
		width: 100%;
		background: var(--bg-2);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 28px 32px;
	}
	.share-badge {
		display: inline-block;
		font-size: 10px;
		letter-spacing: 0.12em;
		color: var(--accent-2);
		border: 1px solid var(--accent-2);
		border-radius: 3px;
		padding: 2px 8px;
		margin-bottom: 10px;
	}
	h1 {
		font-size: 22px;
		margin-bottom: 4px;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		margin: 20px 0 8px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	th,
	td {
		border: 1px solid var(--border-soft);
		padding: 6px 9px;
		text-align: left;
	}
	th {
		background: var(--bg-3);
	}
	footer {
		margin-top: 24px;
		font-size: 11px;
		border-top: 1px solid var(--border-soft);
		padding-top: 10px;
	}
</style>
