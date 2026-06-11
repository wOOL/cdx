<script lang="ts">
	import { APP_VERSION } from '$lib/version';

	let { onclose }: { onclose: () => void } = $props();

	const LIBRARIES = [
		{ name: 'three.js', license: 'MIT', url: 'https://threejs.org' },
		{ name: 'dicom-parser', license: 'MIT', url: 'https://github.com/cornerstonejs/dicomParser' },
		{ name: 'fflate', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
		{ name: 'SvelteKit', license: 'MIT', url: 'https://svelte.dev' },
		{ name: 'Bun', license: 'MIT', url: 'https://bun.sh' }
	];
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="about-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="about-dialog panel" role="dialog" aria-modal="true" aria-label="About coDiagnostiX Web">
		<div class="dialog-title">About</div>
		<div class="about-body">
			<div class="about-brand">
				<span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span>
			</div>
			<div class="about-version">Version {APP_VERSION}</div>

			<div class="about-section">Third-party software</div>
			<ul class="about-libs">
				{#each LIBRARIES as lib (lib.name)}
					<li>
						<a href={lib.url} target="_blank" rel="noopener noreferrer">{lib.name}</a>
						<span class="lib-license">{lib.license}</span>
					</li>
				{/each}
			</ul>

			<div class="about-section">Important notice</div>
			<p class="disclaimer">
				This software is a demonstration project and is <strong>not a medical device</strong>. It is not cleared,
				certified or approved for clinical use and must not be used for the diagnosis or treatment of patients.
				All planning output is for illustration only; treatment decisions remain the sole responsibility of a
				qualified clinician using validated tools.
			</p>
		</div>
		<div class="about-actions">
			<a class="btn" href="/manual">User manual</a>
			<button
				class="btn"
				type="button"
				title="Show the first-run onboarding tour again"
				onclick={() => {
					localStorage.removeItem('cdx_tour_done');
					location.assign('/');
				}}
			>
				Replay tour
			</button>
			<button class="btn primary" type="button" onclick={onclose}>Close</button>
		</div>
	</div>
</div>

<style>
	.about-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.about-dialog {
		width: 440px;
		box-shadow: var(--shadow);
	}
	.about-body {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.about-brand {
		font-size: 22px;
		font-weight: 700;
		text-align: center;
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
	.about-version {
		text-align: center;
		font-size: 12px;
		color: var(--text-dim);
		font-family: var(--mono);
	}
	.about-section {
		margin-top: 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
		border-bottom: 1px solid var(--border-soft);
		padding-bottom: 3px;
	}
	.about-libs {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
	}
	.about-libs li {
		display: flex;
		justify-content: space-between;
	}
	.lib-license {
		color: var(--text-dim);
		font-family: var(--mono);
		font-size: 11px;
	}
	.disclaimer {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim);
		line-height: 1.5;
	}
	.about-actions {
		display: flex;
		justify-content: flex-end;
		padding: 12px 16px;
		border-top: 1px solid var(--border-soft);
	}
</style>
