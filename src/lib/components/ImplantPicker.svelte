<script lang="ts">
	import { onMount } from 'svelte';
	import {
		IMPLANT_LIBRARY,
		REGIONS,
		filterLines,
		lineKey,
		mergeCatalog,
		type ImplantLine,
		type LineKind,
		type Notation
	} from '$lib/implantLibrary';

	let {
		notation,
		favorites,
		onpick,
		onfavorites,
		onclose
	}: {
		notation: Notation;
		favorites: string[];
		onpick: (sel: { line: ImplantLine; diameter: number; length: number }) => void;
		onfavorites: (next: string[]) => void;
		onclose: () => void;
	} = $props();

	// built-in library + active uploaded catalogs (fetched once)
	let lines = $state<ImplantLine[]>(IMPLANT_LIBRARY);
	onMount(async () => {
		try {
			const r = await fetch('/api/catalogs/active');
			if (r.ok) {
				const d = await r.json();
				if (Array.isArray(d.lines) && d.lines.length) lines = mergeCatalog(d.lines);
			}
		} catch {
			// offline — built-in library only
		}
	});

	let q = $state('');
	let manufacturer = $state('');
	let diameter = $state('');
	let length = $state('');
	let kind = $state('');
	let region = $state('');
	let favOnly = $state(false);
	let showOutdated = $state(false);

	const manufacturers = $derived([...new Set(lines.map((l) => l.manufacturer))].sort());
	const diameters = $derived(
		[...new Set(lines.flatMap((l) => l.diameters))].sort((a, b) => a - b)
	);
	const lengths = $derived([...new Set(lines.flatMap((l) => l.lengths))].sort((a, b) => a - b));

	const results = $derived(
		filterLines({
			lines,
			q: q || undefined,
			manufacturer: manufacturer || undefined,
			diameter: diameter ? Number(diameter) : undefined,
			length: length ? Number(length) : undefined,
			kind: (kind || undefined) as LineKind | undefined,
			region: region || undefined,
			favoritesOnly: favOnly,
			favorites,
			outdated: showOutdated ? 'include' : 'exclude'
		})
	);

	// per-card Ø/L selection, keyed by lineKey
	let sel = $state<Record<string, { d: number; l: number }>>({});
	function selFor(line: ImplantLine): { d: number; l: number } {
		const s = sel[lineKey(line)];
		return {
			d: s && line.diameters.includes(s.d) ? s.d : line.diameters[0],
			l: s && line.lengths.includes(s.l) ? s.l : line.lengths[0]
		};
	}

	function toggleFav(line: ImplantLine, e: Event) {
		e.stopPropagation();
		const k = lineKey(line);
		onfavorites(favorites.includes(k) ? favorites.filter((f) => f !== k) : [...favorites, k]);
	}

	function pick(line: ImplantLine) {
		const s = selFor(line);
		onpick({ line, diameter: s.d, length: s.l });
	}

	/** simple profile glyph: implant = tapered cylinder, pin = thin rod, endoDrill = pointed */
	function glyphPoints(line: ImplantLine): string {
		const k = line.kind ?? 'implant';
		if (k === 'pin') return '17,6 23,6 23,10 21,10 21,70 19,74 19,70 19,10 17,10';
		if (k === 'endoDrill') return '14,6 26,6 24,30 22,52 20,74 18,52 16,30';
		const half = 13;
		const apex = half * (1 - Math.min(1, line.taper));
		return `${20 - half},8 ${20 + half},8 ${20 + apex},66 20,74 ${20 - apex},66`;
	}
</script>

<div class="ip-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="ip-dialog panel">
		<div class="dialog-title">
			Choose implant
			<span class="ip-note">Notation: {notation === 'fdi' ? 'FDI' : 'Universal'} · pins default to position XX</span>
		</div>

		<div class="ip-filters">
			<input class="ip-search" type="search" placeholder="Quick search — manufacturer, line, article…" bind:value={q} />
			<select bind:value={manufacturer} title="Manufacturer">
				<option value="">All manufacturers</option>
				{#each manufacturers as m (m)}<option value={m}>{m}</option>{/each}
			</select>
			<select bind:value={diameter} title="Diameter">
				<option value="">Any ⌀</option>
				{#each diameters as d (d)}<option value={String(d)}>⌀ {d.toFixed(1)}</option>{/each}
			</select>
			<select bind:value={length} title="Length">
				<option value="">Any length</option>
				{#each lengths as l (l)}<option value={String(l)}>{l.toFixed(1)} mm</option>{/each}
			</select>
			<select bind:value={kind} title="Kind">
				<option value="">All kinds</option>
				<option value="implant">Implants</option>
				<option value="pin">Fixation pins</option>
				<option value="endoDrill">Endo drills</option>
			</select>
			<select bind:value={region} title="Region">
				<option value="">All regions</option>
				{#each REGIONS as r (r)}<option value={r}>{r}</option>{/each}
			</select>
			<label class="ip-toggle" title="Show favorites only">
				<input type="checkbox" bind:checked={favOnly} /> ★ Favorites
			</label>
			<label class="ip-toggle" title="Include outdated catalog lines">
				<input type="checkbox" bind:checked={showOutdated} /> Outdated
			</label>
		</div>

		<div class="ip-grid">
			{#each results as line (lineKey(line))}
				{@const s = selFor(line)}
				{@const fav = favorites.includes(lineKey(line))}
				<div
					class="ip-card"
					class:outdated={line.outdated}
					role="button"
					tabindex="0"
					title="Add {line.line} ⌀{s.d.toFixed(1)} × {s.l.toFixed(1)} mm"
					onclick={() => pick(line)}
					onkeydown={(e) => e.key === 'Enter' && pick(line)}
				>
					<svg class="ip-glyph" viewBox="0 0 40 80" aria-hidden="true">
						<polygon points={glyphPoints(line)} />
						{#if (line.kind ?? 'implant') === 'implant'}
							{#each [20, 32, 44, 56] as y (y)}<line x1="8" y1={y} x2="32" y2={y} />{/each}
						{/if}
					</svg>
					<div class="ip-card-main">
						<div class="ip-card-name">
							<span class="ip-manu">{line.manufacturer}</span>
							{line.line}
						</div>
						<div class="ip-dims">
							<select
								value={String(s.d)}
								onclick={(e) => e.stopPropagation()}
								onchange={(e) => (sel[lineKey(line)] = { ...selFor(line), d: Number(e.currentTarget.value) })}
							>
								{#each line.diameters as d (d)}<option value={String(d)}>⌀ {d.toFixed(1)}</option>{/each}
							</select>
							×
							<select
								value={String(s.l)}
								onclick={(e) => e.stopPropagation()}
								onchange={(e) => (sel[lineKey(line)] = { ...selFor(line), l: Number(e.currentTarget.value) })}
							>
								{#each line.lengths as l (l)}<option value={String(l)}>{l.toFixed(1)} mm</option>{/each}
							</select>
						</div>
						<div class="ip-badges">
							<button
								class="ip-badge ip-star"
								class:on={fav}
								title={fav ? 'Remove from favorites' : 'Add to favorites'}
								onclick={(e) => toggleFav(line, e)}
							>
								{fav ? '★' : '☆'}
							</button>
							<span class="ip-badge" title="Region availability">🌐 {line.region ?? 'global'}</span>
							{#if line.techInfo}
								{#if line.docUrl}
									<a
										class="ip-badge"
										href={line.docUrl}
										target="_blank"
										rel="noopener noreferrer"
										title={line.techInfo}
										onclick={(e) => e.stopPropagation()}
									>⚙</a>
								{:else}
									<span class="ip-badge" title={line.techInfo}>⚙</span>
								{/if}
							{/if}
							{#if line.manufacturer === 'Custom' || line.custom}
								<span class="ip-badge ip-user" title="User-defined / uploaded catalog line">user</span>
							{/if}
							{#if line.outdated}<span class="ip-badge ip-old" title="Outdated catalog line">outdated</span>{/if}
						</div>
					</div>
				</div>
			{:else}
				<div class="ip-empty">No implant lines match the current filter.</div>
			{/each}
		</div>

		<div class="dialog-actions">
			<span class="ip-count">{results.length} line{results.length === 1 ? '' : 's'}</span>
			<button class="btn" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.ip-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.ip-dialog {
		width: min(880px, 94vw);
		max-height: 86vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
	}
	.ip-note {
		float: right;
		font-size: 11px;
		font-weight: normal;
		opacity: 0.7;
	}
	.ip-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		padding: 10px 14px;
		border-bottom: 1px solid var(--border-soft);
	}
	.ip-search {
		flex: 1 1 220px;
		min-width: 180px;
	}
	.ip-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}
	.ip-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
		padding: 12px 14px;
		overflow-y: auto;
		min-height: 160px;
	}
	.ip-card {
		display: flex;
		gap: 10px;
		padding: 10px;
		border: 1px solid var(--border-soft);
		border-radius: 6px;
		cursor: pointer;
		background: rgba(255, 255, 255, 0.02);
	}
	.ip-card:hover,
	.ip-card:focus-visible {
		border-color: var(--accent, #2f9ec7);
		background: rgba(47, 158, 199, 0.08);
		outline: none;
	}
	.ip-card.outdated {
		border-color: rgba(212, 86, 106, 0.6);
	}
	.ip-card.outdated .ip-card-name {
		color: #d4566a;
		text-decoration: line-through;
	}
	.ip-glyph {
		width: 34px;
		height: 68px;
		flex: none;
	}
	.ip-glyph polygon {
		fill: rgba(140, 170, 190, 0.35);
		stroke: var(--text, #cfd8dc);
		stroke-width: 1.2;
		stroke-linejoin: round;
	}
	.ip-glyph line {
		stroke: rgba(140, 170, 190, 0.5);
		stroke-width: 1;
	}
	.ip-card-main {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}
	.ip-card-name {
		font-size: 12px;
		line-height: 1.3;
	}
	.ip-manu {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.65;
	}
	.ip-dims {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
	}
	.ip-dims select {
		font-size: 11px;
		max-width: 92px;
	}
	.ip-badges {
		display: flex;
		gap: 5px;
		align-items: center;
		flex-wrap: wrap;
	}
	.ip-badge {
		font-size: 10px;
		line-height: 1;
		padding: 3px 5px;
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		background: none;
		color: inherit;
		cursor: default;
		text-decoration: none;
	}
	a.ip-badge,
	button.ip-badge {
		cursor: pointer;
	}
	.ip-star.on {
		color: #f0c419;
		border-color: #f0c419;
	}
	.ip-user {
		color: #7a8cf0;
		border-color: #7a8cf0;
	}
	.ip-old {
		color: #d4566a;
		border-color: #d4566a;
	}
	.ip-empty {
		grid-column: 1 / -1;
		padding: 24px;
		text-align: center;
		font-size: 12px;
		opacity: 0.7;
	}
	.ip-count {
		margin-right: auto;
		font-size: 11px;
		opacity: 0.7;
		align-self: center;
	}
</style>
