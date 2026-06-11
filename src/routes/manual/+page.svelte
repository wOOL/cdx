<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	let active = $state(data.chapters[0]?.id ?? '');

	function scrollTo(id: string) {
		active = id;
		document.getElementById(`ch-${id}`)?.scrollIntoView({ behavior: 'smooth' });
	}
</script>

<svelte:head>
	<title>Manual — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">User manual</div>
	<div class="spacer"></div>
	<button class="btn" onclick={() => window.print()}><Icon name="report" size={14} /> Print</button>
</header>

<div class="manual-layout">
	<nav class="manual-toc panel no-print">
		<div class="panel-header">Contents</div>
		<div class="toc-list">
			{#each data.chapters as ch (ch.id)}
				<button class="toc-item" class:toc-active={active === ch.id} onclick={() => scrollTo(ch.id)}>
					{ch.title}
				</button>
			{/each}
		</div>
	</nav>

	<main class="manual-body">
		{#if !data.chapters.length}
			<p class="muted">
				Manual sources not found on this server (docs/manual). Set CDX_MANUAL_DIR to the manual
				directory.
			</p>
		{/if}
		{#each data.chapters as ch (ch.id)}
			<article id={`ch-${ch.id}`} class="manual-chapter panel">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted, server-rendered from bundled markdown -->
				{@html ch.html}
			</article>
		{/each}
	</main>
</div>

<style>
	.appbar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 16px;
		height: 48px;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.brand {
		font-size: 17px;
		font-weight: 700;
	}
	.brand-x {
		color: var(--accent-bright);
		font-weight: 400;
	}
	.brand-web {
		font-size: 10px;
		color: var(--accent-2);
		vertical-align: super;
		margin-left: 3px;
		font-weight: 600;
		text-transform: uppercase;
	}
	.appbar-sub {
		color: var(--text-dim);
		border-left: 1px solid var(--border);
		padding-left: 14px;
	}
	.spacer {
		flex: 1;
	}
	.manual-layout {
		flex: 1;
		display: flex;
		gap: 16px;
		padding: 16px;
		overflow: hidden;
	}
	.manual-toc {
		width: 280px;
		flex: none;
		overflow-y: auto;
	}
	.toc-list {
		display: flex;
		flex-direction: column;
		padding: 6px;
	}
	.toc-item {
		text-align: left;
		padding: 7px 10px;
		border-radius: var(--radius);
		color: var(--text-dim);
		font-size: 12px;
	}
	.toc-item:hover {
		background: var(--bg-3);
		color: var(--text);
	}
	.toc-active {
		color: var(--accent-bright);
		background: var(--bg-3);
	}
	.manual-body {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		scroll-behavior: smooth;
	}
	.manual-chapter {
		padding: 24px 32px;
		max-width: 880px;
		line-height: 1.6;
	}
	.manual-chapter :global(h1) {
		font-size: 22px;
		border-bottom: 2px solid var(--accent-dim);
		padding-bottom: 8px;
		margin-bottom: 16px;
	}
	.manual-chapter :global(h2) {
		font-size: 17px;
		margin-top: 22px;
		color: var(--accent-bright);
	}
	.manual-chapter :global(h3) {
		font-size: 14px;
		margin-top: 16px;
	}
	.manual-chapter :global(img) {
		max-width: 100%;
		border: 1px solid var(--border);
		border-radius: 4px;
		margin: 10px 0;
	}
	.manual-chapter :global(table) {
		border-collapse: collapse;
		font-size: 12px;
		margin: 10px 0;
		width: 100%;
	}
	.manual-chapter :global(th),
	.manual-chapter :global(td) {
		border: 1px solid var(--border-soft);
		padding: 5px 9px;
		text-align: left;
		vertical-align: top;
	}
	.manual-chapter :global(th) {
		background: var(--bg-3);
	}
	.manual-chapter :global(blockquote) {
		border-left: 3px solid var(--accent-2);
		background: var(--bg-1);
		margin: 10px 0;
		padding: 8px 14px;
		border-radius: 0 4px 4px 0;
	}
	.manual-chapter :global(blockquote p) {
		margin: 4px 0;
	}
	.manual-chapter :global(code) {
		background: var(--bg-0);
		border: 1px solid var(--border-soft);
		border-radius: 3px;
		padding: 1px 5px;
		font-family: var(--mono);
		font-size: 12px;
	}
	.manual-chapter :global(pre) {
		background: var(--bg-0);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		padding: 10px 14px;
		overflow-x: auto;
	}
	.manual-chapter :global(a) {
		color: var(--accent-bright);
	}
	@media print {
		:global(.app) {
			height: auto !important;
			overflow: visible !important;
		}
		.no-print,
		.appbar {
			display: none;
		}
		.manual-layout {
			overflow: visible;
			padding: 0;
		}
		.manual-body {
			overflow: visible;
		}
		.manual-chapter {
			break-inside: avoid-page;
			background: #fff;
			color: #1a1a1a;
			border: none;
			max-width: none;
		}
		/* light-theme overrides so the dark app chrome prints legibly */
		.manual-chapter :global(h1) {
			color: #14506b;
			border-bottom-color: #14506b;
		}
		.manual-chapter :global(h2),
		.manual-chapter :global(h3) {
			color: #14506b;
		}
		.manual-chapter :global(a) {
			color: #14506b;
		}
		.manual-chapter :global(blockquote) {
			background: #f4f6f8;
			color: #1a1a1a;
			border-left: 3px solid #d98c24;
		}
		.manual-chapter :global(blockquote p) {
			color: #1a1a1a;
		}
		.manual-chapter :global(code) {
			background: #eef1f4;
			color: #b03a00;
			border: 1px solid #d4dae0;
		}
		.manual-chapter :global(pre) {
			background: #f4f6f8;
			color: #1a1a1a;
			border: 1px solid #d4dae0;
		}
		.manual-chapter :global(pre code) {
			background: none;
			border: none;
			color: #1a1a1a;
		}
		.manual-chapter :global(th) {
			background: #e7ebef;
			color: #1a1a1a;
		}
		.manual-chapter :global(th),
		.manual-chapter :global(td) {
			border-color: #c5ccd3;
		}
		.manual-chapter :global(img) {
			border-color: #c5ccd3;
		}
	}
</style>
