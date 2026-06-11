<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { children }: { children: Snippet } = $props();

	// null = not yet checked (SSR / first paint), then true/false after the browser check.
	// During SSR we render the children so the page streams normally; the gate only
	// drops in when the client-side probe actually fails.
	let supported = $state<boolean | null>(null);

	$effect(() => {
		supported = !!document.createElement('canvas').getContext('webgl2');
	});
</script>

{#if supported === false}
	<div class="webgl-gate">
		<div class="webgl-card panel">
			<div class="webgl-icon"><Icon name="warning" size={40} /></div>
			<h2>3D acceleration unavailable</h2>
			<p>
				coDiagnostiX Web needs <strong>WebGL2</strong> to render CT volumes, models and implant plans, but your
				browser could not create a WebGL2 context.
			</p>
			<ul>
				<li>Update your browser — all current versions of Chrome, Edge, Firefox and Safari support WebGL2.</li>
				<li>Check that hardware acceleration is enabled in the browser settings.</li>
				<li>Update your graphics drivers, or try another device.</li>
			</ul>
		</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.webgl-gate {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		background: var(--bg-0);
		padding: 24px;
	}
	.webgl-card {
		max-width: 480px;
		padding: 28px 32px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.webgl-icon {
		color: var(--accent-2);
	}
	h2 {
		margin: 0;
	}
	p,
	li {
		font-size: 13px;
		color: var(--text-dim);
		line-height: 1.5;
	}
	ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
