<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import CustomSleeveWizard, {
		type WizardSleeveSystem
	} from '$lib/components/CustomSleeveWizard.svelte';

	let { data } = $props();

	let wizardOpen = $state(false);
	let editing = $state<WizardSleeveSystem | null>(null);
	let status = $state('');
	let printer = $state(''); // '' = default (no per-printer scale)
	let newPrinterName = $state('');
	let newPrinterScale = $state(100); // percent in the UI, stored as factor
	let importInput = $state<HTMLInputElement | null>(null);

	const USED_TITLE = 'System is in use — export, modify, re-import as new';

	async function jsonError(res: Response): Promise<string> {
		try {
			const body = (await res.json()) as { message?: string };
			return body.message ?? `Request failed (${res.status})`;
		} catch {
			return `Request failed (${res.status})`;
		}
	}

	function openNew() {
		editing = null;
		wizardOpen = true;
	}

	function openEdit(sys: WizardSleeveSystem) {
		editing = sys;
		wizardOpen = true;
	}

	async function saveSystem(sys: WizardSleeveSystem) {
		const isEdit = sys.id != null;
		const res = await fetch(isEdit ? `/api/sleeves/${sys.id}` : '/api/sleeves', {
			method: isEdit ? 'PATCH' : 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: sys.name,
				manufacturer: sys.manufacturer,
				notes: sys.notes,
				segments: sys.segments,
				drillOffset: sys.drillOffset
			})
		});
		if (!res.ok) throw new Error(await jsonError(res));
		status = isEdit ? `Updated "${sys.name}"` : `Created "${sys.name}"`;
		await invalidateAll();
	}

	async function removeSystem(sys: { id: number; name: string; used: boolean }) {
		if (sys.used) return;
		if (!confirm(`Delete sleeve system "${sys.name}"?`)) return;
		const res = await fetch(`/api/sleeves/${sys.id}`, { method: 'DELETE' });
		if (!res.ok) {
			status = await jsonError(res);
			return;
		}
		status = `Deleted "${sys.name}"`;
		await invalidateAll();
	}

	async function onImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const parsed = JSON.parse(await file.text()) as
				| { systems?: unknown[] }
				| unknown[];
			const arr = Array.isArray(parsed) ? parsed : (parsed.systems ?? []);
			if (!Array.isArray(arr) || arr.length === 0) {
				status = 'Import file contains no systems';
				return;
			}
			const res = await fetch('/api/sleeves', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ import: arr })
			});
			if (!res.ok) {
				status = await jsonError(res);
				return;
			}
			const body = (await res.json()) as { systems: unknown[] };
			status = `Imported ${body.systems.length} system(s)`;
			await invalidateAll();
		} catch {
			status = 'Could not read import file (expecting the exported JSON)';
		} finally {
			input.value = '';
		}
	}

	async function savePrinters(map: Record<string, number>) {
		const res = await fetch('/api/sleeves?printers=1', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ printers: map })
		});
		if (!res.ok) {
			status = await jsonError(res);
			return;
		}
		await invalidateAll();
	}

	async function addPrinter() {
		const name = newPrinterName.trim();
		const pct = Number(newPrinterScale);
		if (!name) {
			status = 'Printer name is required';
			return;
		}
		if (!Number.isFinite(pct) || pct < 50 || pct > 200) {
			status = 'Printer scale must be 50–200%';
			return;
		}
		await savePrinters({ ...data.printers, [name]: pct / 100 });
		newPrinterName = '';
		newPrinterScale = 100;
	}

	async function removePrinter(name: string) {
		const map = { ...data.printers };
		delete map[name];
		if (printer === name) printer = '';
		await savePrinters(map);
	}

	function calibrationHref(id: number): string {
		return `/api/sleeves/${id}/calibration?scale=100${printer ? `&printer=${encodeURIComponent(printer)}` : ''}`;
	}

	function segmentsSummary(segments: { lowerDiameter: number; upperDiameter: number; height: number }[]): string {
		return segments
			.map((s) => `Ø${s.lowerDiameter}→${s.upperDiameter} × ${s.height}`)
			.join('  +  ');
	}
</script>

<svelte:head>
	<title>Custom sleeve systems — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Custom sleeve systems</div>
</header>

<div class="sleeves-wrap">
	<div class="panel">
		<div class="panel-header">
			Sleeve systems
			<div class="sl-toolbar">
				<label class="sl-printer">
					Printer variant
					<select bind:value={printer} title="Per-printer scale applied to calibration STL bores">
						<option value="">Default (×1.00)</option>
						{#each Object.entries(data.printers) as [name, factor] (name)}
							<option value={name}>{name} (×{factor.toFixed(2)})</option>
						{/each}
					</select>
				</label>
				<a class="btn" href="/api/sleeves?export=1" download>Export all</a>
				<button class="btn" onclick={() => importInput?.click()}>Import…</button>
				<input
					type="file"
					accept="application/json,.json"
					bind:this={importInput}
					onchange={onImportFile}
					style="display:none"
				/>
				<button class="btn primary" onclick={openNew}>New system</button>
			</div>
		</div>
		<div class="sl-body">
			{#if status}
				<div class="sl-status">{status}</div>
			{/if}
			{#if data.systems.length === 0}
				<p class="sl-empty">
					No custom sleeve systems yet. Create one with <strong>New system</strong> or import a
					previously exported JSON file.
				</p>
			{:else}
				<table class="sl-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Manufacturer</th>
							<th>Negative geometry (lower Ø → upper Ø × height, mm)</th>
							<th>Drill offset</th>
							<th></th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each data.systems as sys (sys.id)}
							<tr>
								<td>
									{sys.name}
									{#if sys.used}
										<span class="sl-used" title="Referenced by at least one planned implant">in use</span>
									{/if}
								</td>
								<td>{sys.manufacturer || '—'}</td>
								<td class="sl-segs">{segmentsSummary(sys.segments)}</td>
								<td>{sys.drillOffset.toFixed(1)} mm</td>
								<td>
									<a class="btn" href={calibrationHref(sys.id)} download title="Download a printable calibration plate with bore scales 0.98–1.04">
										Calibration STL
									</a>
								</td>
								<td class="sl-actions">
									<button
										class="btn"
										disabled={sys.used}
										title={sys.used ? USED_TITLE : 'Edit system'}
										onclick={() => openEdit(sys)}
									>
										Edit
									</button>
									<button
										class="btn danger"
										disabled={sys.used}
										title={sys.used ? USED_TITLE : 'Delete system'}
										onclick={() => removeSystem(sys)}
									>
										Delete
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	</div>

	<div class="panel">
		<div class="panel-header">Printer scales (calibration variants)</div>
		<div class="sl-body">
			<p class="sl-muted">
				Print the calibration plate, find the bore the real sleeve fits best, and store that scale
				per printer. The selected printer variant scales all bores of the calibration STL.
			</p>
			{#if Object.keys(data.printers).length > 0}
				<table class="sl-table sl-printers">
					<tbody>
						{#each Object.entries(data.printers) as [name, factor] (name)}
							<tr>
								<td>{name}</td>
								<td>×{factor.toFixed(4)} ({(factor * 100).toFixed(1)}%)</td>
								<td><button class="btn danger" onclick={() => removePrinter(name)}>Remove</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<div class="sl-add-printer">
				<label>
					Name
					<input bind:value={newPrinterName} placeholder="e.g. Form 3B" />
				</label>
				<label>
					Scale (%)
					<input type="number" min="50" max="200" step="0.1" bind:value={newPrinterScale} />
				</label>
				<button class="btn" onclick={addPrinter}>Add printer</button>
			</div>
		</div>
	</div>

	<div class="panel">
		<div class="panel-header">Sleeveless guides</div>
		<div class="sl-body">
			<!-- prettier-ignore -->
			<p class="sl-caution">For sleeveless guides plan an auxiliary (dummy) sleeve to keep the drill path; never drill directly through the guide material — risk of material shavings in the osteotomy.</p>
		</div>
	</div>
</div>

{#if wizardOpen}
	<CustomSleeveWizard
		initial={editing}
		onsave={saveSystem}
		onclose={() => (wizardOpen = false)}
	/>
{/if}

<style>
	.sleeves-wrap {
		max-width: 1100px;
		margin: 18px auto;
		padding: 0 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.sl-toolbar {
		float: right;
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: normal;
	}
	.sl-printer {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}
	.sl-body {
		padding: 12px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sl-status {
		font-size: 12px;
		color: #7fc97f;
	}
	.sl-empty,
	.sl-muted {
		font-size: 12px;
		opacity: 0.8;
		margin: 0;
	}
	.sl-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.sl-table th,
	.sl-table td {
		border-bottom: 1px solid var(--border-soft, #333);
		padding: 6px 8px;
		text-align: left;
		vertical-align: middle;
	}
	.sl-segs {
		font-variant-numeric: tabular-nums;
	}
	.sl-actions {
		white-space: nowrap;
	}
	.sl-actions .btn {
		margin-left: 6px;
	}
	.sl-used {
		display: inline-block;
		margin-left: 8px;
		padding: 1px 6px;
		border-radius: 8px;
		background: rgba(232, 212, 77, 0.18);
		color: #e8d44d;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.sl-printers {
		max-width: 520px;
	}
	.sl-add-printer {
		display: flex;
		align-items: end;
		gap: 10px;
	}
	.sl-add-printer label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
	}
	.sl-add-printer input {
		width: 140px;
	}
	.sl-caution {
		margin: 0;
		font-size: 12px;
		padding: 10px 12px;
		border-left: 3px solid #e8d44d;
		background: rgba(232, 212, 77, 0.08);
	}
</style>
