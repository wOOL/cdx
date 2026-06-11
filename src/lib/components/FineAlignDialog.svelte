<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Fine Alignment dialog (SPEC §2.2 step 6): numeric-step nudges for a
	 * model scan (or implant). Emits single-axis deltas only — the PARENT
	 * composes the actual matrix, interpreting the delta in the requested
	 * frame: 'patient' = volume axes, 'object' = mesh local axes.
	 */
	interface NudgeDelta {
		tx: number;
		ty: number;
		tz: number;
		rx: number;
		ry: number;
		rz: number;
	}

	let {
		name,
		onnudge,
		onclose
	}: {
		name: string;
		onnudge: (delta: NudgeDelta, frame: 'patient' | 'object') => void;
		onclose: () => void;
	} = $props();

	let tStep = $state(0.5); // mm
	let rStep = $state(1); // degrees
	let frame = $state<'patient' | 'object'>('patient');

	// non-modal floating panel, parked on the right edge of the viewport
	const PANEL_W = 264;
	let pos = $state({ x: 60, y: 96 });
	onMount(() => {
		pos = { x: Math.max(8, window.innerWidth - PANEL_W - 24), y: 96 };
	});

	// ---- header drag (simple pointer capture) ----
	let drag: { dx: number; dy: number } | null = null;
	function onHeaderDown(e: PointerEvent): void {
		if ((e.target as HTMLElement).closest('button')) return; // close button
		drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onHeaderMove(e: PointerEvent): void {
		if (!drag) return;
		pos = {
			x: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.dx)),
			y: Math.max(0, Math.min(window.innerHeight - 32, e.clientY - drag.dy))
		};
	}
	function onHeaderUp(): void {
		drag = null;
	}

	type Axis = 'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz';
	function nudge(axis: Axis, sign: 1 | -1): void {
		const delta: NudgeDelta = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
		delta[axis] = sign * (axis.startsWith('t') ? tStep : rStep);
		onnudge(delta, frame);
	}

	const T_ROWS: { axis: Axis; label: string }[] = [
		{ axis: 'tx', label: 'X' },
		{ axis: 'ty', label: 'Y' },
		{ axis: 'tz', label: 'Z' }
	];
	const R_ROWS: { axis: Axis; label: string }[] = [
		{ axis: 'rx', label: 'rX' },
		{ axis: 'ry', label: 'rY' },
		{ axis: 'rz', label: 'rZ' }
	];
</script>

<div class="fa-panel panel" style="left:{pos.x}px; top:{pos.y}px; width:{PANEL_W}px">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fa-header panel-header"
		onpointerdown={onHeaderDown}
		onpointermove={onHeaderMove}
		onpointerup={onHeaderUp}
		onpointercancel={onHeaderUp}
	>
		<span class="fa-title" title={name}>Fine alignment — {name}</span>
		<button class="btn ghost fa-close" onclick={onclose} title="Close" aria-label="Close">✕</button>
	</div>

	<div class="fa-body">
		<div class="fa-frame" role="radiogroup" aria-label="Reference frame">
			<label class="fa-radio">
				<input type="radio" name="fa-frame" value="patient" bind:group={frame} />
				Patient-oriented (volume axes)
			</label>
			<label class="fa-radio">
				<input type="radio" name="fa-frame" value="object" bind:group={frame} />
				Object-oriented (mesh axes)
			</label>
		</div>

		<div class="fa-section">
			<div class="fa-section-head">
				<span>Translation</span>
				<label class="fa-step">
					step
					<input type="number" min="0.01" step="0.1" bind:value={tStep} />
					mm
				</label>
			</div>
			<div class="fa-grid">
				{#each T_ROWS as row (row.axis)}
					<span class="fa-axis">{row.label}</span>
					<button class="btn" onclick={() => nudge(row.axis, -1)}>−{row.label}</button>
					<button class="btn" onclick={() => nudge(row.axis, 1)}>+{row.label}</button>
				{/each}
			</div>
		</div>

		<div class="fa-section">
			<div class="fa-section-head">
				<span>Rotation</span>
				<label class="fa-step">
					step
					<input type="number" min="0.01" step="0.5" bind:value={rStep} />
					°
				</label>
			</div>
			<div class="fa-grid">
				{#each R_ROWS as row (row.axis)}
					<span class="fa-axis">{row.label}</span>
					<button class="btn" onclick={() => nudge(row.axis, -1)}>−{row.label}</button>
					<button class="btn" onclick={() => nudge(row.axis, 1)}>+{row.label}</button>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.fa-panel {
		position: fixed;
		z-index: 90; /* floating tool panel — below modal dialogs (100) */
		box-shadow: var(--shadow);
	}
	.fa-header {
		cursor: move;
		user-select: none;
		touch-action: none;
		justify-content: space-between;
	}
	.fa-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fa-close {
		padding: 0 6px;
		line-height: 1.4;
	}
	.fa-body {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.fa-frame {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fa-radio {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text);
	}
	.fa-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fa-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.fa-step {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.fa-step input {
		width: 56px;
		background: var(--bg-1);
		color: var(--text);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 12px;
	}
	.fa-grid {
		display: grid;
		grid-template-columns: 24px 1fr 1fr;
		gap: 6px;
		align-items: center;
	}
	.fa-axis {
		font-size: 12px;
		color: var(--text-dim);
		text-align: right;
		padding-right: 2px;
	}
	.fa-grid .btn {
		padding: 4px 0;
		font-size: 12px;
	}
</style>
