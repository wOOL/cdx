<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import SliceView from '$lib/components/viewers/SliceView.svelte';
	import VolumeView from '$lib/components/viewers/VolumeView.svelte';
	import PanoView from '$lib/components/viewers/PanoView.svelte';
	import CrossView from '$lib/components/viewers/CrossView.svelte';
	import { PlanningState, WINDOW_PRESETS } from '$lib/client/planning.svelte';
	import { indexAtLength } from '$lib/curve';
	import type { ToolPointerEvent, ViewTransform } from '$lib/client/render2d';
	import {
		crossTool,
		drawAxialObjects,
		drawCrossOverlay,
		drawPanoOverlay,
		panoTool
	} from '$lib/client/planTools';
	import {
		FDI_LOWER,
		FDI_UPPER,
		IMPLANT_LIBRARY,
		articleName,
		implantColor
	} from '$lib/implantLibrary';

	let { data } = $props();

	const stages = [
		{ key: 'data', label: 'Data', icon: 'import' },
		{ key: 'align', label: 'Align', icon: 'rotate' },
		{ key: 'pano', label: 'Panoramic', icon: 'pano' },
		{ key: 'nerve', label: 'Nerve', icon: 'nerve' },
		{ key: 'implant', label: 'Implants', icon: 'implant' },
		{ key: 'sleeve', label: 'Sleeves', icon: 'volume' },
		{ key: 'guide', label: 'Guide', icon: 'guide' },
		{ key: 'report', label: 'Report', icon: 'report' }
	] as const;

	type StageKey = (typeof stages)[number]['key'];

	let hasVolume = $derived(data.datasets.length > 0);
	let stage = $state<StageKey>('data');
	let ps = $derived(
		data.datasets[0]
			? new PlanningState(data.datasets[0], data.plan, data.nerves, data.implants)
			: null
	);

	// deep snapshot so canvas overlays redraw on any object change
	let objectsVersion = $derived(
		ps
			? JSON.stringify([
					ps.nerves,
					ps.implants,
					ps.selectedImplantId,
					ps.activeNerveId,
					ps.nerveEditMode,
					ps.warnings.length
				])
			: ''
	);

	// move off the data stage automatically once a volume exists
	$effect(() => {
		if (hasVolume && stage === 'data') stage = 'pano';
	});

	// stage-bound edit modes
	$effect(() => {
		if (stage !== 'pano' && ps) ps.curveEditMode = false;
		if (stage !== 'nerve' && ps) ps.nerveEditMode = false;
	});

	// ---------- panoramic curve editing on the axial view ----------
	let dragPointIndex = -1;

	function curveOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps) return;
		const sx = ps.ds.spacing_x;
		const sy = ps.ds.spacing_y;
		const toCanvas = (mmx: number, mmy: number) => ({
			x: t.ox + (mmx / sx + 0.5) * t.scaleX,
			y: t.oy + (mmy / sy + 0.5) * t.scaleY
		});

		const c = ps.curve;
		if (c) {
			ctx.strokeStyle = 'rgba(69, 184, 224, 0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			c.points.forEach((p, i) => {
				const q = toCanvas(p.x, p.y);
				if (i === 0) ctx.moveTo(q.x, q.y);
				else ctx.lineTo(q.x, q.y);
			});
			ctx.stroke();

			// cross-section position marker on the curve
			const ci = indexAtLength(c, ps.crossU);
			const cp = c.points[ci];
			const cn = c.normals[ci];
			const q = toCanvas(cp.x, cp.y);
			const q2 = toCanvas(cp.x + cn.x * 6, cp.y + cn.y * 6);
			const q3 = toCanvas(cp.x - cn.x * 6, cp.y - cn.y * 6);
			ctx.strokeStyle = 'rgba(240, 138, 36, 0.95)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(q3.x, q3.y);
			ctx.lineTo(q2.x, q2.y);
			ctx.stroke();
			ctx.fillStyle = 'rgba(240, 138, 36, 0.95)';
			ctx.beginPath();
			ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		for (const p of ps.curveControl) {
			const q = toCanvas(p.x, p.y);
			ctx.fillStyle = ps.curveEditMode ? 'rgba(69, 184, 224, 1)' : 'rgba(69, 184, 224, 0.6)';
			ctx.beginPath();
			ctx.arc(q.x, q.y, ps.curveEditMode ? 4 : 3, 0, Math.PI * 2);
			ctx.fill();
			if (ps.curveEditMode) {
				ctx.strokeStyle = '#0b0d10';
				ctx.lineWidth = 1;
				ctx.stroke();
			}
		}
	}

	function curveTool(e: ToolPointerEvent): boolean {
		if (!ps || !ps.curveEditMode) return false;
		const mm = { x: e.px * ps.ds.spacing_x, y: e.py * ps.ds.spacing_y };
		if (e.type === 'down') {
			const idx = ps.curveControl.findIndex((p) => Math.hypot(p.x - mm.x, p.y - mm.y) < 2.5);
			if (idx >= 0) {
				dragPointIndex = idx;
			} else {
				ps.curveControl.push(mm);
				dragPointIndex = ps.curveControl.length - 1;
				ps.curveZ = ps.cursor.z;
			}
			ps.saveCurve();
			return true;
		}
		if (e.type === 'move' && dragPointIndex >= 0) {
			ps.curveControl[dragPointIndex] = mm;
			ps.saveCurve();
			return true;
		}
		if (e.type === 'up') {
			dragPointIndex = -1;
			return true;
		}
		return false;
	}

	function undoCurvePoint() {
		if (!ps) return;
		ps.curveControl.pop();
		ps.saveCurve();
	}
	function clearCurve() {
		if (!ps) return;
		if (ps.curveControl.length && !confirm('Clear the panoramic curve?')) return;
		ps.curveControl.length = 0;
		ps.saveCurve();
	}

	// ---------- combined overlays ----------
	function axialOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		curveOverlay(ctx, t);
		if (ps) drawAxialObjects(ps, ctx, t);
	}

	// ---------- nerve tools ----------
	async function addNerve(side: 'left' | 'right') {
		if (!ps) return;
		const existing = ps.nerves.length;
		await ps.addNerve(
			`N. alveolaris inf. ${side}`,
			existing % 2 === 0 ? '#e8d44d' : '#d4a24d'
		);
	}

	// ---------- implant tools ----------
	let implantDialog: HTMLDialogElement | undefined = $state();
	let newImplant = $state({
		tooth: '36',
		lineIndex: 0,
		diameter: IMPLANT_LIBRARY[0].diameters[3] ?? 4.1,
		length: IMPLANT_LIBRARY[0].lengths[2] ?? 10
	});

	function openImplantDialog() {
		if (!ps) return;
		implantDialog?.showModal();
	}

	async function confirmAddImplant() {
		if (!ps) return;
		const line = IMPLANT_LIBRARY[newImplant.lineIndex];
		const c = ps.curve;
		let head = {
			x: (ps.ds.cols * ps.ds.spacing_x) / 2,
			y: (ps.ds.rows * ps.ds.spacing_y) / 2,
			z: ps.cursor.z * ps.ds.spacing_z
		};
		if (c) {
			const i = indexAtLength(c, ps.crossU);
			head = { x: c.points[i].x, y: c.points[i].y, z: ps.cursor.z * ps.ds.spacing_z };
		}
		await ps.addImplant({
			tooth: newImplant.tooth,
			manufacturer: line.manufacturer,
			line: line.line,
			article: articleName(line, newImplant.diameter, newImplant.length),
			diameter: newImplant.diameter,
			length: newImplant.length,
			color: implantColor(ps.implants.length),
			head
		});
		implantDialog?.close();
	}

	function deleteSelectedImplant() {
		if (!ps?.selectedImplantId) return;
		const im = ps.implants.find((i) => i.id === ps?.selectedImplantId);
		if (im && confirm(`Remove implant ${im.tooth ? `at ${im.tooth}` : ''} (${im.article})?`)) {
			ps.deleteImplant(im.id);
		}
	}

	let selectedImplant = $derived(ps?.implants.find((i) => i.id === ps?.selectedImplantId) ?? null);

	// ---------- DICOM upload ----------
	let uploading = $state(false);
	let uploadError = $state('');
	let dragOver = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	async function uploadFiles(files: FileList | File[]) {
		const list = Array.from(files);
		if (list.length === 0) return;
		uploading = true;
		uploadError = '';
		try {
			const form = new FormData();
			for (const f of list) form.append('files', f);
			const res = await fetch(`/api/cases/${data.caseData.id}/import`, {
				method: 'POST',
				body: form
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Import failed (${res.status})`);
			}
			await invalidateAll();
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Import failed';
		} finally {
			uploading = false;
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
	}
</script>

<svelte:head>
	<title>{data.patient.last_name}, {data.patient.first_name} — {data.caseData.title}</title>
</svelte:head>

<header class="case-bar">
	<a class="btn ghost" href="/?sel={data.patient.id}" title="Back to patient database">
		<Icon name="back" size={18} />
	</a>
	<div class="case-id">
		<div class="case-patient">
			{data.patient.last_name}, {data.patient.first_name}
			<span class="faint">{data.patient.external_id ? `· ID ${data.patient.external_id}` : ''}</span>
		</div>
		<div class="case-title-row">
			<span class="muted">{data.caseData.title}</span>
			<span class="badge {data.caseData.status}">{data.caseData.status}</span>
		</div>
	</div>

	<nav class="stage-bar">
		{#each stages as s (s.key)}
			<button
				class="tool-btn"
				class:active={stage === s.key}
				disabled={s.key !== 'data' && !hasVolume}
				onclick={() => (stage = s.key)}
			>
				<Icon name={s.icon} size={20} />
				<span>{s.label}</span>
			</button>
		{/each}
	</nav>

	<div class="spacer"></div>
	<div class="plan-chip muted" title="Active plan">{data.plan.name}</div>
</header>

<div class="workspace">
	<aside class="object-tree panel">
		<div class="panel-header">Objects</div>
		<div class="tree">
			<div class="tree-group">
				<div class="tree-group-label">Volume data</div>
				{#each data.datasets as d (d.id)}
					<div class="tree-item">
						<Icon name="volume" size={14} />
						<span title={d.series_description}>{d.modality || 'CT'} {d.cols}×{d.rows}×{d.slices}</span>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Models</div>
				{#each data.models as m (m.id)}
					<div class="tree-item"><Icon name="tooth" size={14} /><span>{m.name}</span></div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Implants</div>
				{#each ps?.implants ?? [] as im (im.id)}
					<div
						class="tree-item tree-clickable"
						class:tree-selected={ps?.selectedImplantId === im.id}
						role="button"
						tabindex="0"
						onclick={() => ps && (ps.selectedImplantId = im.id)}
						onkeydown={(e) => e.key === 'Enter' && ps && (ps.selectedImplantId = im.id)}
					>
						<span class="dot" style="background:{im.color}"></span>
						<span class="tree-item-label"
							>{im.tooth ? `${im.tooth} — ` : ''}⌀{im.diameter}×{im.length}</span
						>
						<button
							class="tree-eye"
							title="Toggle visibility"
							onclick={(e) => {
								e.stopPropagation();
								im.visible = !im.visible;
								ps?.saveImplant(im.id);
							}}
						>
							<Icon name={im.visible ? 'eye' : 'eye-off'} size={13} />
						</button>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Nerves</div>
				{#each ps?.nerves ?? [] as n (n.id)}
					<div class="tree-item">
						<span class="dot" style="background:{n.color}"></span>
						<span class="tree-item-label">{n.name}</span>
						<button
							class="tree-eye"
							title="Toggle visibility"
							onclick={() => {
								n.visible = !n.visible;
								ps?.saveNerve(n.id);
							}}
						>
							<Icon name={n.visible ? 'eye' : 'eye-off'} size={13} />
						</button>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Measurements</div>
				{#each data.measurements as m (m.id)}
					<div class="tree-item"><Icon name="ruler" size={14} /><span>{m.label || m.type}</span></div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
		</div>

		{#if ps}
			<div class="view-controls">
				<div class="panel-header">View</div>
				<div class="view-controls-body">
					<label for="wl-preset">Window preset</label>
					<select
						id="wl-preset"
						onchange={(e) => {
							const p = WINDOW_PRESETS.find((p) => p.name === e.currentTarget.value);
							if (p && ps) {
								ps.wc = p.wc;
								ps.ww = p.ww;
							}
						}}
					>
						{#each WINDOW_PRESETS as p (p.name)}
							<option value={p.name} selected={p.wc === ps.wc && p.ww === ps.ww}>{p.name}</option>
						{/each}
					</select>
					<label class="checkbox-row">
						<input type="checkbox" bind:checked={ps.crosshairVisible} />
						<span>Crosshair</span>
					</label>
				</div>
			</div>
		{/if}
	</aside>

	<main class="view-area">
		{#if stage === 'data' || !ps}
			<div class="data-stage">
				<div
					class="dropzone panel"
					class:drag-over={dragOver}
					role="button"
					tabindex="0"
					ondragover={(e) => {
						e.preventDefault();
						dragOver = true;
					}}
					ondragleave={() => (dragOver = false)}
					ondrop={onDrop}
					onclick={() => fileInput?.click()}
					onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
				>
					{#if uploading}
						<div class="spinner"></div>
						<h3>Importing DICOM…</h3>
						<p class="muted">Parsing slices and building the volume</p>
					{:else}
						<Icon name="import" size={44} />
						<h3>Import DICOM data</h3>
						<p class="muted">
							Drop DICOM files (.dcm) or a .zip archive here, or click to browse.<br />
							CT / CBCT, uncompressed transfer syntax.
						</p>
					{/if}
					<input
						type="file"
						multiple
						accept=".dcm,.zip,application/zip,application/dicom"
						bind:this={fileInput}
						onchange={(e) => e.currentTarget.files && uploadFiles(e.currentTarget.files)}
						hidden
					/>
				</div>
				{#if uploadError}
					<div class="upload-error"><Icon name="warning" size={16} /> {uploadError}</div>
				{/if}

				{#if data.datasets.length}
					<div class="dataset-list">
						{#each data.datasets as d (d.id)}
							<div class="dataset-card panel">
								<Icon name="volume" size={22} />
								<div>
									<div><strong>{d.series_description || d.description}</strong></div>
									<div class="faint">
										{d.modality} · {d.cols}×{d.rows}×{d.slices} ·
										{d.spacing_x.toFixed(2)}/{d.spacing_y.toFixed(2)}/{d.spacing_z.toFixed(2)} mm
										{d.patient_name ? ` · ${d.patient_name}` : ''}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="stage-tools">
				{#if stage === 'pano'}
					<button
						class="btn"
						class:primary={ps.curveEditMode}
						onclick={() => ps && (ps.curveEditMode = !ps.curveEditMode)}
					>
						<Icon name="edit" size={14} />
						{ps.curveEditMode ? 'Drawing curve — click along the arch' : 'Draw curve'}
					</button>
					<button class="btn" disabled={!ps.curveControl.length} onclick={undoCurvePoint}>
						Undo point
					</button>
					<button class="btn danger" disabled={!ps.curveControl.length} onclick={clearCurve}>
						Clear
					</button>
					<div class="tool-sep"></div>
					<label class="inline-label" for="pano-thickness">Slab</label>
					<input
						id="pano-thickness"
						type="range"
						min="0"
						max="8"
						step="0.5"
						bind:value={ps.panoThickness}
						style="width:90px"
					/>
					<span class="muted">{ps.panoThickness.toFixed(1)} mm</span>
				{:else if stage === 'align'}
					<span class="muted">Multiplanar review — left-click to navigate, right-drag for window/level, wheel to scroll</span>
				{:else if stage === 'nerve'}
					<button class="btn" onclick={() => addNerve('right')}>
						<Icon name="nerve" size={14} /> Add right nerve
					</button>
					<button class="btn" onclick={() => addNerve('left')}>
						<Icon name="nerve" size={14} /> Add left nerve
					</button>
					<div class="tool-sep"></div>
					{#each ps.nerves as n (n.id)}
						<div class="chip" class:chip-active={ps.activeNerveId === n.id && ps.nerveEditMode}>
							<span class="dot" style="background:{n.color}"></span>
							<button
								class="chip-label"
								title="Edit nerve points"
								onclick={() => {
									if (!ps) return;
									if (ps.activeNerveId === n.id) {
										ps.nerveEditMode = !ps.nerveEditMode;
									} else {
										ps.activeNerveId = n.id;
										ps.nerveEditMode = true;
									}
								}}>{n.name}</button
							>
							<input
								class="chip-num"
								type="number"
								min="1"
								max="5"
								step="0.5"
								value={n.diameter}
								title="Diameter (mm)"
								onchange={(e) => {
									n.diameter = Number(e.currentTarget.value) || 2;
									ps?.saveNerve(n.id);
								}}
							/>
							<button
								class="chip-x"
								title="Delete nerve"
								onclick={() => confirm(`Delete ${n.name}?`) && ps?.deleteNerve(n.id)}>×</button
							>
						</div>
					{/each}
					{#if ps.nerveEditMode}
						<span class="muted">Click in the panoramic or cross-section view to add nerve points</span>
					{/if}
				{:else if stage === 'implant'}
					<button class="btn primary" onclick={openImplantDialog}>
						<Icon name="implant" size={14} /> Add implant
					</button>
					{#if selectedImplant}
						<div class="tool-sep"></div>
						<span>
							<strong>{selectedImplant.tooth ? `Tooth ${selectedImplant.tooth} — ` : ''}</strong>
							{selectedImplant.manufacturer} {selectedImplant.article}
						</span>
						<button class="btn danger" onclick={deleteSelectedImplant}>
							<Icon name="trash" size={14} /> Remove
						</button>
					{:else if ps.implants.length}
						<span class="muted">Click an implant in any view to select and drag it; handles tilt the axis</span>
					{/if}
				{:else}
					<span class="muted">{stages.find((s) => s.key === stage)?.label} tools coming soon</span>
				{/if}
			</div>

			{#if stage === 'align'}
				<div class="view-grid grid-2x2">
					<div class="view panel"><VolumeView state={ps} /></div>
					<div class="view panel"><SliceView state={ps} plane="axial" overlayDraw={curveOverlay} overlayDeps={[ps.curveControl, ps.crossU]} /></div>
					<div class="view panel"><SliceView state={ps} plane="coronal" /></div>
					<div class="view panel"><SliceView state={ps} plane="sagittal" /></div>
				</div>
			{:else if stage === 'pano'}
				<div class="view-grid grid-pano">
					<div class="view panel area-ax">
						<SliceView
							state={ps}
							plane="axial"
							overlayDraw={curveOverlay}
							onToolPointer={curveTool}
							overlayDeps={[ps.curveControl, ps.curveEditMode, ps.crossU]}
						/>
					</div>
					<div class="view panel area-3d"><VolumeView state={ps} /></div>
					<div class="view panel area-pano"><PanoView state={ps} /></div>
				</div>
			{:else}
				<div class="view-grid grid-2x2">
					<div class="view panel"><VolumeView state={ps} /></div>
					<div class="view panel">
						<SliceView
							state={ps}
							plane="axial"
							overlayDraw={axialOverlay}
							overlayDeps={[ps.curveControl, ps.crossU, objectsVersion]}
						/>
					</div>
					<div class="view panel">
						<PanoView
							state={ps}
							overlayDraw={(ctx, t, info) => ps && drawPanoOverlay(ps, ctx, t, info)}
							onToolPointer={(e) => (ps ? panoTool(ps, e) : false)}
							overlayDeps={[objectsVersion]}
						/>
					</div>
					<div class="view panel">
						<CrossView
							state={ps}
							overlayDraw={(ctx, t, info) => ps && drawCrossOverlay(ps, ctx, t, info)}
							onToolPointer={(e) => (ps ? crossTool(ps, e) : false)}
							overlayDeps={[objectsVersion]}
						/>
					</div>
				</div>
			{/if}
		{/if}
	</main>
</div>

<!-- add implant dialog -->
<dialog bind:this={implantDialog}>
	<div class="dialog-title">Add implant</div>
	<div class="dialog-body">
		<div>
			<label for="im-tooth">Tooth position (FDI)</label>
			<div class="fdi-grid">
				{#each [FDI_UPPER, FDI_LOWER] as row, ri (ri)}
					<div class="fdi-row">
						{#each row as tooth (tooth)}
							<button
								type="button"
								class="fdi-tooth"
								class:fdi-active={newImplant.tooth === String(tooth)}
								class:fdi-placed={ps?.implants.some((i) => i.tooth === String(tooth))}
								onclick={() => (newImplant.tooth = String(tooth))}
							>
								{tooth}
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</div>
		<div class="field-row">
			<div>
				<label for="im-line">Implant system</label>
				<select
					id="im-line"
					bind:value={newImplant.lineIndex}
					onchange={() => {
						const line = IMPLANT_LIBRARY[newImplant.lineIndex];
						if (!line.diameters.includes(newImplant.diameter))
							newImplant.diameter = line.diameters[Math.floor(line.diameters.length / 2)];
						if (!line.lengths.includes(newImplant.length))
							newImplant.length = line.lengths[Math.floor(line.lengths.length / 2)];
					}}
					style="width:100%"
				>
					{#each IMPLANT_LIBRARY as line, i (i)}
						<option value={i}>{line.manufacturer} — {line.line}</option>
					{/each}
				</select>
			</div>
		</div>
		<div class="field-row">
			<div>
				<label for="im-d">Diameter</label>
				<select id="im-d" bind:value={newImplant.diameter} style="width:100%">
					{#each IMPLANT_LIBRARY[newImplant.lineIndex].diameters as d (d)}
						<option value={d}>⌀ {d.toFixed(1)} mm</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="im-l">Length</label>
				<select id="im-l" bind:value={newImplant.length} style="width:100%">
					{#each IMPLANT_LIBRARY[newImplant.lineIndex].lengths as l (l)}
						<option value={l}>{l.toFixed(1)} mm</option>
					{/each}
				</select>
			</div>
		</div>
		<p class="faint">
			The implant is placed at the current cross-section position; drag it in the views to refine.
		</p>
	</div>
	<div class="dialog-actions">
		<button type="button" class="btn" onclick={() => implantDialog?.close()}>Cancel</button>
		<button type="button" class="btn primary" onclick={confirmAddImplant}>Place implant</button>
	</div>
</dialog>

<footer class="status-bar">
	<span class="faint">coDiagnostiX Web — planning workspace</span>
	{#if ps && ps.warnings.length}
		<span class="warn-text">
			<Icon name="warning" size={13} />
			{ps.warnings.length} safety distance warning{ps.warnings.length === 1 ? '' : 's'}
			({ps.warnings.map((w) => `${w.kind} ${w.distance.toFixed(1)}mm`).join(', ')})
		</span>
	{/if}
	<div class="spacer"></div>
	{#if ps}
		<span class="faint">
			cursor {ps.cursor.x}, {ps.cursor.y}, {ps.cursor.z}
			· {(ps.cursor.x * ps.ds.spacing_x).toFixed(1)}, {(ps.cursor.y * ps.ds.spacing_y).toFixed(1)}, {(
				ps.cursor.z * ps.ds.spacing_z
			).toFixed(1)} mm
		</span>
	{:else}
		<span class="faint">no data</span>
	{/if}
</footer>

<style>
	.case-bar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 12px;
		height: 64px;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.case-patient {
		font-weight: 600;
	}
	.case-title-row {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	.stage-bar {
		display: flex;
		gap: 2px;
		margin-left: 24px;
		border-left: 1px solid var(--border-soft);
		padding-left: 24px;
	}
	.spacer {
		flex: 1;
	}
	.plan-chip {
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 3px 12px;
		font-size: 12px;
	}

	.workspace {
		flex: 1;
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 8px;
		padding: 8px;
		min-height: 0;
	}
	.object-tree {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.tree {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}
	.tree-group {
		margin-bottom: 10px;
	}
	.tree-group-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-faint);
		padding: 4px 6px;
	}
	.tree-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: var(--radius);
		font-size: 12px;
	}
	.tree-item:hover {
		background: var(--bg-3);
	}
	.tree-empty {
		padding: 2px 8px;
		font-size: 11px;
		color: var(--text-faint);
		font-style: italic;
	}
	.tree-clickable {
		cursor: pointer;
	}
	.tree-selected {
		background: var(--accent-dim);
	}
	.tree-item-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tree-eye {
		color: var(--text-dim);
		display: flex;
	}
	.tree-eye:hover {
		color: var(--text);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
		display: inline-block;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 2px 8px;
		background: var(--bg-2);
	}
	.chip-active {
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.chip-label {
		font-size: 12px;
	}
	.chip-num {
		width: 44px;
		padding: 1px 4px;
		font-size: 11px;
	}
	.chip-x {
		color: var(--text-dim);
		font-size: 14px;
		padding: 0 2px;
	}
	.chip-x:hover {
		color: var(--red);
	}
	.fdi-grid {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fdi-row {
		display: flex;
		gap: 2px;
	}
	.fdi-tooth {
		flex: 1;
		padding: 4px 0;
		font-size: 11px;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: var(--bg-1);
		color: var(--text-dim);
		min-width: 26px;
	}
	.fdi-tooth:hover {
		border-color: var(--accent-dim);
		color: var(--text);
	}
	.fdi-active {
		background: var(--accent-dim);
		color: #fff;
		border-color: var(--accent);
	}
	.fdi-placed {
		color: var(--accent-2);
	}
	.warn-text {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--red);
	}
	.view-controls-body {
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: var(--text);
		cursor: pointer;
	}

	.view-area {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.stage-tools {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 2px;
		flex: none;
		min-height: 34px;
	}
	.tool-sep {
		width: 1px;
		height: 20px;
		background: var(--border);
		margin: 0 4px;
	}
	.inline-label {
		display: inline;
		margin: 0;
	}
	.data-stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: stretch;
		justify-content: center;
		max-width: 720px;
		margin: 0 auto;
	}
	.dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 48px 32px;
		text-align: center;
		color: var(--text-dim);
		cursor: pointer;
		border-style: dashed;
		border-width: 2px;
	}
	.dropzone:hover,
	.dropzone.drag-over {
		border-color: var(--accent);
		color: var(--text);
	}
	.upload-error {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--red);
		justify-content: center;
	}
	.dataset-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.dataset-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
	}
	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--bg-3);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.view-grid {
		flex: 1;
		display: grid;
		gap: 8px;
		min-height: 0;
	}
	.grid-2x2 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}
	.grid-pano {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 3fr 2fr;
		grid-template-areas:
			'ax v3d'
			'pano pano';
	}
	.area-ax {
		grid-area: ax;
	}
	.area-3d {
		grid-area: v3d;
	}
	.area-pano {
		grid-area: pano;
	}
	.view {
		position: relative;
		background: #000;
		overflow: hidden;
	}
	.view-label-3d {
		position: absolute;
		top: 6px;
		left: 8px;
		font-size: 11px;
		color: var(--accent-bright);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		z-index: 2;
	}
	.view-placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}

	.status-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 26px;
		padding: 0 12px;
		background: var(--bg-0);
		border-top: 1px solid var(--border-soft);
		font-size: 11px;
		flex: none;
	}
</style>
