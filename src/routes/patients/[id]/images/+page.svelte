<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	const ZOOMS = [0.5, 0.75, 1, 1.5, 2.5];

	interface Pane {
		imageId: number | null;
		zoomIdx: number;
		panX: number;
		panY: number;
	}

	let layout = $state<1 | 2 | 4>(1);
	let active = $state(0);
	let showInfo = $state(false);
	let isFullscreen = $state(false);
	let viewerEl: HTMLDivElement | undefined = $state();

	let panes = $state<Pane[]>(
		Array.from({ length: 4 }, (_, i) => ({
			imageId: data.images[i]?.id ?? null,
			zoomIdx: 2,
			panX: 0,
			panY: 0
		}))
	);

	const activePane = $derived(panes[active]);

	function imageOf(pane: Pane) {
		return pane.imageId == null ? null : (data.images.find((im) => im.id === pane.imageId) ?? null);
	}

	function setLayout(n: 1 | 2 | 4) {
		layout = n;
		if (active >= n) active = 0;
	}

	function loadIntoActive(imageId: number) {
		const p = panes[active];
		p.imageId = imageId;
		p.panX = 0;
		p.panY = 0;
	}

	function stepZoom(pane: Pane, dir: 1 | -1) {
		pane.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, pane.zoomIdx + dir));
	}

	function resetPane(pane: Pane) {
		pane.zoomIdx = 2;
		pane.panX = 0;
		pane.panY = 0;
	}

	function cycleImage(dir: 1 | -1) {
		if (!data.images.length) return;
		const p = panes[active];
		const idx = data.images.findIndex((im) => im.id === p.imageId);
		const next = idx < 0 ? 0 : (idx + dir + data.images.length) % data.images.length;
		p.imageId = data.images[next].id;
		p.panX = 0;
		p.panY = 0;
	}

	// ---------- pan (drag) ----------
	let drag: { pane: number; startX: number; startY: number; baseX: number; baseY: number } | null =
		null;

	function paneDown(e: PointerEvent, i: number) {
		active = i;
		const p = panes[i];
		if (!p.imageId) return;
		drag = { pane: i, startX: e.clientX, startY: e.clientY, baseX: p.panX, baseY: p.panY };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function paneMove(e: PointerEvent) {
		if (!drag) return;
		const p = panes[drag.pane];
		p.panX = drag.baseX + (e.clientX - drag.startX);
		p.panY = drag.baseY + (e.clientY - drag.startY);
	}

	function paneUp() {
		drag = null;
	}

	function paneWheel(e: WheelEvent, i: number) {
		active = i;
		stepZoom(panes[i], e.deltaY < 0 ? 1 : -1);
	}

	// ---------- fullscreen ----------
	function toggleFullscreen() {
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			viewerEl?.requestFullscreen();
		}
	}

	// ---------- keyboard ----------
	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			e.preventDefault();
			cycleImage(1);
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			e.preventDefault();
			cycleImage(-1);
		} else if (e.key === 'Escape' && document.fullscreenElement) {
			document.exitFullscreen();
		}
	}
</script>

<svelte:head>
	<title>Images — {data.patient.last_name}, {data.patient.first_name} — coDiagnostiX Web</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />
<svelte:document onfullscreenchange={() => (isFullscreen = !!document.fullscreenElement)} />

<header class="appbar">
	<a class="btn ghost" href="/?sel={data.patient.id}"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">
		Image viewer — {data.patient.last_name}, {data.patient.first_name}
	</div>
</header>

<div class="viewer-page">
	<aside class="filmstrip panel">
		<div class="panel-header">Images ({data.images.length})</div>
		<div class="film-list">
			{#each data.images as img (img.id)}
				<button
					class="film-thumb"
					class:selected={activePane.imageId === img.id}
					title={img.name}
					onclick={() => loadIntoActive(img.id)}
				>
					<img src="/api/images/{img.id}" alt={img.name} loading="lazy" draggable="false" />
					<span class="film-name">{img.name}</span>
				</button>
			{:else}
				<div class="muted film-empty">No snapshots for this patient yet.</div>
			{/each}
		</div>
	</aside>

	<div class="viewer-col panel" bind:this={viewerEl}>
		<div class="viewer-toolbar">
			<span class="muted tb-label">Layout</span>
			{#each [1, 2, 4] as const as n (n)}
				<button
					class="btn"
					class:primary={layout === n}
					data-layout={n}
					title="{n} pane{n === 1 ? '' : 's'}"
					onclick={() => setLayout(n)}
				>
					{n}
				</button>
			{/each}
			<span class="tb-sep"></span>
			<button class="btn" title="Zoom out" onclick={() => stepZoom(panes[active], -1)}>
				−
			</button>
			<span class="zoom-label">{Math.round(ZOOMS[activePane.zoomIdx] * 100)}%</span>
			<button class="btn" title="Zoom in" onclick={() => stepZoom(panes[active], 1)}>+</button>
			<button class="btn" title="Reset pan & zoom" onclick={() => resetPane(panes[active])}>
				Reset
			</button>
			<span class="tb-sep"></span>
			<button
				class="btn"
				class:primary={showInfo}
				title="Toggle image info"
				onclick={() => (showInfo = !showInfo)}
			>
				<Icon name="eye" size={14} /> Info
			</button>
			<div class="spacer"></div>
			<button class="btn" title="Toggle fullscreen" onclick={toggleFullscreen}>
				<Icon name="grid" size={14} />
				{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
			</button>
		</div>

		<div class="pane-grid l{layout}">
			{#each panes.slice(0, layout) as pane, i (i)}
				{@const img = imageOf(pane)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="pane"
					class:active={i === active}
					data-pane={i}
					onpointerdown={(e) => paneDown(e, i)}
					onpointermove={paneMove}
					onpointerup={paneUp}
					onpointercancel={paneUp}
					onwheel={(e) => paneWheel(e, i)}
				>
					{#if img}
						<img
							src="/api/images/{img.id}"
							alt={img.name}
							draggable="false"
							style="transform: translate({pane.panX}px, {pane.panY}px) scale({ZOOMS[
								pane.zoomIdx
							]})"
						/>
						{#if showInfo}
							<div class="pane-info">
								<div class="pane-info-name">{img.name}</div>
								<div class="muted">{img.created_at}</div>
								{#if img.case_id != null}
									<a href="/cases/{img.case_id}">Open case {img.case_id}</a>
								{/if}
							</div>
						{/if}
					{:else}
						<div class="pane-empty faint">Click a thumbnail to load an image</div>
					{/if}
				</div>
			{/each}
		</div>
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

	.viewer-page {
		flex: 1;
		display: flex;
		gap: 12px;
		padding: 12px;
		min-height: 0;
	}

	.filmstrip {
		width: 190px;
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.film-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.film-thumb {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		background: var(--bg-1);
		text-align: left;
	}
	.film-thumb:hover {
		border-color: var(--accent-dim);
	}
	.film-thumb.selected {
		border-color: var(--accent-bright);
	}
	.film-thumb img {
		width: 100%;
		height: 90px;
		object-fit: cover;
		background: #000;
		border-radius: 2px;
		pointer-events: none;
	}
	.film-name {
		font-size: 11px;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.film-empty {
		padding: 12px 4px;
		font-size: 12px;
	}

	.viewer-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--bg-1);
	}
	.viewer-col:fullscreen {
		padding: 12px;
	}

	.viewer-toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px;
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.tb-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.tb-sep {
		width: 1px;
		height: 18px;
		background: var(--border-soft);
		margin: 0 4px;
	}
	.zoom-label {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-dim);
		min-width: 38px;
		text-align: center;
	}
	.spacer {
		flex: 1;
	}

	.pane-grid {
		flex: 1;
		display: grid;
		gap: 8px;
		padding: 8px;
		min-height: 0;
	}
	.pane-grid.l1 {
		grid-template-columns: 1fr;
	}
	.pane-grid.l2 {
		grid-template-columns: 1fr 1fr;
	}
	.pane-grid.l4 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	.pane {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
		border: 2px solid var(--border-soft);
		border-radius: var(--radius);
		min-height: 0;
		min-width: 0;
		cursor: grab;
		touch-action: none;
	}
	.pane:active {
		cursor: grabbing;
	}
	.pane.active {
		border-color: var(--accent-bright);
	}
	.pane img {
		max-width: 100%;
		max-height: 100%;
		user-select: none;
		-webkit-user-drag: none;
	}
	.pane-empty {
		font-size: 12px;
		user-select: none;
	}

	.pane-info {
		position: absolute;
		top: 8px;
		left: 8px;
		padding: 6px 10px;
		background: rgba(18, 21, 26, 0.82);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		font-size: 11px;
		pointer-events: none;
		max-width: calc(100% - 16px);
	}
	.pane-info a {
		pointer-events: auto;
	}
	.pane-info-name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
