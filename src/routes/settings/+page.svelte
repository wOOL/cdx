<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	let saved = $derived(page.url.searchParams.get('saved') === '1');
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
	<form class="panel settings-form" method="POST" action="?/save" use:enhance>
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

		<div class="panel-header">Planning</div>
		<div class="settings-body">
			<div class="field-row">
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
			<p class="muted">Minimum clearances before a warning is raised during implant planning.</p>
			<div class="field-row">
				<div>
					<label for="s-nerve">Implant ↔ nerve (mm)</label>
					<input id="s-nerve" name="nerve_safety_mm" type="number" step="0.5" min="0.5" max="5" value={data.settings.nerve_safety_mm} style="width:100%" />
				</div>
				<div>
					<label for="s-implant">Implant ↔ implant (mm)</label>
					<input id="s-implant" name="implant_safety_mm" type="number" step="0.5" min="0.5" max="6" value={data.settings.implant_safety_mm} style="width:100%" />
				</div>
			</div>
		</div>

		<div class="settings-actions">
			{#if saved}<span class="saved-note"><Icon name="check" size={14} /> Saved</span>{/if}
			<button class="btn primary" type="submit">Save settings</button>
		</div>
	</form>
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
	.settings-form {
		max-width: 640px;
		margin: 0 auto;
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
</style>
