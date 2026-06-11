<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import PanoView from '$lib/components/viewers/PanoView.svelte';
	import VolumeView from '$lib/components/viewers/VolumeView.svelte';
	import { PlanningState } from '$lib/client/planning.svelte';
	import { drawPanoOverlay } from '$lib/client/planTools';
	import ReportCross from '$lib/components/viewers/ReportCross.svelte';
	import {
		abutmentLabel,
		boneClassLabel,
		drillLength,
		drillSequence,
		toothLabel,
		type AbutmentSpec,
		type Notation,
		type SleeveSpec
	} from '$lib/implantLibrary';

	function parseAbutment(s: string): AbutmentSpec | null {
		try {
			return s ? JSON.parse(s) : null;
		} catch {
			return null;
		}
	}

	let { data } = $props();

	let notation = $derived(
		(data.settings.notation === 'universal' ? 'universal' : 'fdi') as Notation
	);

	let ps = $derived(
		data.datasets[0]
			? new PlanningState(data.datasets[0], data.plan, data.nerves, data.implants, data.models)
			: null
	);

	function parseSleeve(s: string): SleeveSpec | null {
		try {
			return s ? JSON.parse(s) : null;
		} catch {
			return null;
		}
	}

	const fmtDate = (iso: string) => iso.slice(0, 10);

	// Print All: persisted document-section selection
	const SECTIONS = [
		{ key: 'volume', label: 'Volume data' },
		{ key: 'implants', label: 'Implant list (material list)' },
		{ key: 'drill', label: 'Drill protocol' },
		{ key: 'warnings', label: 'Safety warnings' },
		{ key: 'nerves', label: 'Marked nerves' },
		{ key: 'cross', label: 'Implant cross-sections' },
		{ key: 'pano', label: 'Panoramic overview' }
	] as const;
	let docSel = $state<Record<string, boolean>>({
		volume: true,
		implants: true,
		drill: true,
		warnings: true,
		nerves: true,
		cross: true,
		pano: true
	});
	$effect(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('cdx_print_all') ?? '{}');
			for (const k of Object.keys(docSel)) if (typeof saved[k] === 'boolean') docSel[k] = saved[k];
		} catch {
			// keep defaults
		}
	});
	let showPrintAll = $state(false);
	let showQr = $state(false);

	function printSelection() {
		localStorage.setItem('cdx_print_all', JSON.stringify(docSel));
		showPrintAll = false;
		setTimeout(() => window.print(), 50);
	}

	function downloadProtocolJson() {
		const payload = {
			format: 'cdx-protocol-v1',
			patient: { name: `${data.patient.last_name}, ${data.patient.first_name}` },
			plan: data.plan.name,
			implants: data.implants.map((im) => ({
				tooth: im.tooth,
				article: im.article,
				diameter: im.diameter,
				length: im.length
			}))
		};
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, '\t')], { type: 'application/json' }));
		a.download = 'protocol-export.json';
		a.click();
		URL.revokeObjectURL(a.href);
	}
</script>

<svelte:head>
	<title>Surgical protocol — {data.patient.last_name}, {data.patient.first_name}</title>
</svelte:head>

<div class="report-shell">
	<div class="report-toolbar no-print">
		<a class="btn" href="/cases/{data.caseData.id}"><Icon name="back" size={14} /> Back to planning</a>
		<div class="spacer"></div>
		<button class="btn" onclick={() => (showQr = true)}>QR export</button>
		<button class="btn" onclick={() => (showPrintAll = true)}>
			<Icon name="report" size={14} /> Print all…
		</button>
		<button class="btn primary" onclick={() => window.print()}>
			<Icon name="report" size={14} /> Print / PDF
		</button>
	</div>

	<article class="report">
		<header class="report-head">
			<div>
				{#if data.settings.logo_enabled === '1'}
					<img class="report-logo" src="/api/logo" alt="Practice logo" />
				{/if}
				<h1>Surgical protocol</h1>
				<div class="sub">coDiagnostiX Web — guided surgery plan</div>
				{#if data.settings.practice_name || data.settings.practitioner}
					<div class="practice">
						{#if data.settings.practice_name}<strong>{data.settings.practice_name}</strong><br />{/if}
						{#if data.settings.practitioner}{data.settings.practitioner}<br />{/if}
						{#if data.settings.practice_address}<span class="practice-addr">{data.settings.practice_address}</span>{/if}
					</div>
				{/if}
			</div>
			<table class="meta">
				<tbody>
					<tr><td>Patient</td><td><strong>{data.patient.last_name}, {data.patient.first_name}</strong></td></tr>
					<tr><td>Patient ID</td><td>{data.patient.external_id || '—'}</td></tr>
					<tr><td>Date of birth</td><td>{data.patient.date_of_birth || '—'}</td></tr>
					<tr><td>Case</td><td>{data.caseData.title}</td></tr>
					<tr><td>Plan</td><td>{data.plan.name}{data.plan.approved ? ' (approved)' : ''}</td></tr>
					<tr><td>Generated</td><td>{fmtDate(data.generatedAt)}</td></tr>
				</tbody>
			</table>
		</header>

		{#if data.datasets[0]}
			<section class="sec-volume" class:sec-off={!docSel.volume}>
				<h2>Volume data</h2>
				<table class="data-table">
					<thead>
						<tr><th>Modality</th><th>Dimensions</th><th>Voxel (mm)</th><th>Acquired</th><th>Series</th></tr>
					</thead>
					<tbody>
						{#each data.datasets as d (d.id)}
							<tr>
								<td>{d.modality || 'CT'}</td>
								<td>{d.cols} × {d.rows} × {d.slices}</td>
								<td>{d.spacing_x.toFixed(2)} / {d.spacing_y.toFixed(2)} / {d.spacing_z.toFixed(2)}</td>
								<td>{d.study_date || '—'}</td>
								<td>{d.series_description || '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<section class="sec-implants" class:sec-off={!docSel.implants}>
			<h2>Implants ({data.implants.length})</h2>
			{#if data.implants.length}
				<table class="data-table">
					<thead>
						<tr>
							<th>Tooth</th>
							<th>System</th>
							<th>Implant ⌀ × L</th>
							<th>Sleeve</th>
							<th>Sleeve ⌀ / H</th>
							<th>Offset</th>
							<th>Drill length</th>
							<th>Abutment</th>
							<th>Head position (mm)</th>
						</tr>
					</thead>
					<tbody>
						{#each data.implants as im (im.id)}
							{@const sleeve = parseSleeve(im.sleeve)}
							<tr>
								<td><strong>{im.tooth ? toothLabel(im.tooth, notation) : '—'}</strong></td>
								<td>{im.manufacturer} {im.line}</td>
								<td>⌀{im.diameter.toFixed(1)} × {im.length.toFixed(1)} mm</td>
								<td>{sleeve?.system ?? 'none'}</td>
								<td>{sleeve ? `⌀${sleeve.diameter.toFixed(1)} / ${sleeve.height.toFixed(1)}` : '—'}</td>
								<td>{sleeve ? `${sleeve.offset.toFixed(0)} mm` : '—'}</td>
								<td>{sleeve ? `${drillLength(im.length, sleeve).toFixed(1)} mm` : '—'}</td>
								<td>{abutmentLabel(parseAbutment(im.abutment))}</td>
								<td class="mono">
									{im.x.toFixed(1)}, {im.y.toFixed(1)}, {im.z.toFixed(1)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="empty">No implants planned.</p>
			{/if}
		</section>

		{#if data.implants.some((im) => parseSleeve(im.sleeve))}
			<section class="sec-drill" class:sec-off={!docSel.drill}>
				<h2>Drill protocol</h2>
				{#each data.implants as im (im.id)}
					{@const sleeve = parseSleeve(im.sleeve)}
					{#if sleeve}
						<h3 class="drill-head">
							Tooth {im.tooth ? toothLabel(im.tooth, notation) : '—'} — {im.manufacturer}
							{im.article} · sleeve {sleeve.system} ⌀{sleeve.diameter.toFixed(1)} H{sleeve.height.toFixed(1)}
							offset {sleeve.offset.toFixed(0)} mm
						</h3>
						<table class="data-table drill-table">
							<thead>
								<tr>
									<th>#</th>
									<th>Drill</th>
									<th>⌀</th>
									<th>Handle</th>
									<th>Bone classes</th>
									<th>Guided drill length (stop)</th>
								</tr>
							</thead>
							<tbody>
								{#each drillSequence(sleeve, im.diameter) as step, i (step.name)}
									<tr>
										<td>{i + 1}</td>
										<td>{step.name}</td>
										<td>⌀{step.diameter.toFixed(1)} mm</td>
										<td><span class="handle-dot" style="background:{step.color}"></span> {step.color}</td>
										<td>{boneClassLabel(step)}</td>
										<td>{drillLength(im.length, sleeve).toFixed(1)} mm</td>
									</tr>
								{/each}
								<tr>
									<td>{drillSequence(sleeve, im.diameter).length + 1}</td>
									<td><strong>Implant insertion</strong></td>
									<td>⌀{im.diameter.toFixed(1)} mm</td>
									<td>—</td>
									<td>all</td>
									<td>seat to sleeve stop ({(sleeve.offset + sleeve.height).toFixed(1)} mm above shoulder)</td>
								</tr>
							</tbody>
						</table>
					{/if}
				{/each}
				<p class="faint">
					Drill lengths are measured from the sleeve top. Verify each drill against the physical
					drill kit and use the matching depth stop.
				</p>
			</section>
		{/if}

		{#if ps?.warnings.length}
			<section class="warnings sec-warnings" class:sec-off={!docSel.warnings}>
				<h2>⚠ Safety warnings</h2>
				<ul>
					{#each ps.warnings as w, i (i)}
						<li>
							Implant–{w.kind} clearance {w.distance.toFixed(1)} mm is below the {w.limit.toFixed(1)} mm
							safety distance.
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.nerves.length}
			<section class="sec-nerves" class:sec-off={!docSel.nerves}>
				<h2>Marked nerves</h2>
				<table class="data-table">
					<thead><tr><th>Name</th><th>Diameter</th><th>Points</th></tr></thead>
					<tbody>
						{#each data.nerves as n (n.id)}
							<tr>
								<td>{n.name}</td>
								<td>{n.diameter.toFixed(1)} mm</td>
								<td>{JSON.parse(n.points || '[]').length}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		{#if ps && ps.curve && ps.implants.length}
			<section class="sec-cross" class:sec-off={!docSel.cross}>
				<h2>Implant cross-sections</h2>
				<div class="cross-grid">
					{#each ps.implants as im (im.id)}
						<figure class="cross-fig">
							<ReportCross state={ps} implant={im} />
							<figcaption>
								<strong>{im.tooth ? `Tooth ${toothLabel(im.tooth, notation)}` : 'Implant'}</strong> —
								{im.manufacturer}
								{im.article}
							</figcaption>
						</figure>
					{/each}
				</div>
			</section>
		{/if}

		{#if ps && ps.curve}
			<section class="sec-pano" class:sec-off={!docSel.pano}>
				<h2>Panoramic overview</h2>
				<div class="report-view">
					<PanoView state={ps} overlayDraw={(ctx, t, info) => ps && drawPanoOverlay(ps, ctx, t, info)} />
				</div>
			</section>
		{/if}

		{#if ps}
			<section class="no-print">
				<h2>3D overview</h2>
				<div class="report-view">
					<VolumeView state={ps} />
				</div>
			</section>
		{/if}

		<footer class="report-foot">
			<div class="sign">
				<div class="sign-line"></div>
				<div>Date / signature — surgeon</div>
			</div>
			<div class="sign">
				<div class="sign-line"></div>
				<div>Date / signature — dental lab</div>
			</div>
		</footer>

		<p class="disclaimer">
			Drill lengths are measured from the sleeve top to the implant apex. Verify all values against
			the physical drill kit before surgery. This plan was created with coDiagnostiX Web; final
			responsibility for the treatment lies with the practitioner.
		</p>
	</article>
</div>

{#if showPrintAll}
	<div class="backdrop no-print" role="presentation" onclick={() => (showPrintAll = false)}>
		<div class="panel pa-dialog" role="dialog" onclick={(e) => e.stopPropagation()}>
			<div class="dialog-title">Print all — select documents</div>
			<div class="dialog-body">
				<p class="muted">The selection is remembered for the next batch print.</p>
				{#each SECTIONS as sec (sec.key)}
					<label class="pa-row">
						<input type="checkbox" bind:checked={docSel[sec.key]} />
						{sec.label}
					</label>
				{/each}
			</div>
			<div class="dialog-actions">
				<button class="btn" onclick={() => (showPrintAll = false)}>Cancel</button>
				<button class="btn primary" onclick={printSelection}>Print selection</button>
			</div>
		</div>
	</div>
{/if}

{#if showQr}
	<div class="backdrop no-print" role="presentation" onclick={() => (showQr = false)}>
		<div class="panel pa-dialog" role="dialog" onclick={(e) => e.stopPropagation()}>
			<div class="dialog-title">QR protocol export</div>
			<div class="dialog-body">
				<p>
					Integration stub: surgical-motor systems (e.g. iChiropro) can import the drill
					sequence by scanning a QR code printed on the protocol. This build exports the
					protocol data as JSON; QR rendering hooks in here.
				</p>
				<p class="muted">
					{data.implants.length} implant{data.implants.length === 1 ? '' : 's'} ·
					{data.plan.name}
				</p>
			</div>
			<div class="dialog-actions">
				<button class="btn" onclick={() => (showQr = false)}>Close</button>
				<button class="btn primary" onclick={downloadProtocolJson}>Download protocol JSON</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.sec-off {
		display: none;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.pa-dialog {
		width: 360px;
	}
	.pa-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text);
	}

	.report-shell {
		flex: 1;
		overflow-y: auto;
		background: var(--bg-1);
	}
	.report-toolbar {
		display: flex;
		gap: 8px;
		padding: 10px 16px;
		position: sticky;
		top: 0;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		z-index: 5;
	}
	.spacer {
		flex: 1;
	}
	.report {
		max-width: 900px;
		margin: 20px auto 60px;
		background: #fff;
		color: #1a1d22;
		padding: 36px 44px;
		border-radius: 4px;
		box-shadow: var(--shadow);
	}
	.report-head {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		border-bottom: 2px solid #1a1d22;
		padding-bottom: 14px;
		margin-bottom: 18px;
	}
	h1 {
		font-size: 24px;
		margin: 0;
	}
	.sub {
		color: #667;
		margin-top: 4px;
	}
	.practice {
		margin-top: 12px;
		font-size: 12px;
		color: #334;
	}
	.report-logo {
		max-height: 48px;
		max-width: 220px;
		margin-bottom: 8px;
		display: block;
	}
	.practice-addr {
		white-space: pre-line;
		color: #667;
	}
	h2 {
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 22px 0 8px;
		color: #334;
	}
	.meta td {
		padding: 1px 8px;
		font-size: 12px;
	}
	.meta td:first-child {
		color: #667;
		text-align: right;
	}
	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.data-table th,
	.data-table td {
		border: 1px solid #ccd;
		padding: 5px 8px;
		text-align: left;
	}
	.data-table th {
		background: #eef1f5;
		font-weight: 600;
	}
	.mono {
		font-family: var(--mono);
		font-size: 11px;
	}
	.drill-head {
		font-size: 12px;
		margin: 12px 0 4px;
		color: #223;
	}
	.drill-table {
		margin-bottom: 6px;
	}
	.handle-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 1px solid #889;
		vertical-align: -1px;
	}
	.empty {
		color: #889;
	}
	.warnings {
		border: 1px solid #d05050;
		background: #fdf0f0;
		padding: 4px 16px 10px;
		border-radius: 4px;
		margin-top: 16px;
	}
	.warnings h2 {
		color: #b03030;
	}
	.report-view {
		height: 300px;
		border: 1px solid #ccd;
		border-radius: 3px;
		overflow: hidden;
		background: #000;
	}
	.cross-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.cross-fig {
		margin: 0;
		border: 1px solid #ccd;
		border-radius: 3px;
		padding: 6px;
	}
	.cross-fig figcaption {
		font-size: 11px;
		margin-top: 4px;
		color: #334;
	}
	.report-foot {
		display: flex;
		gap: 60px;
		margin-top: 48px;
	}
	.sign {
		flex: 1;
		font-size: 11px;
		color: #667;
	}
	.sign-line {
		border-bottom: 1px solid #99a;
		height: 36px;
		margin-bottom: 4px;
	}
	.disclaimer {
		margin-top: 24px;
		font-size: 10px;
		color: #889;
	}

	@media print {
		.no-print {
			display: none !important;
		}
		.report-shell {
			background: #fff;
			overflow: visible;
		}
		.report {
			box-shadow: none;
			margin: 0;
			max-width: none;
			padding: 0;
		}
	}
</style>
