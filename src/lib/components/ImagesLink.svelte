<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	let { patientId, count }: { patientId: number; count: number } = $props();
</script>

<a class="btn" href="/patients/{patientId}/images" title="Open image viewer">
	<Icon name="layout" size={14} />
	Images
	{#if count > 0}<span class="badge new">{count}</span>{/if}
</a>
