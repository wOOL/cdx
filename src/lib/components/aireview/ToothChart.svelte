<script lang="ts">
	/**
	 * FDI tooth chart of the AI review dialog: upper row 18 → 28, lower row
	 * 48 → 38, a tooth glyph per position and a toggle circle per detected
	 * tooth (absent positions render faint and unclickable).
	 */
	import { FDI_LOWER, FDI_UPPER } from '$lib/aiReviewMap';
	import type { ToothEntry } from './overlay';

	let {
		teeth,
		ontoggle
	}: {
		teeth: Record<number, ToothEntry | undefined>;
		ontoggle: (fdi: number) => void;
	} = $props();

	// tooth glyph by FDI position digit: 1-2 incisor, 3 canine, 4-5 premolar, 6-8 molar
	function glyphPath(fdi: number): string {
		const p = fdi % 10;
		if (p <= 2) return 'M7 2 Q12 0 17 2 L16 16 Q12 20 8 16 Z'; // incisor
		if (p === 3) return 'M7 3 Q12 -1 17 3 L15 14 Q12 21 9 14 Z'; // canine
		if (p <= 5) return 'M5 4 Q12 0 19 4 L18 14 Q12 20 6 14 Z'; // premolar
		return 'M4 4 Q12 0 20 4 L19 13 Q16 19 12 16 Q8 19 5 13 Z'; // molar
	}

	function stateClass(fdi: number): string {
		const t = teeth[fdi];
		if (!t) return 'absent';
		if (!t.ok) return 'broken';
		return t.selected ? 'selected' : 'deselected';
	}
</script>

{#snippet row(fdis: number[], upper: boolean)}
	<div class="tc-row" class:tc-lower={!upper}>
		{#each fdis as fdi (fdi)}
			{@const t = teeth[fdi]}
			<div class="tc-cell">
				{#if upper}<span class="tc-num">{fdi}</span>{/if}
				{#if !upper}
					<button
						class="tc-toggle {stateClass(fdi)}"
						disabled={!t || !t.ok}
						onclick={() => ontoggle(fdi)}
						title={t ? `Tooth ${fdi} — ${t.selected ? 'selected' : 'deselected'}` : `Tooth ${fdi} — not detected`}
						aria-label="Toggle tooth {fdi}"
					></button>
				{/if}
				<svg class="tc-glyph {stateClass(fdi)}" viewBox="0 0 24 22" class:flip={!upper}>
					<path d={glyphPath(fdi)} />
				</svg>
				{#if upper}
					<button
						class="tc-toggle {stateClass(fdi)}"
						disabled={!t || !t.ok}
						onclick={() => ontoggle(fdi)}
						title={t ? `Tooth ${fdi} — ${t.selected ? 'selected' : 'deselected'}` : `Tooth ${fdi} — not detected`}
						aria-label="Toggle tooth {fdi}"
					></button>
				{/if}
				{#if !upper}<span class="tc-num">{fdi}</span>{/if}
			</div>
		{/each}
	</div>
{/snippet}

<div class="tc-chart">
	{@render row(FDI_UPPER, true)}
	{@render row(FDI_LOWER, false)}
</div>

<style>
	.tc-chart {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 4px;
	}
	.tc-row {
		display: grid;
		grid-template-columns: repeat(16, 1fr);
		gap: 2px;
	}
	.tc-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		min-width: 0;
	}
	.tc-num {
		font-size: 10px;
		color: var(--text-dim);
	}
	.tc-glyph {
		width: 22px;
		height: 20px;
	}
	.tc-glyph.flip {
		transform: scaleY(-1);
	}
	.tc-glyph path {
		fill: var(--bg-3);
		stroke: var(--border);
		stroke-width: 1;
	}
	.tc-glyph.selected path {
		fill: #e8e2d2;
		stroke: var(--accent-bright);
	}
	.tc-glyph.deselected path {
		fill: var(--bg-3);
		stroke: var(--text-dim);
	}
	.tc-glyph.broken path {
		fill: var(--bg-2);
		stroke: var(--red);
		stroke-dasharray: 2 2;
	}
	.tc-glyph.absent path {
		fill: var(--bg-2);
		stroke: var(--border-soft);
	}
	.tc-toggle {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		border: 1.5px solid var(--accent);
		background: transparent;
		padding: 0;
		cursor: pointer;
	}
	.tc-toggle.selected {
		background: var(--accent-bright);
		border-color: var(--accent-bright);
	}
	.tc-toggle.broken {
		border-color: var(--red);
	}
	.tc-toggle.absent,
	.tc-toggle:disabled {
		border-color: var(--border-soft);
		cursor: default;
	}
</style>
