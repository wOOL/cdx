<script lang="ts">
	/**
	 * Rotational-alignment dial: drag the handle around the implant axis to set
	 * the abutment rotation. Snaps to 5°; hold Shift for fine 1° steps.
	 * 0° points up (12 o'clock), increasing clockwise.
	 */
	let { rotation, onrotate }: { rotation: number; onrotate: (deg: number) => void } = $props();

	const SIZE = 160;
	const C = SIZE / 2;
	const R = 62;

	let svgEl = $state<SVGSVGElement | null>(null);
	let dragging = $state(false);

	const normDeg = (d: number) => ((d % 360) + 360) % 360;
	const handle = $derived.by(() => {
		const a = ((normDeg(rotation) - 90) * Math.PI) / 180;
		return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
	});

	function angleFromPointer(e: PointerEvent): number {
		if (!svgEl) return rotation;
		const rect = svgEl.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * SIZE - C;
		const y = ((e.clientY - rect.top) / rect.height) * SIZE - C;
		if (Math.hypot(x, y) < 4) return rotation;
		// 0° at top, clockwise positive
		return normDeg((Math.atan2(y, x) * 180) / Math.PI + 90);
	}

	function applyPointer(e: PointerEvent) {
		const raw = angleFromPointer(e);
		const step = e.shiftKey ? 1 : 5;
		onrotate(normDeg(Math.round(raw / step) * step) % 360);
	}

	function down(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		applyPointer(e);
	}
	function move(e: PointerEvent) {
		if (dragging) applyPointer(e);
	}
	function up() {
		dragging = false;
	}

	function onInput(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value);
		if (Number.isFinite(v)) onrotate(normDeg(v));
	}
</script>

<div class="ard-wrap">
	<svg
		bind:this={svgEl}
		viewBox="0 0 {SIZE} {SIZE}"
		width={SIZE}
		height={SIZE}
		class="ard-dial"
		class:dragging
		role="slider"
		aria-label="Abutment rotation"
		aria-valuemin={0}
		aria-valuemax={359}
		aria-valuenow={Math.round(normDeg(rotation))}
		tabindex="0"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onkeydown={(e) => {
			const step = e.shiftKey ? 1 : 5;
			if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onrotate(normDeg(rotation + step));
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onrotate(normDeg(rotation - step));
		}}
	>
		<circle cx={C} cy={C} r={R} class="ard-ring" />
		<!-- tick marks every 30° -->
		{#each Array.from({ length: 12 }, (_, i) => i * 30) as t (t)}
			{@const a = ((t - 90) * Math.PI) / 180}
			<line
				x1={C + (R - 6) * Math.cos(a)}
				y1={C + (R - 6) * Math.sin(a)}
				x2={C + R * Math.cos(a)}
				y2={C + R * Math.sin(a)}
				class="ard-tick"
				class:major={t % 90 === 0}
			/>
		{/each}
		<!-- implant axis marker (center) -->
		<circle cx={C} cy={C} r={9} class="ard-axis" />
		<text x={C} y={C + 3.5} class="ard-axis-label">⌀</text>
		<!-- rotation pointer -->
		<line x1={C} y1={C} x2={handle.x} y2={handle.y} class="ard-pointer" />
		<circle cx={handle.x} cy={handle.y} r={7} class="ard-handle" />
		<text x={C} y={SIZE - 6} class="ard-readout">{normDeg(rotation).toFixed(0)}°</text>
	</svg>
	<label class="ard-num">
		Rotation
		<input
			type="number"
			min="0"
			max="359"
			step="1"
			value={Math.round(normDeg(rotation))}
			oninput={onInput}
		/>
		<span class="ard-note">drag = 5° steps · Shift = 1°</span>
	</label>
</div>

<style>
	.ard-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.ard-dial {
		cursor: grab;
		touch-action: none;
		outline: none;
	}
	.ard-dial.dragging {
		cursor: grabbing;
	}
	.ard-dial:focus-visible .ard-ring {
		stroke: #5b8fd4;
	}
	.ard-ring {
		fill: rgba(255, 255, 255, 0.03);
		stroke: var(--border, #3a414b);
		stroke-width: 2;
	}
	.ard-tick {
		stroke: var(--border-soft, #2d333b);
		stroke-width: 1;
	}
	.ard-tick.major {
		stroke: var(--text-dim, #9aa4b0);
		stroke-width: 1.5;
	}
	.ard-axis {
		fill: rgba(181, 154, 212, 0.25);
		stroke: #b59ad4;
		stroke-width: 1.2;
	}
	.ard-axis-label {
		fill: #b59ad4;
		font-size: 9px;
		text-anchor: middle;
		pointer-events: none;
	}
	.ard-pointer {
		stroke: #d8c2f0;
		stroke-width: 2;
		pointer-events: none;
	}
	.ard-handle {
		fill: #f08a24;
		stroke: #0b0d10;
		stroke-width: 1;
	}
	.ard-readout {
		fill: var(--text, #dde3ea);
		font-size: 12px;
		text-anchor: middle;
		pointer-events: none;
	}
	.ard-num {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
	}
	.ard-num input {
		width: 64px;
	}
	.ard-note {
		font-size: 11px;
		color: var(--text-dim, #9aa4b0);
	}
</style>
