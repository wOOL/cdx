<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import WebGLGate from '$lib/components/WebGLGate.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>coDiagnostiX Web</title>
</svelte:head>

<WebGLGate>
	<div class="app">
		{@render children()}
	</div>
</WebGLGate>

<style>
	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>
