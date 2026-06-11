<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const STEPS = [
		{
			icon: 'patient',
			title: 'Welcome to coDiagnostiX Web',
			body: 'Everything starts with a patient. Create patients on the home screen, then add a case per treatment — each case holds DICOM data, models and surgical plans.'
		},
		{
			icon: 'volume',
			title: 'Plan in stages',
			body: 'Inside a case you move through the planning stages: import CT data, segment the anatomy, trace nerves, place implants and finally generate the surgical guide.'
		},
		{
			icon: 'settings',
			title: 'EXPERT vs EASY mode',
			body: 'EXPERT mode exposes every tool and viewer layout; EASY mode walks you through a guided, step-by-step workflow. Switch any time from the toolbar — your choice is saved per account.'
		},
		{
			icon: 'case',
			title: 'Try the demo case',
			body: 'A pre-loaded demo case with a synthetic CT volume is ready on the home screen. Open it to explore the viewers and place a first implant without touching real patient data.'
		}
	];

	let step = $state(0);

	function finish(): void {
		localStorage.setItem('cdx_tour_done', '1');
		onclose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && finish()} />

<div class="tour-backdrop" role="presentation">
	<div class="tour-dialog panel" role="dialog" aria-modal="true" aria-label="Getting started tour">
		<div class="dialog-title">Getting started ({step + 1}/{STEPS.length})</div>
		<div class="tour-body">
			<div class="tour-icon"><Icon name={STEPS[step].icon} size={36} /></div>
			<h3>{STEPS[step].title}</h3>
			<p>{STEPS[step].body}</p>
			<div class="tour-dots">
				{#each STEPS as s, i (s.title)}
					<button
						type="button"
						class="tour-dot"
						class:active={i === step}
						aria-label={`Step ${i + 1}`}
						onclick={() => (step = i)}
					></button>
				{/each}
			</div>
		</div>
		<div class="tour-actions">
			<button class="btn ghost" type="button" onclick={finish}>Skip tour</button>
			<div class="tour-nav">
				{#if step > 0}
					<button class="btn" type="button" onclick={() => (step -= 1)}>Back</button>
				{/if}
				{#if step < STEPS.length - 1}
					<button class="btn primary" type="button" onclick={() => (step += 1)}>Next</button>
				{:else}
					<button class="btn primary" type="button" onclick={finish}>Get started</button>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.tour-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 150;
	}
	.tour-dialog {
		width: 420px;
		box-shadow: var(--shadow);
	}
	.tour-body {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 10px;
		min-height: 190px;
	}
	.tour-icon {
		color: var(--accent-bright);
	}
	h3 {
		margin: 0;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.55;
	}
	.tour-dots {
		display: flex;
		gap: 8px;
		margin-top: auto;
	}
	.tour-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--bg-3);
		padding: 0;
		cursor: pointer;
	}
	.tour-dot.active {
		background: var(--accent-bright);
		border-color: var(--accent-bright);
	}
	.tour-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px;
		border-top: 1px solid var(--border-soft);
	}
	.tour-nav {
		display: flex;
		gap: 8px;
	}
</style>
