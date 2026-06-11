<script module lang="ts">
	export interface WizardSegment {
		height: number;
		upperDiameter: number;
		lowerDiameter: number;
		distanceToZeroLevel: number;
	}

	export interface WizardSleeveSystem {
		id?: number;
		name: string;
		manufacturer: string;
		notes: string;
		segments: WizardSegment[];
		drillOffset: number;
	}
</script>

<script lang="ts">
	let {
		initial = null,
		onsave,
		onclose
	}: {
		initial?: WizardSleeveSystem | null;
		onsave: (sys: WizardSleeveSystem) => Promise<void>;
		onclose: () => void;
	} = $props();

	const STEP_TITLES = ['Identification', 'Negative geometry (sleeve hole)', 'Drill offset & summary'];

	let step = $state(1);
	let name = $state(initial?.name ?? '');
	let manufacturer = $state(initial?.manufacturer ?? '');
	let notes = $state(initial?.notes ?? '');
	let segments = $state<WizardSegment[]>(
		initial?.segments?.length
			? initial.segments.map((s) => ({ ...s }))
			: [{ height: 5, upperDiameter: 5, lowerDiameter: 5, distanceToZeroLevel: 0 }]
	);
	let drillOffset = $state(initial?.drillOffset ?? 0);
	let targetDrill = $state(2.2);
	let errorMsg = $state('');
	let saving = $state(false);

	const r2 = (n: number): number => Math.round(n * 100) / 100;
	const num = (v: unknown, fallback: number): number =>
		Number.isFinite(Number(v)) ? Number(v) : fallback;

	function stepError(s: number): string {
		if (s === 1) {
			if (!name.trim()) return 'Name is required';
			return '';
		}
		if (s === 2) {
			if (segments.length < 1 || segments.length > 3) return '1–3 segments required';
			let sum = 0;
			for (let i = 0; i < segments.length; i++) {
				const sg = segments[i];
				const dims: [string, number][] = [
					['height', Number(sg.height)],
					['upper Ø', Number(sg.upperDiameter)],
					['lower Ø', Number(sg.lowerDiameter)]
				];
				for (const [label, v] of dims) {
					if (!Number.isFinite(v) || v < 0.5 || v > 20) {
						return `Segment ${i + 1}: ${label} must be 0.5–20 mm`;
					}
				}
				const dz = Number(sg.distanceToZeroLevel);
				if (!Number.isFinite(dz) || dz < -20 || dz > 20) {
					return `Segment ${i + 1}: distance to zero level must be -20–20 mm`;
				}
				sum += Number(sg.height);
			}
			if (sum < 2 || sum > 15) {
				return `Segment heights must sum to 2–15 mm (now ${sum.toFixed(1)} mm)`;
			}
			return '';
		}
		const off = Number(drillOffset);
		if (!Number.isFinite(off) || off < 0 || off > 30) return 'Drill offset must be 0–30 mm';
		return '';
	}

	function next() {
		const e = stepError(step);
		if (e) {
			errorMsg = e;
			return;
		}
		errorMsg = '';
		step++;
	}

	function back() {
		errorMsg = '';
		step--;
	}

	function addSegment() {
		if (segments.length >= 3) return;
		const last = segments[segments.length - 1];
		segments.push({
			height: 2,
			upperDiameter: last ? num(last.upperDiameter, 5) : 5,
			lowerDiameter: last ? num(last.upperDiameter, 5) : 5,
			distanceToZeroLevel: last ? r2(num(last.distanceToZeroLevel, 0) + num(last.height, 0)) : 0
		});
	}

	function removeSegment(i: number) {
		if (segments.length <= 1) return;
		segments.splice(i, 1);
	}

	/** seg1 = guide bore (drill Ø + 0.1), seg2 = wider body, seg3 = flange */
	function autoPropose() {
		const d = Number(targetDrill);
		if (!Number.isFinite(d) || d < 0.5 || d > 16) {
			errorMsg = 'Target drill Ø must be 0.5–16 mm';
			return;
		}
		errorMsg = '';
		const bore = r2(d + 0.1);
		segments = [
			{ height: 5, lowerDiameter: bore, upperDiameter: bore, distanceToZeroLevel: 0 },
			{ height: 3, lowerDiameter: bore, upperDiameter: r2(d + 2), distanceToZeroLevel: 5 },
			{ height: 1, lowerDiameter: r2(d + 3), upperDiameter: r2(d + 3), distanceToZeroLevel: 8 }
		];
	}

	async function save() {
		for (const s of [1, 2, 3]) {
			const e = stepError(s);
			if (e) {
				errorMsg = e;
				step = s;
				return;
			}
		}
		saving = true;
		errorMsg = '';
		try {
			await onsave({
				id: initial?.id,
				name: name.trim(),
				manufacturer: manufacturer.trim(),
				notes: notes.trim(),
				segments: segments.map((s) => ({
					height: r2(Number(s.height)),
					upperDiameter: r2(Number(s.upperDiameter)),
					lowerDiameter: r2(Number(s.lowerDiameter)),
					distanceToZeroLevel: r2(Number(s.distanceToZeroLevel))
				})),
				drillOffset: r2(Number(drillOffset))
			});
			onclose();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Save failed';
		} finally {
			saving = false;
		}
	}

	const heightSum = $derived(segments.reduce((a, s) => a + num(s.height, 0), 0));
	const maxOuter = $derived(segments.reduce((a, s) => Math.max(a, num(s.upperDiameter, 0)), 0));

	/* ---- live SVG cross-section of the negative geometry ---- */
	const K = 13; // px per mm
	const preview = $derived.by(() => {
		const segs = segments.map((s) => ({
			h: Math.max(0.1, num(s.height, 1)),
			ru: Math.max(0.1, num(s.upperDiameter, 1)) / 2,
			rl: Math.max(0.1, num(s.lowerDiameter, 1)) / 2,
			z0: num(s.distanceToZeroLevel, 0)
		}));
		let maxR = 2.5;
		let minZ = 0;
		let maxZ = 2;
		for (const s of segs) {
			maxR = Math.max(maxR, s.ru, s.rl);
			minZ = Math.min(minZ, s.z0);
			maxZ = Math.max(maxZ, s.z0 + s.h);
		}
		const PAD = 1.6; // mm of headroom above/below
		const sideW = 70; // px per side for dimension labels
		const w = maxR * 2 * K + sideW * 2;
		const h = (maxZ - minZ + PAD * 2) * K;
		const cx = w / 2;
		const yOf = (z: number) => (maxZ + PAD - z) * K;
		const items = segs.map((s, i) => {
			const y0 = yOf(s.z0);
			const y1 = yOf(s.z0 + s.h);
			return {
				points: [
					`${cx - s.rl * K},${y0}`,
					`${cx + s.rl * K},${y0}`,
					`${cx + s.ru * K},${y1}`,
					`${cx - s.ru * K},${y1}`
				].join(' '),
				topX: cx,
				topY: y1 + 10,
				topLabel: `Ø ${(s.ru * 2).toFixed(2)}`,
				botX: cx,
				botY: y0 - 3,
				botLabel: `Ø ${(s.rl * 2).toFixed(2)}`,
				sideX: cx + maxR * K + 6,
				sideY: (y0 + y1) / 2 + 3,
				sideLabel: `S${i + 1}  h ${s.h.toFixed(2)}`,
				distX: cx - maxR * K - 6,
				distY: y0 + 3,
				distLabel: `z ${s.z0.toFixed(2)}`
			};
		});
		return { w, h, cx, zeroY: yOf(0), items };
	});
</script>

<div
	class="csw-backdrop"
	role="presentation"
	onclick={(e) => e.target === e.currentTarget && onclose()}
>
	<div class="csw-dialog panel">
		<div class="dialog-title">
			{initial?.id ? 'Edit custom sleeve system' : 'New custom sleeve system'}
			<span class="csw-step">Step {step} of 3 — {STEP_TITLES[step - 1]}</span>
		</div>

		<div class="csw-body">
			{#if step === 1}
				<div class="csw-field">
					<label for="csw-name">Name *</label>
					<input id="csw-name" bind:value={name} placeholder="e.g. MyLab Sleeve 5.0" />
				</div>
				<div class="csw-field">
					<label for="csw-manufacturer">Manufacturer</label>
					<input id="csw-manufacturer" bind:value={manufacturer} placeholder="e.g. MyLab GmbH" />
				</div>
				<div class="csw-field">
					<label for="csw-notes">Notes</label>
					<textarea id="csw-notes" rows="3" bind:value={notes} placeholder="Article numbers, drill kit, remarks…"></textarea>
				</div>
			{:else if step === 2}
				<div class="csw-geometry">
					<div class="csw-segments">
						<p class="csw-hint">
							The negative geometry is the hole subtracted from the guide: 1–3 stacked conical
							segments, each measured from the <strong>zero level</strong> (sleeve bottom).
						</p>
						{#each segments as seg, i (i)}
							<fieldset class="csw-seg">
								<legend>
									Segment {i + 1}
									{#if segments.length > 1}
										<button
											class="btn ghost csw-seg-remove"
											type="button"
											title="Remove segment"
											onclick={() => removeSegment(i)}>✕</button
										>
									{/if}
								</legend>
								<div class="csw-seg-grid">
									<label>
										Height (mm)
										<input type="number" step="0.1" min="0.5" max="20" bind:value={seg.height} />
									</label>
									<label>
										Upper Ø (mm)
										<input type="number" step="0.1" min="0.5" max="20" bind:value={seg.upperDiameter} />
									</label>
									<label>
										Lower Ø (mm)
										<input type="number" step="0.1" min="0.5" max="20" bind:value={seg.lowerDiameter} />
									</label>
									<label>
										Distance to zero level (mm)
										<input type="number" step="0.1" min="-20" max="20" bind:value={seg.distanceToZeroLevel} />
									</label>
								</div>
							</fieldset>
						{/each}
						<div class="csw-seg-actions">
							<button class="btn" type="button" disabled={segments.length >= 3} onclick={addSegment}>
								Add segment
							</button>
							<span class="csw-sum" class:bad={heightSum < 2 || heightSum > 15}>
								Σ heights {heightSum.toFixed(1)} mm (2–15)
							</span>
						</div>
						<div class="csw-propose">
							<label for="csw-drill">Target drill Ø (mm)</label>
							<input id="csw-drill" type="number" step="0.1" min="0.5" max="16" bind:value={targetDrill} />
							<button class="btn" type="button" onclick={autoPropose} title="seg 1 = drill +0.1 guide bore, seg 2 = wider body, seg 3 = flange">
								Auto-propose 3 segments
							</button>
						</div>
					</div>
					<div class="csw-preview">
						<svg
							viewBox="0 0 {preview.w} {preview.h}"
							width={preview.w}
							height={preview.h}
							role="img"
							aria-label="Cross-section preview of the sleeve hole geometry"
						>
							<!-- drill axis -->
							<line
								x1={preview.cx} y1="2" x2={preview.cx} y2={preview.h - 2}
								class="csw-axis"
							/>
							{#each preview.items as it, i (i)}
								<polygon points={it.points} class="csw-poly" />
								<text x={it.topX} y={it.topY} class="csw-dim" text-anchor="middle">{it.topLabel}</text>
								<text x={it.botX} y={it.botY} class="csw-dim" text-anchor="middle">{it.botLabel}</text>
								<text x={it.sideX} y={it.sideY} class="csw-dim">{it.sideLabel}</text>
								<text x={it.distX} y={it.distY} class="csw-dim" text-anchor="end">{it.distLabel}</text>
							{/each}
							<!-- zero level (sleeve bottom) -->
							<line x1="6" y1={preview.zeroY} x2={preview.w - 6} y2={preview.zeroY} class="csw-zero" />
							<text x={preview.w - 8} y={preview.zeroY + 11} text-anchor="end" class="csw-zero-label">
								zero level (sleeve bottom)
							</text>
						</svg>
					</div>
				</div>
			{:else}
				<div class="csw-field csw-offset">
					<label for="csw-offset">Drill offset — sleeve bottom to drill stop (mm)</label>
					<input id="csw-offset" type="number" step="0.1" min="0" max="30" bind:value={drillOffset} />
				</div>
				<table class="csw-summary">
					<tbody>
						<tr><th>Name</th><td>{name.trim() || '—'}</td></tr>
						<tr><th>Manufacturer</th><td>{manufacturer.trim() || '—'}</td></tr>
						<tr>
							<th>Segments</th>
							<td>
								{#each segments as s, i (i)}
									<div>
										S{i + 1}: Ø {num(s.lowerDiameter, 0).toFixed(2)} → Ø {num(s.upperDiameter, 0).toFixed(2)},
										h {num(s.height, 0).toFixed(2)} mm, z {num(s.distanceToZeroLevel, 0).toFixed(2)} mm
									</div>
								{/each}
							</td>
						</tr>
						<tr><th>Total height</th><td>{heightSum.toFixed(2)} mm</td></tr>
						<tr><th>Max outer Ø</th><td>{maxOuter.toFixed(2)} mm</td></tr>
						<tr><th>Drill offset</th><td>{num(drillOffset, 0).toFixed(2)} mm</td></tr>
						{#if notes.trim()}
							<tr><th>Notes</th><td>{notes.trim()}</td></tr>
						{/if}
					</tbody>
				</table>
			{/if}

			{#if errorMsg}
				<div class="csw-error">{errorMsg}</div>
			{/if}
		</div>

		<div class="dialog-actions">
			<button class="btn" type="button" onclick={onclose} disabled={saving}>Cancel</button>
			{#if step > 1}
				<button class="btn" type="button" onclick={back} disabled={saving}>Back</button>
			{/if}
			{#if step < 3}
				<button class="btn primary" type="button" onclick={next}>Next</button>
			{:else}
				<button class="btn primary" type="button" onclick={save} disabled={saving}>
					{saving ? 'Saving…' : 'Save'}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.csw-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.csw-dialog {
		min-width: 560px;
		max-width: 780px;
		max-height: 90vh;
		overflow: auto;
		box-shadow: var(--shadow);
	}
	.csw-step {
		float: right;
		font-size: 11px;
		opacity: 0.75;
		font-weight: normal;
	}
	.csw-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 12px;
	}
	.csw-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.csw-field input,
	.csw-field textarea {
		width: 100%;
	}
	.csw-hint {
		margin: 0 0 8px;
		opacity: 0.8;
	}
	.csw-geometry {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 14px;
		align-items: start;
	}
	.csw-segments {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 280px;
	}
	.csw-seg {
		border: 1px solid var(--border-soft, #444);
		border-radius: 4px;
		padding: 6px 8px 8px;
	}
	.csw-seg legend {
		padding: 0 4px;
		font-size: 11px;
	}
	.csw-seg-remove {
		padding: 0 5px;
		font-size: 10px;
		line-height: 1.4;
	}
	.csw-seg-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 10px;
	}
	.csw-seg-grid label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11px;
	}
	.csw-seg-grid input {
		width: 100%;
	}
	.csw-seg-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.csw-sum.bad {
		color: #e06a6a;
	}
	.csw-propose {
		display: flex;
		align-items: end;
		gap: 8px;
		border-top: 1px dashed var(--border-soft, #444);
		padding-top: 8px;
	}
	.csw-propose label {
		display: block;
		font-size: 11px;
	}
	.csw-propose input {
		width: 70px;
	}
	.csw-preview {
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid var(--border-soft, #444);
		border-radius: 4px;
		padding: 6px;
		display: grid;
		place-items: center;
		max-height: 420px;
		overflow: auto;
	}
	.csw-axis {
		stroke: rgba(255, 255, 255, 0.25);
		stroke-dasharray: 2 3;
	}
	.csw-poly {
		fill: rgba(77, 163, 255, 0.28);
		stroke: #4da3ff;
		stroke-width: 1;
	}
	.csw-dim {
		fill: var(--text, #ddd);
		font-size: 9px;
	}
	.csw-zero {
		stroke: #e8d44d;
		stroke-dasharray: 5 4;
	}
	.csw-zero-label {
		fill: #e8d44d;
		font-size: 8px;
	}
	.csw-offset input {
		width: 120px;
	}
	.csw-summary {
		border-collapse: collapse;
		width: 100%;
	}
	.csw-summary th {
		text-align: left;
		padding: 4px 10px 4px 0;
		vertical-align: top;
		white-space: nowrap;
		opacity: 0.75;
		font-weight: normal;
	}
	.csw-summary td {
		padding: 4px 0;
	}
	.csw-summary tr {
		border-bottom: 1px solid var(--border-soft, #333);
	}
	.csw-error {
		color: #e06a6a;
		font-size: 12px;
	}
</style>
