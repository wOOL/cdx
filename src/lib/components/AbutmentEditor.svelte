<script module lang="ts">
	export type { UserAbutment } from '$lib/implantLibrary';
</script>

<script lang="ts">
	import type { UserAbutment } from '$lib/implantLibrary';

	let {
		initial = null,
		onsave,
		onclose
	}: {
		initial?: UserAbutment | null;
		onsave: (a: UserAbutment) => void;
		onclose: () => void;
	} = $props();

	// valid ranges
	const H_MIN = 0.5,
		H_MAX = 8,
		D_MIN = 1,
		D_MAX = 8,
		INC_MAX = 45,
		SEG_MAX = 4;

	let name = $state(initial?.name ?? 'Custom abutment');
	let segments = $state<{ height: number; lowerD: number; upperD: number }[]>(
		initial?.segments.map((s) => ({ ...s })) ?? [
			{ height: 2, lowerD: 4.5, upperD: 5.5 }, // emergence profile
			{ height: 4, lowerD: 5.0, upperD: 4.0 } // mesostructure
		]
	);
	let inclination = $state(initial?.inclination ?? 0);
	let rotation = $state(initial?.rotation ?? 0);

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
	const r1 = (v: number) => Math.round(v * 10) / 10;

	const totalH = $derived(segments.reduce((s, x) => s + x.height, 0));
	const maxD = $derived(segments.reduce((d, x) => Math.max(d, x.lowerD, x.upperD), 0));
	const valid = $derived(
		name.trim().length > 0 &&
			segments.length >= 1 &&
			segments.length <= SEG_MAX &&
			inclination >= 0 &&
			inclination <= INC_MAX &&
			segments.every(
				(s) =>
					s.height >= H_MIN && s.height <= H_MAX &&
					s.lowerD >= D_MIN && s.lowerD <= D_MAX &&
					s.upperD >= D_MIN && s.upperD <= D_MAX
			)
	);

	// ------- SVG preview (side profile, implant shoulder at the bottom) -------
	const W = 280,
		H = 320;
	const baseX = W / 2,
		baseY = H - 36;
	const pxPerMM = $derived(Math.min(18, 240 / Math.max(totalH, maxD, 6)));

	/** cumulative bottom y (mm) of each segment */
	const bottoms = $derived.by(() => {
		const out: number[] = [];
		let acc = 0;
		for (const s of segments) {
			out.push(acc);
			acc += s.height;
		}
		return out;
	});

	function toPx(mmX: number, mmY: number): { x: number; y: number } {
		return { x: baseX + mmX * pxPerMM, y: baseY - mmY * pxPerMM };
	}

	interface Drag {
		seg: number;
		end: 'top' | 'bottom';
	}
	let svgEl = $state<SVGSVGElement | null>(null);
	let drag = $state<Drag | null>(null);

	/** client → local mm (inverse of the inclination tilt about the base point) */
	function pointerMM(e: PointerEvent): { mmX: number; mmY: number } {
		const rect = svgEl!.getBoundingClientRect();
		const sx = ((e.clientX - rect.left) / rect.width) * W;
		const sy = ((e.clientY - rect.top) / rect.height) * H;
		const a = (inclination * Math.PI) / 180;
		const dx = sx - baseX;
		const dy = sy - baseY;
		// SVG rotate(inclination) is clockwise; invert it
		const ux = dx * Math.cos(a) + dy * Math.sin(a);
		const uy = -dx * Math.sin(a) + dy * Math.cos(a);
		return { mmX: ux / pxPerMM, mmY: -uy / pxPerMM };
	}

	function startDrag(e: PointerEvent, seg: number, end: 'top' | 'bottom') {
		drag = { seg, end };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		e.preventDefault();
	}
	function moveDrag(e: PointerEvent) {
		if (!drag || !svgEl) return;
		const { mmX, mmY } = pointerMM(e);
		const s = segments[drag.seg];
		const d = r1(clamp(Math.abs(mmX) * 2, D_MIN, D_MAX));
		if (drag.end === 'bottom') {
			s.lowerD = d;
		} else {
			s.upperD = d;
			s.height = r1(clamp(mmY - bottoms[drag.seg], H_MIN, H_MAX));
		}
	}
	function endDrag() {
		drag = null;
	}

	function addSegment() {
		if (segments.length >= SEG_MAX) return;
		const last = segments[segments.length - 1];
		segments.push({ height: 2, lowerD: last.upperD, upperD: r1(clamp(last.upperD - 0.5, D_MIN, D_MAX)) });
	}
	function removeSegment(i: number) {
		if (segments.length <= 1) return;
		segments.splice(i, 1);
	}

	function save() {
		if (!valid) return;
		onsave({
			name: name.trim(),
			segments: segments.map((s) => ({ ...s })),
			inclination,
			rotation
		});
	}
</script>

<div class="ae-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="ae-dialog panel">
		<div class="dialog-title">User-defined abutment</div>
		<div class="ae-body">
			<div class="ae-left">
				<label class="ae-field">
					Name
					<input bind:value={name} maxlength="60" />
				</label>
				<div class="ae-seg-head">
					<span>Segments (bottom → top: emergence profile, mesostructure)</span>
					<button class="btn ghost" disabled={segments.length >= SEG_MAX} onclick={addSegment}>
						+ segment
					</button>
				</div>
				<table class="ae-table">
					<thead>
						<tr><th>#</th><th>Height (mm)</th><th>Lower Ø</th><th>Upper Ø</th><th></th></tr>
					</thead>
					<tbody>
						{#each segments as s, i (i)}
							<tr>
								<td>{i + 1}</td>
								<td>
									<input
										type="number" min={H_MIN} max={H_MAX} step="0.1" value={s.height}
										oninput={(e) => (s.height = clamp(Number(e.currentTarget.value) || H_MIN, H_MIN, H_MAX))}
									/>
								</td>
								<td>
									<input
										type="number" min={D_MIN} max={D_MAX} step="0.1" value={s.lowerD}
										oninput={(e) => (s.lowerD = clamp(Number(e.currentTarget.value) || D_MIN, D_MIN, D_MAX))}
									/>
								</td>
								<td>
									<input
										type="number" min={D_MIN} max={D_MAX} step="0.1" value={s.upperD}
										oninput={(e) => (s.upperD = clamp(Number(e.currentTarget.value) || D_MIN, D_MIN, D_MAX))}
									/>
								</td>
								<td>
									<button class="btn ghost" disabled={segments.length <= 1} onclick={() => removeSegment(i)}>
										✕
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<label class="ae-field">
					Inclination {inclination.toFixed(0)}°
					<input type="range" min="0" max={INC_MAX} step="1" bind:value={inclination} />
				</label>
				<label class="ae-field">
					Rotation (° around implant axis)
					<input
						type="number" min="0" max="359" step="1" value={rotation}
						oninput={(e) => (rotation = ((Number(e.currentTarget.value) || 0) % 360 + 360) % 360)}
					/>
				</label>
				<p class="ae-note">
					Total height {totalH.toFixed(1)} mm · widest Ø {maxD.toFixed(1)} mm. Valid ranges:
					height {H_MIN}–{H_MAX} mm, Ø {D_MIN}–{D_MAX} mm, inclination 0–{INC_MAX}°.
					Drag the corner handles in the preview to shape the profile.
				</p>
			</div>
			<svg
				bind:this={svgEl}
				class="ae-preview"
				viewBox="0 0 {W} {H}"
				width={W}
				height={H}
				role="application"
				aria-label="Abutment side-profile preview — drag corner handles to shape segments"
				onpointermove={moveDrag}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			>
				<!-- implant shoulder reference -->
				<line x1={baseX - 50} y1={baseY} x2={baseX + 50} y2={baseY} class="ae-shoulder" />
				<text x={baseX + 54} y={baseY + 4} class="ae-axis-label">shoulder</text>
				<g transform="rotate({inclination}, {baseX}, {baseY})">
					<line x1={baseX} y1={baseY} x2={baseX} y2={baseY - (totalH + 2) * pxPerMM} class="ae-axis" />
					{#each segments as s, i (i)}
						{@const b = bottoms[i]}
						{@const p1 = toPx(-s.lowerD / 2, b)}
						{@const p2 = toPx(s.lowerD / 2, b)}
						{@const p3 = toPx(s.upperD / 2, b + s.height)}
						{@const p4 = toPx(-s.upperD / 2, b + s.height)}
						<polygon
							points="{p1.x},{p1.y} {p2.x},{p2.y} {p3.x},{p3.y} {p4.x},{p4.y}"
							class="ae-seg"
							class:emergence={i === 0}
						/>
						<!-- drag handles: bottom corners → lower Ø, top corners → upper Ø + height -->
						{#each [p1, p2] as p, k (k)}
							<circle
								cx={p.x} cy={p.y} r="5" class="ae-handle"
								role="button" aria-label="Segment {i + 1} lower diameter handle" tabindex={-1}
								onpointerdown={(e) => startDrag(e, i, 'bottom')}
							/>
						{/each}
						{#each [p3, p4] as p, k (k)}
							<circle
								cx={p.x} cy={p.y} r="5" class="ae-handle top"
								role="button" aria-label="Segment {i + 1} upper diameter and height handle" tabindex={-1}
								onpointerdown={(e) => startDrag(e, i, 'top')}
							/>
						{/each}
					{/each}
				</g>
			</svg>
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose}>Cancel</button>
			<button class="btn primary" disabled={!valid} onclick={save}>Save abutment</button>
		</div>
	</div>
</div>

<style>
	.ae-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.ae-dialog {
		box-shadow: var(--shadow);
	}
	.ae-body {
		padding: 14px 16px;
		display: flex;
		gap: 18px;
	}
	.ae-left {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 330px;
	}
	.ae-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}
	.ae-seg-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		color: var(--text-dim, #9aa4b0);
	}
	.ae-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.ae-table th,
	.ae-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 4px 6px;
		text-align: left;
	}
	.ae-table input {
		width: 62px;
	}
	.ae-note {
		margin: 0;
		font-size: 11px;
		color: var(--text-dim, #9aa4b0);
	}
	.ae-preview {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border-soft, #2d333b);
		border-radius: 6px;
		touch-action: none;
	}
	.ae-shoulder {
		stroke: var(--text-dim, #9aa4b0);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
	}
	.ae-axis {
		stroke: var(--border, #3a414b);
		stroke-width: 1;
		stroke-dasharray: 2 3;
	}
	.ae-axis-label {
		fill: var(--text-dim, #9aa4b0);
		font-size: 9px;
	}
	.ae-seg {
		fill: rgba(181, 154, 212, 0.3);
		stroke: #b59ad4;
		stroke-width: 1.2;
	}
	.ae-seg.emergence {
		fill: rgba(196, 168, 220, 0.45);
	}
	.ae-handle {
		fill: #f08a24;
		stroke: #0b0d10;
		stroke-width: 1;
		cursor: ew-resize;
	}
	.ae-handle.top {
		cursor: move;
	}
</style>
