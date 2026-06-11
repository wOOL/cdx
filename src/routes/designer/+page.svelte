<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	// ------------- line identity -------------
	let name = $state('My Implant');
	let manufacturer = $state('User');
	let threadPitch = $state(0.8); // cosmetic only

	// ------------- profile segments (apex → collar) -------------
	interface Seg {
		label: string;
		height: number;
		lowerD: number;
		upperD: number;
	}
	const SEG_MIN = 2,
		SEG_MAX = 5;
	let segments = $state<Seg[]>([
		{ label: 'Apex taper', height: 3, lowerD: 1.6, upperD: 3.8 },
		{ label: 'Body', height: 6, lowerD: 3.8, upperD: 4.1 },
		{ label: 'Collar', height: 1, lowerD: 4.1, upperD: 4.1 }
	]);
	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

	function addSegment() {
		if (segments.length >= SEG_MAX) return;
		const last = segments[segments.length - 1];
		segments.push({ label: 'Segment', height: 2, lowerD: last.upperD, upperD: last.upperD });
	}
	function removeSegment(i: number) {
		if (segments.length <= SEG_MIN) return;
		segments.splice(i, 1);
	}

	// ------------- diameters / lengths chips -------------
	let diameters = $state<number[]>([3.8, 4.1, 4.8]);
	let lengths = $state<number[]>([8, 10, 12, 14]);
	let dInput = $state('');
	let lInput = $state('');

	function addChip(list: number[], raw: string): string {
		const v = Number(raw.replace(',', '.'));
		if (!Number.isFinite(v) || v <= 0 || v > 100) return raw;
		if (!list.includes(v)) {
			list.push(v);
			list.sort((a, b) => a - b);
		}
		return '';
	}
	function chipKey(e: KeyboardEvent, which: 'd' | 'l') {
		if (e.key !== 'Enter' && e.key !== ',') return;
		e.preventDefault();
		if (which === 'd') dInput = addChip(diameters, dInput);
		else lInput = addChip(lengths, lInput);
	}

	// ------------- optional STL reference -------------
	let stlInput = $state<HTMLInputElement | null>(null);
	let stlPath = $state('');
	let stlBusy = $state(false);

	async function uploadStl() {
		const f = stlInput?.files?.[0];
		if (!f) return;
		stlBusy = true;
		errorMsg = '';
		const form = new FormData();
		form.set('file', f);
		try {
			const r = await fetch('/api/designer-upload', { method: 'POST', body: form });
			const body = await r.json().catch(() => ({}));
			if (!r.ok) errorMsg = body?.message ?? `STL upload failed (${r.status})`;
			else stlPath = body.path;
		} catch {
			errorMsg = 'STL upload failed — network error.';
		}
		stlBusy = false;
	}

	// ------------- derived line + publish -------------
	const maxD = $derived(segments.reduce((d, s) => Math.max(d, s.lowerD, s.upperD), 0));
	const totalH = $derived(segments.reduce((s, x) => s + x.height, 0));
	/** apex taper as fraction of diameter (ImplantLine.taper) */
	const taper = $derived(maxD > 0 ? clamp(1 - segments[0].lowerD / maxD, 0, 1) : 0);
	const techInfo = $derived(
		`user-designed; locked; thread pitch ${threadPitch.toFixed(2)} mm` +
			(stlPath ? `; STL: ${stlPath} (reference only — planning glyph stays parametric)` : '')
	);
	const valid = $derived(
		name.trim().length > 0 &&
			manufacturer.trim().length > 0 &&
			diameters.length > 0 &&
			lengths.length > 0 &&
			segments.length >= SEG_MIN &&
			segments.length <= SEG_MAX &&
			segments.every((s) => s.height > 0 && s.lowerD > 0 && s.upperD > 0)
	);

	let busy = $state(false);
	let errorMsg = $state('');
	let published = $state<{ name: string; version: string } | null>(null);

	async function publish() {
		if (!valid || busy) return;
		busy = true;
		errorMsg = '';
		const line = {
			manufacturer: manufacturer.trim(),
			line: name.trim(),
			diameters,
			lengths,
			taper,
			custom: true,
			kind: 'implant',
			region: 'global',
			techInfo,
			article: 'USR-DSN'
		};
		try {
			const r = await fetch('/api/catalogs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Designer', version: String(Date.now()), lines: [line] })
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) errorMsg = body?.message ?? `Publish failed (${r.status})`;
			else {
				published = { name: body.catalog.name, version: body.catalog.version };
				await invalidateAll();
			}
		} catch {
			errorMsg = 'Publish failed — network error.';
		}
		busy = false;
	}

	// ------------- live SVG profile -------------
	const W = 240,
		H = 340;
	const cx = W / 2,
		baseY = H - 30;
	const pxPerMM = $derived(Math.min(22, 270 / Math.max(totalH, 6)));

	const bottoms = $derived.by(() => {
		const out: number[] = [];
		let acc = 0;
		for (const s of segments) {
			out.push(acc);
			acc += s.height;
		}
		return out;
	});
	function px(mmX: number, mmY: number) {
		return { x: cx + mmX * pxPerMM, y: baseY - mmY * pxPerMM };
	}
	/** cosmetic thread lines across the body segments */
	const threadLines = $derived.by(() => {
		const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
		if (threadPitch <= 0 || !segments.length) return out;
		let i = 0;
		for (
			let y = segments[0].height;
			y < totalH - 0.5 && out.length < 60;
			y += Math.max(threadPitch, 0.2)
		) {
			while (i < segments.length - 1 && bottoms[i] + segments[i].height < y) i++;
			const s = segments[i];
			const f = clamp((y - bottoms[i]) / s.height, 0, 1);
			const d = s.lowerD + (s.upperD - s.lowerD) * f;
			const a = px(-d / 2, y);
			const b = px(d / 2, y - threadPitch * 0.45);
			out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
		}
		return out;
	});
</script>

<svelte:head>
	<title>Implant designer — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Implant designer</div>
</header>

<div class="dsn-wrap">
	<div class="panel">
		<div class="panel-header">Custom implant line</div>
		<div class="dsn-body">
			<div class="dsn-left">
				<div class="dsn-grid">
					<label class="dsn-field">
						Line name
						<input bind:value={name} maxlength="120" />
					</label>
					<label class="dsn-field">
						Manufacturer
						<input bind:value={manufacturer} maxlength="80" />
					</label>
					<label class="dsn-field">
						Thread pitch (mm, cosmetic)
						<input
							type="number" min="0.2" max="3" step="0.05" value={threadPitch}
							oninput={(e) => (threadPitch = clamp(Number(e.currentTarget.value) || 0.8, 0.2, 3))}
						/>
					</label>
				</div>

				<div class="dsn-seg-head">
					<span>Profile segments (apex → collar, at reference Ø)</span>
					<button class="btn ghost" disabled={segments.length >= SEG_MAX} onclick={addSegment}>
						+ segment
					</button>
				</div>
				<table class="dsn-table">
					<thead>
						<tr><th>Segment</th><th>Height</th><th>Lower Ø</th><th>Upper Ø</th><th></th></tr>
					</thead>
					<tbody>
						{#each segments as s, i (i)}
							<tr>
								<td><input class="dsn-label" bind:value={s.label} maxlength="20" /></td>
								<td>
									<input
										type="number" min="0.5" max="20" step="0.5" value={s.height}
										oninput={(e) => (s.height = clamp(Number(e.currentTarget.value) || 0.5, 0.5, 20))}
									/>
								</td>
								<td>
									<input
										type="number" min="0.5" max="9" step="0.1" value={s.lowerD}
										oninput={(e) => (s.lowerD = clamp(Number(e.currentTarget.value) || 0.5, 0.5, 9))}
									/>
								</td>
								<td>
									<input
										type="number" min="0.5" max="9" step="0.1" value={s.upperD}
										oninput={(e) => (s.upperD = clamp(Number(e.currentTarget.value) || 0.5, 0.5, 9))}
									/>
								</td>
								<td>
									<button class="btn ghost" disabled={segments.length <= SEG_MIN} onclick={() => removeSegment(i)}>
										✕
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="dsn-note">Derived apex taper: {(taper * 100).toFixed(0)}% of Ø.</p>

				<div class="dsn-chips-row">
					<div class="dsn-chipset">
						<span class="dsn-chipset-label">Diameters (mm)</span>
						<div class="dsn-chips">
							{#each diameters as d (d)}
								<span class="dsn-chip">
									⌀{d.toFixed(1)}
									<button onclick={() => (diameters = diameters.filter((x) => x !== d))}>×</button>
								</span>
							{/each}
							<input
								placeholder="add ⏎" bind:value={dInput} onkeydown={(e) => chipKey(e, 'd')}
								onblur={() => (dInput = dInput ? addChip(diameters, dInput) : '')}
							/>
						</div>
					</div>
					<div class="dsn-chipset">
						<span class="dsn-chipset-label">Lengths (mm)</span>
						<div class="dsn-chips">
							{#each lengths as l (l)}
								<span class="dsn-chip">
									{l.toFixed(1)}
									<button onclick={() => (lengths = lengths.filter((x) => x !== l))}>×</button>
								</span>
							{/each}
							<input
								placeholder="add ⏎" bind:value={lInput} onkeydown={(e) => chipKey(e, 'l')}
								onblur={() => (lInput = lInput ? addChip(lengths, lInput) : '')}
							/>
						</div>
					</div>
				</div>

				<div class="dsn-stl">
					<span class="dsn-chipset-label">…or STL import (reference geometry)</span>
					<div class="dsn-stl-row">
						<input type="file" accept=".stl" bind:this={stlInput} />
						<button class="btn" disabled={stlBusy} onclick={uploadStl}>
							<Icon name="import" size={14} /> Upload STL
						</button>
					</div>
					{#if stlPath}
						<p class="dsn-ok"><Icon name="check" size={13} /> Stored as {stlPath}</p>
					{/if}
					<p class="dsn-note">
						The STL is stored for reference and linked in the line's tech info only — the
						planning glyph stays parametric (diameter/length/taper).
					</p>
				</div>

				{#if errorMsg}<p class="dsn-err"><Icon name="warning" size={13} /> {errorMsg}</p>{/if}
				{#if published}
					<p class="dsn-ok">
						<Icon name="check" size={13} />
						Published to catalog "{published.name}" v{published.version} —
						<a href="/catalogs">manage catalogs</a>. The line appears in the implant picker with a
						user badge.
					</p>
				{/if}
				<div class="dsn-actions">
					<button class="btn primary" disabled={!valid || busy} onclick={publish}>
						<Icon name="export" size={14} /> Publish to catalog
					</button>
					<span class="dsn-note">
						Published lines are locked — no in-place edit; re-publish as a new version instead.
					</span>
				</div>

				{#if data.catalogs.length}
					<div class="dsn-published">
						<span class="dsn-chipset-label">Published Designer versions</span>
						<ul>
							{#each data.catalogs as c (c.id)}
								<li>
									v{c.version} — {c.count} line{c.count === 1 ? '' : 's'}
									{c.active ? '' : ' (inactive)'}{c.outdated ? ' (outdated)' : ''}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<svg class="dsn-preview" viewBox="0 0 {W} {H}" width={W} height={H}>
				<line x1={cx} y1={baseY + 14} x2={cx} y2={baseY - (totalH + 3) * pxPerMM} class="dsn-axis" />
				{#each segments as s, i (i)}
					{@const b = bottoms[i]}
					{@const p1 = px(-s.lowerD / 2, b)}
					{@const p2 = px(s.lowerD / 2, b)}
					{@const p3 = px(s.upperD / 2, b + s.height)}
					{@const p4 = px(-s.upperD / 2, b + s.height)}
					<polygon points="{p1.x},{p1.y} {p2.x},{p2.y} {p3.x},{p3.y} {p4.x},{p4.y}" class="dsn-seg" />
				{/each}
				{#each threadLines as t, ti (ti)}
					<line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} class="dsn-thread" />
				{/each}
				<text x={cx} y={H - 8} class="dsn-caption">
					{name || 'Unnamed'} — {totalH.toFixed(1)} mm @ ref ⌀{maxD.toFixed(1)}
				</text>
			</svg>
		</div>
	</div>
</div>

<style>
	.dsn-wrap {
		max-width: 980px;
		margin: 18px auto;
		padding: 0 16px;
	}
	.dsn-body {
		padding: 14px 16px;
		display: flex;
		gap: 22px;
	}
	.dsn-left {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}
	.dsn-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 10px;
	}
	.dsn-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}
	.dsn-seg-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		color: var(--text-dim, #9aa4b0);
	}
	.dsn-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.dsn-table th,
	.dsn-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 4px 6px;
		text-align: left;
	}
	.dsn-table input {
		width: 64px;
	}
	.dsn-table input.dsn-label {
		width: 110px;
	}
	.dsn-chips-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.dsn-chipset-label {
		font-size: 11px;
		color: var(--text-dim, #9aa4b0);
	}
	.dsn-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		align-items: center;
		margin-top: 4px;
	}
	.dsn-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 7px;
		border: 1px solid var(--border, #3a414b);
		border-radius: 999px;
		font-size: 12px;
	}
	.dsn-chip button {
		background: none;
		border: none;
		color: var(--text-dim, #9aa4b0);
		cursor: pointer;
		padding: 0 1px;
		font-size: 12px;
	}
	.dsn-chip button:hover {
		color: #e06c6c;
	}
	.dsn-chips input {
		width: 64px;
	}
	.dsn-stl {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.dsn-stl-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.dsn-note {
		margin: 0;
		font-size: 11px;
		color: var(--text-dim, #9aa4b0);
	}
	.dsn-ok {
		margin: 0;
		font-size: 12px;
		color: #5fbf77;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.dsn-ok a {
		color: inherit;
	}
	.dsn-err {
		margin: 0;
		font-size: 12px;
		color: #e06c6c;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.dsn-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.dsn-published ul {
		margin: 4px 0 0;
		padding-left: 18px;
		font-size: 12px;
	}
	.dsn-preview {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border-soft, #2d333b);
		border-radius: 6px;
		flex: none;
		align-self: flex-start;
	}
	.dsn-axis {
		stroke: var(--border, #3a414b);
		stroke-width: 1;
		stroke-dasharray: 2 3;
	}
	.dsn-seg {
		fill: rgba(58, 167, 87, 0.25);
		stroke: #3aa757;
		stroke-width: 1.2;
	}
	.dsn-thread {
		stroke: rgba(58, 167, 87, 0.55);
		stroke-width: 0.8;
	}
	.dsn-caption {
		fill: var(--text-dim, #9aa4b0);
		font-size: 10px;
		text-anchor: middle;
	}
</style>
