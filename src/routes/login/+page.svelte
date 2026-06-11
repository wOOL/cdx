<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Sign in — coDiagnostiX Web</title>
</svelte:head>

<div class="auth-wrap">
	<div class="auth-card panel">
		<div class="auth-logo"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
		<h2>Sign in</h2>
		<form method="POST" use:enhance>
			{#if form?.error}<div class="auth-error">{form.error}</div>{/if}
			<label for="email">Email</label>
			<input id="email" name="email" type="email" value={form?.email ?? ''} required autocomplete="email" />
			<label for="password">Password</label>
			<input id="password" name="password" type="password" required autocomplete="current-password" />
			<button class="btn primary" type="submit">Sign in</button>
		</form>
		<p class="muted">
			{data.hasUsers ? 'New here?' : 'No accounts yet — create the first one:'}
			<a href="/register">Create an account</a>
		</p>
	</div>
</div>

<style>
	.auth-wrap {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.auth-card {
		width: 360px;
		padding: 28px 32px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.auth-logo {
		font-size: 22px;
		font-weight: 700;
		text-align: center;
		margin-bottom: 8px;
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
		text-transform: uppercase;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	form .btn {
		margin-top: 8px;
		justify-content: center;
	}
	.auth-error {
		color: var(--red);
		font-size: 12px;
	}
	p {
		text-align: center;
		font-size: 12px;
	}
</style>
