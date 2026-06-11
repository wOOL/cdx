<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>{t('auth.signIn')} — coDiagnostiX Web</title>
</svelte:head>

<div class="auth-wrap">
	<div class="auth-card panel">
		<div class="auth-logo"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
		<h2>{t('auth.signIn')}</h2>
		{#if form?.mfa}
			<form method="POST" use:enhance>
				{#if form?.error}<div class="auth-error">{form.error}</div>{/if}
				<p class="muted mfa-hint">{t('auth.mfaHint')}</p>
				<input type="hidden" name="pending" value={form.pending} />
				<label for="code">{t('auth.mfaCode')}</label>
				<input
					id="code"
					name="code"
					inputmode="numeric"
					autocomplete="one-time-code"
					pattern="[0-9 ]*"
					maxlength="7"
					required
				/>
				<button class="btn primary" type="submit">{t('auth.verify')}</button>
			</form>
			<p class="muted"><a href="/login">{t('auth.startOver')}</a></p>
		{:else}
			<form method="POST" use:enhance>
				{#if form?.error}<div class="auth-error">{form.error}</div>{/if}
				<label for="email">{t('auth.email')}</label>
				<input id="email" name="email" type="email" value={form?.email ?? ''} required autocomplete="email" />
				<label for="password">{t('auth.password')}</label>
				<input id="password" name="password" type="password" required autocomplete="current-password" />
				<button class="btn primary" type="submit">{t('auth.signIn')}</button>
			</form>
			<p class="muted">
				{data.hasUsers ? t('auth.newHere') : t('auth.noAccounts')}
				<a href="/register">{t('auth.createAccount')}</a>
			</p>
		{/if}
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
	.mfa-hint {
		font-size: 12px;
		text-align: left;
	}
	p {
		text-align: center;
		font-size: 12px;
	}
</style>
