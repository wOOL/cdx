<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import PanoView from '$lib/components/viewers/PanoView.svelte';
	import VolumeView from '$lib/components/viewers/VolumeView.svelte';
	import { PlanningState } from '$lib/client/planning.svelte';
	import { drawPanoOverlay } from '$lib/client/planTools';
	import ReportCross from '$lib/components/viewers/ReportCross.svelte';
	import {
		drillLength,
		drillSequence,
		toothLabel,
		type Notation,
		type SleeveSpec
	} from '$lib/implantLibrary';

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
</script>

<svelte:head>
	<title>Surgical protocol — {data.patient.last_name}, {data.patient.first_name}</title>
</svelte:head>

<div class="report-shell">
	<div class="report-toolbar no-print">
		<a class="btn" href="/cases/{data.caseData.id}"><Icon name="back" size={14} /> Back to planning</a>
		<div class="spacer"></div>
		<button class="btn primary" onclick={() => window.print()}>
			<Icon name="report" size={14} /> Print / PDF
		</button>
	</div>

	<article class="report">
		<header class="report-head">
			<div>
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
			<section>
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

		<section>
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
			<section>
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
										<td>{drillLength(im.length, sleeve).toFixed(1)} mm</td>
									</tr>
								{/each}
								<tr>
									<td>{drillSequence(sleeve, im.diameter).length + 1}</td>
									<td><strong>Implant insertion</strong></td>
									<td>⌀{im.diameter.toFixed(1)} mm</td>
									<td>—</td>
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
			<section class="warnings">
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
			<section>
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
			<section>
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
			<section>
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

<style>
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
