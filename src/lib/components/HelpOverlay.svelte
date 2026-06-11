<script lang="ts">
	/**
	 * Context-sensitive help panel (SPEC §13.3): a right-side sliding panel
	 * rendering a topic from $lib/helpContent. Self-contained — host pages
	 * decide when to mount it (per-dialog "?" buttons, F1 toggle).
	 */
	import { HELP } from '$lib/helpContent';

	let { topic, onclose }: { topic: string; onclose: () => void } = $props();

	const entry = $derived(HELP[topic] ?? HELP['dentaldb']);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}
</script>

<svelte:window {onkeydown} />

<button class="help-backdrop" aria-label="Close help" onclick={onclose}></button>

<aside class="help-panel" aria-label="Help: {entry.title}">
	<header class="help-head">
		<span class="help-kicker">Help</span>
		<h2 class="help-title">{entry.title}</h2>
		<button class="help-close" aria-label="Close help" onclick={onclose}>×</button>
	</header>

	<div class="help-body">
		{#each entry.body as para (para)}
			<p>{para}</p>
		{/each}
	</div>

	<footer class="help-foot">
		<a class="help-site" href="/manual">Open the full manual ↗</a>
		<span class="help-hint">F1 toggles help · Esc closes</span>
	</footer>
</aside>

<style>
	.help-backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgba(0, 0, 0, 0.35);
		border: none;
		padding: 0;
		margin: 0;
		cursor: default;
	}
	.help-panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 91;
		width: min(380px, 90vw);
		display: flex;
		flex-direction: column;
		background: var(--bg-2);
		border-left: 1px solid var(--border);
		box-shadow: var(--shadow);
		animation: help-slide-in 0.18s ease-out;
	}
	@keyframes help-slide-in {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}
	.help-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	.help-kicker {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--accent-bright);
	}
	.help-title {
		flex: 1;
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
	}
	.help-close {
		background: transparent;
		border: none;
		color: var(--text-dim);
		font-size: 18px;
		line-height: 1;
		padding: 2px 6px;
		border-radius: var(--radius);
		cursor: pointer;
		align-self: center;
	}
	.help-close:hover {
		background: var(--bg-3);
		color: var(--text);
	}
	.help-body {
		flex: 1;
		overflow-y: auto;
		padding: 14px 16px;
	}
	.help-body p {
		margin: 0 0 12px;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--text);
	}
	.help-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		border-top: 1px solid var(--border-soft);
	}
	.help-site {
		color: var(--accent-bright);
		font-size: 12px;
		text-decoration: none;
	}
	.help-site:hover {
		text-decoration: underline;
	}
	.help-hint {
		font-size: 10.5px;
		color: var(--text-faint);
	}
</style>
