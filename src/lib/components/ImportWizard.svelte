<script lang="ts">
	import { onMount } from 'svelte';
	import type { AdvancedImportOptions, CropRect, PreflightResult } from '$lib/dicomImportTypes';

	let {
		caseId,
		files,
		onclose,
		ondone
	}: {
		caseId: number;
		files: File[];
		onclose: () => void;
		ondone: (datasetId: number) => void;
	} = $props();

	// The SAME File[] is uploaded twice — once to /import/preflight (analysis)
	// and once to /import/advanced (actual import). Browser File objects are
	// stable disk-backed handles, so re-reading them for the second request is
	// reliable even for huge sets; nothing is cached server-side in between.

	let pf: PreflightResult | null = $state.raw(null);
	let phase: 'analyzing' | 'ready' | 'importing' = $state('analyzing');
	let progress = $state('');
	let errorMsg = $state('');

	// slice selection
	let sliceFrom = $state(0);
	let sliceTo = $state(0);
	// gray window
	let grayLo = $state(-1000);
	let grayHi = $state(3000);
	// slice distance
	let distMode: 'standard' | 'optimized' | 'manual' = $state('standard');
	let optimizedN = $state(2);
	let manualZ = $state(1);
	// other options
	let fillMissing: 'off' | 'interpolate' | 'black' = $state('off');
	let gantryCorrect = $state(false);
	let crop: CropRect | null = $state(null);
	let alias = $state('');
	let addExtras = $state(true);
	let alwaysAdvanced = $state(false);

	let tiltDetected = $derived.by(() => (pf?.series.tiltDeg ?? 0) > 0.5);
	let sliceCount = $derived.by(() => pf?.series.count ?? 0);

	function buildForm(): FormData {
		const f = new FormData();
		for (const file of files) f.append('files', file);
		return f;
	}

	async function readError(res: Response, fallback: string): Promise<string> {
		try {
			const data = (await res.json()) as { message?: string };
			return data?.message ?? fallback;
		} catch {
			return fallback;
		}
	}

	onMount(async () => {
		alwaysAdvanced = localStorage.getItem('cdx_advanced_import') === '1';
		try {
			const res = await fetch(`/api/cases/${caseId}/import/preflight`, {
				method: 'POST',
				body: buildForm()
			});
			if (!res.ok) throw new Error(await readError(res, `Preflight failed (${res.status})`));
			const data = (await res.json()) as PreflightResult;
			pf = data;
			// auto-select the valid (main-series) slices
			sliceFrom = 0;
			sliceTo = Math.max(0, data.series.count - 1);
			// gray window: init from the nonzero histogram range
			const bins = data.histogram.bins;
			const bw = (data.histogram.hi - data.histogram.lo) / bins.length;
			let fi = bins.findIndex((b) => b > 0);
			if (fi < 0) fi = 0;
			let li = bins.length - 1;
			while (li > fi && bins[li] === 0) li--;
			grayLo = Math.round(data.histogram.lo + fi * bw);
			grayHi = Math.round(data.histogram.lo + (li + 1) * bw);
			manualZ = Math.round(data.series.zSpacingMedian * 100) / 100 || 1;
			phase = 'ready';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Preflight failed';
			phase = 'ready';
		}
	});

	function clearSelection(): void {
		sliceFrom = 0;
		sliceTo = Math.max(0, sliceCount - 1);
	}

	// ---------- histogram canvas with draggable lo/hi handles ----------

	const HW = 440;
	const HH = 110;
	let histCanvas: HTMLCanvasElement | undefined = $state();
	let histDragging: 'lo' | 'hi' | null = null;

	function xToHU(x: number): number {
		const h = pf!.histogram;
		return h.lo + (x / HW) * (h.hi - h.lo);
	}
	function huToX(hu: number): number {
		const h = pf!.histogram;
		return ((hu - h.lo) / (h.hi - h.lo)) * HW;
	}

	$effect(() => {
		const cv = histCanvas;
		if (!cv || !pf) return;
		void grayLo;
		void grayHi;
		const ctx = cv.getContext('2d')!;
		ctx.fillStyle = '#12151a';
		ctx.fillRect(0, 0, HW, HH);
		const bins = pf.histogram.bins;
		const max = Math.log10(Math.max(...bins) + 1) || 1;
		ctx.fillStyle = '#3a4150';
		const bw = HW / bins.length;
		bins.forEach((c, i) => {
			const h = (Math.log10(c + 1) / max) * (HH - 12);
			ctx.fillRect(i * bw, HH - h, bw - 0.5, h);
		});
		const x1 = huToX(grayLo);
		const x2 = huToX(grayHi);
		ctx.fillStyle = 'rgba(47, 158, 199, 0.15)';
		ctx.fillRect(x1, 0, x2 - x1, HH);
		ctx.fillStyle = '#45b8e0';
		for (const x of [x1, x2]) ctx.fillRect(x - 2, 0, 4, HH);
	});

	function histDown(e: PointerEvent): void {
		if (!pf) return;
		histCanvas?.setPointerCapture(e.pointerId);
		const x = e.offsetX;
		histDragging = Math.abs(x - huToX(grayLo)) < Math.abs(x - huToX(grayHi)) ? 'lo' : 'hi';
		histMove(e);
	}
	function histMove(e: PointerEvent): void {
		if (!histDragging || !pf) return;
		const hu = Math.round(xToHU(Math.max(0, Math.min(HW, e.offsetX))));
		if (histDragging === 'lo') grayLo = Math.min(hu, grayHi - 10);
		else grayHi = Math.max(hu, grayLo + 10);
	}
	function histUp(): void {
		histDragging = null;
	}

	// ---------- crop canvas (middle thumbnail, draggable red rectangle) ----------

	const CW = 220;
	let cropCanvas: HTMLCanvasElement | undefined = $state();
	let cropImgReady = $state(0);
	let cropImg: HTMLImageElement | null = null;
	let cropDrag: { x: number; y: number } | null = null;

	let midThumb = $derived.by(() => (pf ? pf.thumbs[Math.floor(pf.thumbs.length / 2)] : undefined));
	let cropH = $derived(midThumb ? Math.max(40, Math.round((CW * midThumb.height) / midThumb.width)) : CW);

	$effect(() => {
		if (!midThumb) return;
		const img = new Image();
		img.onload = () => {
			cropImg = img;
			cropImgReady++;
		};
		img.src = `data:image/png;base64,${midThumb.png}`;
	});

	$effect(() => {
		const cv = cropCanvas;
		if (!cv || !pf) return;
		void crop;
		void cropImgReady;
		const ctx = cv.getContext('2d')!;
		ctx.fillStyle = '#12151a';
		ctx.fillRect(0, 0, cv.width, cv.height);
		if (cropImg) ctx.drawImage(cropImg, 0, 0, cv.width, cv.height);
		if (crop) {
			const sx = cv.width / pf.series.cols;
			const sy = cv.height / pf.series.rows;
			ctx.strokeStyle = '#e04545';
			ctx.lineWidth = 1.5;
			ctx.strokeRect(crop.x0 * sx, crop.y0 * sy, (crop.x1 - crop.x0) * sx, (crop.y1 - crop.y0) * sy);
		}
	});

	function cropDown(e: PointerEvent): void {
		if (!cropCanvas) return;
		cropCanvas.setPointerCapture(e.pointerId);
		cropDrag = { x: e.offsetX, y: e.offsetY };
		cropMove(e);
	}
	function cropMove(e: PointerEvent): void {
		if (!cropDrag || !pf || !cropCanvas) return;
		const sx = pf.series.cols / cropCanvas.width;
		const sy = pf.series.rows / cropCanvas.height;
		const cx = Math.max(0, Math.min(cropCanvas.width, e.offsetX));
		const cy = Math.max(0, Math.min(cropCanvas.height, e.offsetY));
		crop = {
			x0: Math.max(0, Math.round(Math.min(cropDrag.x, cx) * sx)),
			y0: Math.max(0, Math.round(Math.min(cropDrag.y, cy) * sy)),
			x1: Math.min(pf.series.cols, Math.round(Math.max(cropDrag.x, cx) * sx)),
			y1: Math.min(pf.series.rows, Math.round(Math.max(cropDrag.y, cy) * sy))
		};
	}
	function cropUp(): void {
		cropDrag = null;
		if (crop && (crop.x1 - crop.x0 < 8 || crop.y1 - crop.y0 < 8)) crop = null;
	}

	// ---------- import ----------

	function setAlwaysAdvanced(): void {
		localStorage.setItem('cdx_advanced_import', alwaysAdvanced ? '1' : '0');
	}

	async function doImport(): Promise<void> {
		if (!pf || phase === 'importing') return;
		phase = 'importing';
		errorMsg = '';
		try {
			const opts: AdvancedImportOptions = {
				sliceFrom,
				sliceTo,
				grayLo: Math.round(grayLo),
				grayHi: Math.round(grayHi)
			};
			if (distMode === 'optimized') opts.sliceStep = optimizedN;
			if (distMode === 'manual' && manualZ > 0) opts.zSpacingOverride = manualZ;
			if (fillMissing !== 'off') opts.fillMissing = fillMissing;
			if (gantryCorrect && tiltDetected) opts.gantryCorrect = true;
			if (crop) opts.crop = crop;
			if (alias.trim()) opts.alias = alias.trim();

			const body = buildForm();
			body.append('options', JSON.stringify(opts));
			progress = `Importing volume (${sliceTo - sliceFrom + 1} slices)…`;
			const res = await fetch(`/api/cases/${caseId}/import/advanced`, { method: 'POST', body });
			if (!res.ok) throw new Error(await readError(res, `Import failed (${res.status})`));
			const { dataset } = (await res.json()) as { dataset: { id: number } };

			if (addExtras && pf.extras.length > 0) {
				progress = 'Adding embedded 2D images to the library…';
				for (const ex of pf.extras) {
					const bytes = Uint8Array.from(atob(ex.png), (c) => c.charCodeAt(0));
					const f2 = new FormData();
					f2.append('file', new File([bytes], 'embedded.png', { type: 'image/png' }));
					f2.append('name', ex.description || 'Embedded 2D image');
					await fetch(`/api/cases/${caseId}/images`, { method: 'POST', body: f2 });
				}
			}
			ondone(dataset.id);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Import failed';
			phase = 'ready';
		}
	}
</script>

<div class="iw-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && phase !== 'importing' && onclose()}>
	<div class="iw-dialog panel">
		<div class="dialog-title">Advanced DICOM import</div>
		<div class="iw-body">
			{#if phase === 'analyzing'}
				<div class="muted">Analyzing {files.length} file(s)…</div>
			{:else if !pf}
				<div class="iw-error">{errorMsg || 'Preflight failed'}</div>
			{:else}
				<div class="muted iw-summary">
					{pf.series.modality}
					{pf.series.cols}×{pf.series.rows}, {pf.series.count} slices,
					{pf.series.spacing[1].toFixed(2)}×{pf.series.spacing[0].toFixed(2)}×{pf.series.zSpacingMedian.toFixed(2)} mm
					{#if pf.series.seriesDescription}— {pf.series.seriesDescription}{/if}
				</div>

				{#if pf.warnings.length}
					<div class="iw-warnings">
						{#each pf.warnings as w (w)}
							<div class="iw-warning">⚠ {w}</div>
						{/each}
					</div>
				{/if}

				<!-- slice range -->
				<div class="iw-section">
					<div class="iw-label">Slice selection ({sliceFrom}–{sliceTo} of 0–{sliceCount - 1})</div>
					<div class="iw-thumbs">
						{#each pf.thumbs as t (t.index)}
							<img
								class="iw-thumb"
								class:selected={t.index >= sliceFrom && t.index <= sliceTo}
								src={`data:image/png;base64,${t.png}`}
								width="60"
								alt={`Slice ${t.index}`}
								title={`Slice ${t.index}`}
							/>
						{/each}
					</div>
					<div class="iw-range-row">
						<input
							type="range"
							min="0"
							max={Math.max(0, sliceCount - 1)}
							bind:value={sliceFrom}
							oninput={() => sliceFrom > sliceTo && (sliceTo = sliceFrom)}
						/>
						<input
							type="range"
							min="0"
							max={Math.max(0, sliceCount - 1)}
							bind:value={sliceTo}
							oninput={() => sliceTo < sliceFrom && (sliceFrom = sliceTo)}
						/>
						<button class="btn" onclick={clearSelection}>Clear selection</button>
					</div>
				</div>

				<!-- gray window -->
				<div class="iw-section">
					<div class="iw-label">Gray values (preview window: {grayLo} … {grayHi} HU)</div>
					<canvas
						class="iw-hist"
						bind:this={histCanvas}
						width={HW}
						height={HH}
						onpointerdown={histDown}
						onpointermove={histMove}
						onpointerup={histUp}
					></canvas>
				</div>

				<div class="iw-grid">
					<!-- slice distance -->
					<label for="iw-dist">Slice distance</label>
					<div class="iw-inline">
						<select id="iw-dist" bind:value={distMode}>
							<option value="standard">Standard</option>
							<option value="optimized">Optimized 1:n</option>
							<option value="manual">Manual value</option>
						</select>
						{#if distMode === 'optimized'}
							<select bind:value={optimizedN} aria-label="Take every nth slice">
								<option value={2}>1:2</option>
								<option value={3}>1:3</option>
								<option value={4}>1:4</option>
							</select>
						{:else if distMode === 'manual'}
							<input type="number" step="0.01" min="0.01" bind:value={manualZ} aria-label="Slice distance (mm)" />
							<span class="muted">mm</span>
						{/if}
					</div>

					<!-- fill missing -->
					<label for="iw-fill">Missing slices</label>
					<div class="iw-inline">
						<select id="iw-fill" bind:value={fillMissing}>
							<option value="off">Keep as-is</option>
							<option value="interpolate">Fill — interpolate neighbors</option>
							<option value="black">Fill — black (−1000 HU)</option>
						</select>
						{#if pf.series.gaps.length}
							<span class="muted">{pf.series.gaps.length} gap(s) detected</span>
						{/if}
					</div>

					<!-- gantry -->
					<label for="iw-gantry">Gantry tilt</label>
					<div class="iw-inline">
						<input id="iw-gantry" type="checkbox" bind:checked={gantryCorrect} disabled={!tiltDetected} />
						<span class:muted={!tiltDetected}>
							{#if tiltDetected}
								Correct tilt of {pf.series.tiltDeg.toFixed(1)}° (y-shear approximation)
							{:else}
								No tilt detected
							{/if}
						</span>
					</div>

					<!-- alias -->
					<label for="iw-alias">Alias</label>
					<div class="iw-inline">
						<input
							id="iw-alias"
							type="text"
							bind:value={alias}
							placeholder="permanent anonymization — leave empty to keep identity"
						/>
					</div>

					{#if pf.extras.length}
						<label for="iw-extras">Embedded 2D images</label>
						<div class="iw-inline">
							<input id="iw-extras" type="checkbox" bind:checked={addExtras} />
							<span>Add {pf.extras.length} image(s) to the image library</span>
						</div>
					{/if}
				</div>

				<!-- crop -->
				<div class="iw-section">
					<div class="iw-label">
						Region restriction — drag a rectangle
						{#if crop}
							<span class="muted">({crop.x0},{crop.y0}) – ({crop.x1},{crop.y1}) px</span>
							<button class="btn" onclick={() => (crop = null)}>Clear crop</button>
						{:else}
							<span class="muted">(full image)</span>
						{/if}
					</div>
					<canvas
						class="iw-crop"
						bind:this={cropCanvas}
						width={CW}
						height={cropH}
						onpointerdown={cropDown}
						onpointermove={cropMove}
						onpointerup={cropUp}
					></canvas>
				</div>

				{#if errorMsg}
					<div class="iw-error">{errorMsg}</div>
				{/if}
			{/if}

			<label class="iw-always">
				<input type="checkbox" bind:checked={alwaysAdvanced} onchange={setAlwaysAdvanced} />
				Always start in advanced mode
			</label>
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose} disabled={phase === 'importing'}>Cancel</button>
			{#if phase === 'importing'}
				<span class="muted iw-progress">{progress}</span>
			{/if}
			<button class="btn primary" onclick={doImport} disabled={!pf || phase !== 'ready'}>
				Import
			</button>
		</div>
	</div>
</div>

<style>
	.iw-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.iw-dialog {
		width: 700px;
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
	}
	.iw-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow-y: auto;
	}
	.iw-summary {
		font-size: 12px;
	}
	.iw-warnings {
		border: 1px solid #8a7a1e;
		border-radius: 3px;
		background: rgba(232, 212, 77, 0.08);
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.iw-warning {
		color: #e8d44d;
		font-size: 12px;
	}
	.iw-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.iw-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.iw-thumbs {
		display: flex;
		gap: 4px;
		overflow-x: auto;
	}
	.iw-thumb {
		border: 2px solid transparent;
		border-radius: 2px;
		opacity: 0.35;
		image-rendering: pixelated;
	}
	.iw-thumb.selected {
		border-color: #45b8e0;
		opacity: 1;
	}
	.iw-range-row {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 8px;
		align-items: center;
	}
	canvas.iw-hist,
	canvas.iw-crop {
		border: 1px solid var(--border-soft);
		border-radius: 3px;
		touch-action: none;
	}
	canvas.iw-hist {
		cursor: ew-resize;
	}
	canvas.iw-crop {
		cursor: crosshair;
		align-self: flex-start;
	}
	.iw-grid {
		display: grid;
		grid-template-columns: 140px 1fr;
		gap: 8px 12px;
		align-items: center;
	}
	.iw-grid > label {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim);
	}
	.iw-inline {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.iw-inline input[type='text'] {
		flex: 1;
	}
	.iw-inline input[type='number'] {
		width: 80px;
	}
	.iw-always {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-dim);
		margin-top: 2px;
	}
	.iw-error {
		color: #e05a5a;
		font-size: 12px;
	}
	.iw-progress {
		align-self: center;
		font-size: 12px;
	}
</style>
