<script lang="ts">
	import {
		FDI_LOWER,
		FDI_UPPER,
		toothLabel,
		virtualToothOutline,
		virtualToothTemplate,
		type Notation
	} from '$lib/implantLibrary';

	let {
		notation,
		onpick,
		onclose
	}: {
		notation: Notation; // 'fdi' | 'universal'
		onpick: (tooth: number) => void;
		onclose: () => void;
	} = $props();

	/** mini crown outline as an SVG path, fitted into a 34×34 box */
	function miniPath(tooth: number): string {
		const pts = virtualToothOutline(tooth);
		if (!pts.length) return '';
		const tpl = virtualToothTemplate(tooth)!;
		const s = 30 / Math.max(tpl.widthMM, tpl.heightMM);
		const cx = 17,
			cy = 17;
		return (
			pts
				.map((p, i) => `${i === 0 ? 'M' : 'L'}${(cx + p.x * s).toFixed(1)},${(cy - p.y * s).toFixed(1)}`)
				.join(' ') + ' Z'
		);
	}
</script>

<div class="vt-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="vt-dialog panel">
		<div class="dialog-title">Add virtual tooth</div>
		<div class="vt-body">
			<p class="vt-hint">
				Prosthetic-driven planning: pick the tooth position to place a library crown shape, then
				plan the implant under it.
			</p>
			{#each [FDI_UPPER, FDI_LOWER] as row, ri (ri)}
				<div class="vt-row" aria-label={ri === 0 ? 'Maxilla' : 'Mandible'}>
					{#each row as t (t)}
						<button class="vt-tooth" title="Tooth {toothLabel(t, notation)}" onclick={() => onpick(t)}>
							<svg viewBox="0 0 34 34" width="34" height="34">
								<path d={miniPath(t)} />
							</svg>
							<span>{toothLabel(t, notation)}</span>
						</button>
					{/each}
				</div>
				{#if ri === 0}<div class="vt-gap"></div>{/if}
			{/each}
		</div>
		<div class="dialog-actions">
			<button class="btn" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.vt-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.vt-dialog {
		box-shadow: var(--shadow);
	}
	.vt-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.vt-hint {
		margin: 0 0 6px;
		font-size: 12px;
		color: var(--text-dim, #9aa4b0);
	}
	.vt-row {
		display: flex;
		gap: 3px;
	}
	.vt-gap {
		height: 10px;
		border-bottom: 1px dashed var(--border-soft, #2d333b);
		margin-bottom: 10px;
	}
	.vt-tooth {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 4px 3px;
		background: transparent;
		border: 1px solid var(--border-soft, #2d333b);
		border-radius: 5px;
		color: var(--text, #dde3ea);
		font-size: 10px;
		cursor: pointer;
	}
	.vt-tooth:hover {
		border-color: #5b8fd4;
		background: rgba(91, 143, 212, 0.12);
	}
	.vt-tooth path {
		fill: rgba(221, 227, 234, 0.12);
		stroke: var(--text-dim, #9aa4b0);
		stroke-width: 1.2;
	}
	.vt-tooth:hover path {
		stroke: #5b8fd4;
	}
</style>
