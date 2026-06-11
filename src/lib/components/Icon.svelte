<script lang="ts">
	// Minimal stroke-icon set. Add paths as the app grows.
	const PATHS: Record<string, string> = {
		patient:
			'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
		'patient-add':
			'M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8a6.5 6.5 0 0 1 12 0M18 8v6m-3-3h6',
		case: 'M4 7h16v12H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2',
		'case-add': 'M4 7h10v12H4zM7.5 11v4m-2-2h4M17 5v6m-3-3h6',
		edit: 'M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16l-1 4ZM13 7l3 3',
		trash: 'M5 7h14M10 7V5h4v2m-7 0 1 13h8l1-13M10 11v6m4-6v6',
		import: 'M12 3v10m0 0 -4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
		export: 'M12 13V3m0 0L8 7m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
		search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm9.5 3-4.9-4.9',
		close: 'M5 5l14 14M19 5L5 19',
		back: 'M15 5l-7 7 7 7',
		chevron: 'M9 5l7 7-7 7',
		'chevron-down': 'M5 9l7 7 7-7',
		plus: 'M12 5v14m-7-7h14',
		eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
		'eye-off':
			'M4 4l16 16M9.9 5.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.7M6 7.3A17 17 0 0 0 2 12s3.5 6 10 6c1.4 0 2.7-.3 3.8-.7',
		volume: 'M4 8l8-5 8 5v8l-8 5-8-5V8Zm8 5V21m0-8L4 8m8 5 8-5',
		implant:
			'M9 3h6l-.5 4h-5L9 3Zm.7 6h4.6l-.4 3h-3.8l-.4-3Zm.9 5h2.8l-.4 3h-2l-.4-3Zm1 5h.8L12 21l-.4-2Z',
		nerve: 'M4 14c3-6 6-3 8-6s5-3 8-1M4 14c2 1 3 3 3 5m5-9c1 2 1 4 0 7m6-9c2 1 3 2 3 4',
		ruler: 'M3 17 17 3l4 4L7 21l-4-4Zm4-2 1.5 1.5M10 12l1.5 1.5M13 9l1.5 1.5M16 6l1.5 1.5',
		angle: 'M5 19h15M5 19V4m0 15L18 6M5 13a8 8 0 0 1 6 6',
		report: 'M6 3h9l4 4v14H6V3Zm9 0v4h4M9 11h7M9 15h7M9 7h3',
		settings:
			'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3c0 .6 0 1.1-.1 1.6l2 1.6-2 3.4-2.4-1a8 8 0 0 1-2.7 1.6L14.4 22h-4l-.4-2.8a8 8 0 0 1-2.7-1.6l-2.4 1-2-3.4 2-1.6a8.7 8.7 0 0 1 0-3.2l-2-1.6 2-3.4 2.4 1a8 8 0 0 1 2.7-1.6L10.4 2h4l.4 2.8a8 8 0 0 1 2.7 1.6l2.4-1 2 3.4-2 1.6c.1.5.1 1 .1 1.6Z',
		tooth:
			'M7 3c2 0 3 1 5 1s3-1 5-1 4 2 4 5c0 4-2 5-2.5 8-.4 2.4-.8 5-2.5 5-1.4 0-1.3-2.7-2-5-.5-1.6-1.5-1.6-2 0-.7 2.3-.6 5-2 5-1.7 0-2.1-2.6-2.5-5C5 13 3 12 3 8c0-3 2-5 4-5Z',
		guide: 'M4 10c0-4 3.5-6 8-6s8 2 8 6c0 3-1.5 4-2 7h-3c-.5-2-1.5-2-3-2s-2.5 0-3 2H6c-.5-3-2-4-2-7Zm5-2v3m6-3v3',
		grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
		layout: 'M4 4h16v16H4zM4 12h16M12 4v16',
		warning: 'M12 3 2 21h20L12 3Zm0 7v5m0 3v.5',
		check: 'M4 12l5 5L20 7',
		pano: 'M3 8c3 4 6 6 9 6s6-2 9-6M7 11.5V16m10-4.5V16M12 14v5',
		slice: 'M4 6h16M4 12h16M4 18h16M8 3v18',
		rotate: 'M20 8A8 8 0 1 0 21 13M21 4v5h-5',
		home: 'M4 11l8-7 8 7v9h-5v-6h-6v6H4v-9Z'
	};
	let { name, size = 18 }: { name: string; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<path d={PATHS[name] ?? PATHS.warning} />
</svg>
