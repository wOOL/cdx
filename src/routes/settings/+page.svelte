<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';

	let { data, form } = $props();
	let saved = $derived(page.url.searchParams.get('saved') === '1');

	const TABS = [
		{ key: 'practice', label: 'Practice' },
		{ key: 'planning', label: 'Planning & Safety' },
		{ key: 'views', label: 'Views' },
		{ key: 'common', label: 'Common' },
		{ key: 'printout', label: 'Printout' },
		{ key: 'screenshot', label: 'Screenshots' },
		{ key: 'users', label: 'Users' },
		{ key: 'audit', label: 'Audit log' }
	] as const;
	let tab = $state<string>('practice');
</script>

<svelte:head>
	<title>Settings — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Settings</div>
</header>

<div class="settings-wrap">
	<div class="tab-bar">
		{#each TABS as t (t.key)}
			<button class="tab" class:tab-active={tab === t.key} onclick={() => (tab = t.key)}>
				{t.label}
			</button>
		{/each}
		<span class="tab-links">
			<a class="tab" href="/catalogs">Catalogs ↗</a>
			<a class="tab" href="/sleeves">Sleeves ↗</a>
			<a class="tab" href="/designer">Designer ↗</a>
			<a class="tab" href="/orders">Orders ↗</a>
			<a class="tab" href="/production">Production ↗</a>
			<a class="tab" href="/teams">Teams ↗</a>
			<a class="tab" href="/evaluation">Evaluation ↗</a>
		</span>
	</div>

	<form
		class="panel settings-form"
		method="POST"
		action="?/save"
		enctype="multipart/form-data"
		use:enhance
		class:hidden={tab === 'users' || tab === 'audit'}
	>
		<div class:hidden={tab !== 'practice'}>
			<div class="panel-header">Practice information</div>
			<div class="settings-body">
				<p class="muted">Shown on printed surgical protocols and reports.</p>
				<div class="field-row">
					<div>
						<label for="s-practice">Practice name</label>
						<input id="s-practice" name="practice_name" value={data.settings.practice_name} style="width:100%" />
					</div>
					<div>
						<label for="s-practitioner">Practitioner</label>
						<input id="s-practitioner" name="practitioner" value={data.settings.practitioner} style="width:100%" />
					</div>
				</div>
				<div>
					<label for="s-address">Address</label>
					<textarea id="s-address" name="practice_address" rows="2" style="width:100%">{data.settings.practice_address}</textarea>
				</div>
			</div>
		</div>

		<div class:hidden={tab !== 'planning'}>
			<div class="panel-header">Planning</div>
			<div class="settings-body">
				<div class="field-row">
					<div>
						<label for="s-cross">Cross-section group spacing (mm)</label>
						<input id="s-cross" name="cross_spacing_mm" type="number" min="0.5" max="10" step="0.5" value={data.settings.cross_spacing_mm} style="width:100%" />
					</div>
					<div>
						<label for="s-notation">Dental notation</label>
						<select id="s-notation" name="notation" value={data.settings.notation} style="width:100%">
							<option value="fdi">FDI (two-digit, e.g. 36)</option>
							<option value="universal">Universal (US, 1–32)</option>
						</select>
					</div>
				</div>
			</div>
			<div class="panel-header">Safety distances</div>
			<div class="settings-body">
				<p class="muted">
					Minimum clearances before a warning is raised during implant planning. Distances are
					measured between object surfaces; sleeves are checked against each other as well.
				</p>
				<div class="field-row">
					<div>
						<label class="checkbox-inline" for="s-nerve-on">
							<input id="s-nerve-on" name="nerve_safety_on" type="checkbox" checked={data.settings.nerve_safety_on !== '0'} />
							Warn implant ↔ nerve
						</label>
						<input name="nerve_safety_mm" type="number" step="0.5" min="0" max="10" value={data.settings.nerve_safety_mm} style="width:100%" aria-label="Implant to nerve distance in mm" />
					</div>
					<div>
						<label class="checkbox-inline" for="s-implant-on">
							<input id="s-implant-on" name="implant_safety_on" type="checkbox" checked={data.settings.implant_safety_on !== '0'} />
							Warn implant ↔ implant
						</label>
						<input name="implant_safety_mm" type="number" step="0.5" min="0" max="10" value={data.settings.implant_safety_mm} style="width:100%" aria-label="Implant to implant distance in mm" />
					</div>
				</div>
			</div>
		</div>

		<div class:hidden={tab !== 'views'}>
			<div class="panel-header">Views</div>
			<div class="settings-body">
				<label class="checkbox-inline" for="s-smooth">
					<input id="s-smooth" name="smooth_transitions" type="checkbox" checked={data.settings.smooth_transitions !== '0'} />
					Smooth animated view transitions (zoom, maximize)
				</label>
				<div class="field-row">
					<div>
						<label for="s-ann-color">Annotation color (2D views)</label>
						<input id="s-ann-color" name="annotation_color" type="color" value={data.settings.annotation_color} />
					</div>
					<div>
						<label for="s-label-size">Measurement &amp; annotation text size (px)</label>
						<input id="s-label-size" name="label_size" type="number" min="8" max="20" value={data.settings.label_size} style="width:100%" />
					</div>
					<div>
						<label for="s-meas-color">Measurement line color</label>
						<input id="s-meas-color" name="measure_color" type="color" value={data.settings.measure_color} />
					</div>
					<div>
						<label for="s-line-scale">Overlay line thickness (for presentations)</label>
						<select id="s-line-scale" name="line_scale" value={data.settings.line_scale} style="width:100%">
							<option value="1">Normal</option>
							<option value="1.25">Thicker (1.25×)</option>
							<option value="1.5">Thick (1.5×)</option>
							<option value="2">Presentation (2×)</option>
						</select>
					</div>
					<div>
						<label for="s-imp-color">Default implant color (empty = automatic palette)</label>
						<input id="s-imp-color" name="implant_color_default" type="color" value={data.settings.implant_color_default || '#3aa757'} />
					</div>
					<div>
						<label for="s-axis-mm">Implant axis extension (mm)</label>
						<input id="s-axis-mm" name="implant_axis_mm" type="number" min="0" max="30" value={data.settings.implant_axis_mm} style="width:100%" />
					</div>
				</div>
			</div>
		</div>

		<div class:hidden={tab !== 'common'}>
			<div class="panel-header">Common</div>
			<div class="settings-body">
				<div class="field-row">
					<div>
						<label for="s-dec">Measurement decimal places</label>
						<select id="s-dec" name="measure_decimals" value={data.settings.measure_decimals} style="width:100%">
							<option value="0">0</option>
							<option value="1">1</option>
							<option value="2">2</option>
							<option value="3">3</option>
						</select>
					</div>
					<div>
						<label for="s-backup-days">Suggest backup after case unchanged for (days)</label>
						<input id="s-backup-days" name="backup_days" type="number" min="0" max="365" value={data.settings.backup_days} style="width:100%" />
					</div>
					<div>
						<label for="s-backup-check">Backup check frequency</label>
						<select id="s-backup-check" name="backup_check" value={data.settings.backup_check} style="width:100%">
							<option value="daily">Daily</option>
							<option value="weekly">Weekly</option>
							<option value="never">Never</option>
						</select>
					</div>
				</div>
			</div>
		</div>

		<div class:hidden={tab !== 'printout'}>
			<div class="panel-header">Printout</div>
			<div class="settings-body">
				<div class="field-row">
					<div>
						<label for="s-logo">Practice logo (PNG/JPEG/BMP/WebP, shown on printed reports)</label>
						<input id="s-logo" name="logo" type="file" accept="image/png,image/jpeg,image/bmp,image/webp" style="width:100%" />
					</div>
					<div>
						<label class="checkbox-inline" for="s-logo-en">
							<input id="s-logo-en" name="logo_enabled" type="checkbox" checked={data.settings.logo_enabled === '1'} />
							Include logo on reports
						</label>
					</div>
				</div>
				<label class="checkbox-inline" for="s-plan-comment">
					<input id="s-plan-comment" name="plan_comment_on_material" type="checkbox" checked={data.settings.plan_comment_on_material === '1'} />
					Print plan comment on the material list
				</label>
			</div>
		</div>

		<div class:hidden={tab !== 'screenshot'}>
			<div class="panel-header">Screenshots</div>
			<div class="settings-body">
				<div>
					<label for="s-snap">Filename scheme — placeholders: {'{patient} {case} {view} {date}'}</label>
					<input id="s-snap" name="snapshot_scheme" value={data.settings.snapshot_scheme} style="width:100%" />
				</div>
				<div class="field-row">
					<div>
						<label for="s-snap-fmt">Format</label>
						<select id="s-snap-fmt" name="snapshot_format" value={data.settings.snapshot_format} style="width:100%">
							<option value="png">PNG</option>
							<option value="jpeg">JPEG</option>
						</select>
					</div>
					<div>
						<label class="checkbox-inline" for="s-snap-notify">
							<input id="s-snap-notify" name="snapshot_notify" type="checkbox" checked={data.settings.snapshot_notify !== '0'} />
							Show notification after saving
						</label>
					</div>
				</div>
			</div>
		</div>

		<div class="settings-actions">
			{#if saved}<span class="saved-note"><Icon name="check" size={14} /> Saved</span>{/if}
			<button class="btn primary" type="submit">Save settings</button>
		</div>
	</form>

	{#if tab === 'users'}
		<form class="panel settings-form" method="POST" action="?/createUser" use:enhance>
			<div class="panel-header">Users</div>
			<div class="settings-body">
				<ul class="user-list">
					{#each data.users as u (u.id)}
						<li>{u.name || '—'} &lt;{u.email}&gt;</li>
					{/each}
				</ul>
				<p class="muted">Self-registration is closed after the first account; add colleagues here. Tiers and credits are managed on the <a href="/account">account console</a>.</p>
				{#if form?.userError}<div class="form-error">{form.userError}</div>{/if}
				<div class="field-row">
					<div>
						<label for="nu-name">Name</label>
						<input id="nu-name" name="new_name" style="width:100%" />
					</div>
					<div>
						<label for="nu-email">Email</label>
						<input id="nu-email" name="new_email" type="email" style="width:100%" />
					</div>
					<div>
						<label for="nu-pass">Password (min. 8)</label>
						<input id="nu-pass" name="new_password" type="password" minlength="8" style="width:100%" />
					</div>
				</div>
			</div>
			<div class="settings-actions">
				<button class="btn primary" type="submit">Create account</button>
			</div>
		</form>
	{/if}

	{#if tab === 'audit'}
		<div class="panel settings-form">
			<div class="panel-header">Audit log (last 100 events)</div>
			<div class="audit-body">
				{#if data.audit.length}
					<table class="audit-table">
						<thead>
							<tr><th>Time (UTC)</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th></tr>
						</thead>
						<tbody>
							{#each data.audit as a (a.id)}
								<tr>
									<td class="audit-time">{a.created_at}</td>
									<td>{a.user_email}</td>
									<td><span class="audit-action">{a.action}</span></td>
									<td>{a.target}</td>
									<td>{a.detail}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="muted">No audited events yet. Plan approvals, locks, guide exports, shares, deletions and anonymization are recorded here.</p>
				{/if}
			</div>
		</div>
	{/if}
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
	.settings-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
	}
	.tab-links {
		margin-left: auto;
		display: flex;
	}
	.tab-bar {
		display: flex;
		gap: 2px;
		max-width: 760px;
		margin: 0 auto 12px;
		border-bottom: 1px solid var(--border);
	}
	.tab {
		padding: 7px 14px;
		color: var(--text-dim);
		border-radius: var(--radius) var(--radius) 0 0;
		font-size: 12px;
	}
	.tab:hover {
		background: var(--bg-3);
		color: var(--text);
	}
	.tab-active {
		background: var(--bg-2);
		color: var(--accent-bright);
		border: 1px solid var(--border);
		border-bottom-color: var(--bg-2);
		margin-bottom: -1px;
	}
	.settings-form {
		max-width: 760px;
		margin: 0 auto;
	}
	.hidden {
		display: none;
	}
	.settings-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.settings-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-top: 1px solid var(--border-soft);
	}
	.saved-note {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--green);
		font-size: 12px;
	}
	.user-list {
		margin: 0;
		padding-left: 18px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.form-error {
		color: var(--red);
		font-size: 12px;
	}
	.checkbox-inline {
		display: flex;
		align-items: center;
		gap: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: var(--text);
	}
	.audit-body {
		padding: 12px;
		max-height: 460px;
		overflow-y: auto;
	}
	.audit-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
	}
	.audit-table th,
	.audit-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 4px 8px;
		text-align: left;
	}
	.audit-time {
		font-family: var(--mono);
		white-space: nowrap;
	}
	.audit-action {
		color: var(--accent-bright);
		font-family: var(--mono);
	}
</style>
