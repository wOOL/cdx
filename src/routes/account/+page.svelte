<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';

	let { data, form } = $props();
	let saved = $derived(page.url.searchParams.get('saved') === '1');
</script>

<svelte:head>
	<title>Account — coDiagnostiX Web</title>
</svelte:head>

<header class="appbar">
	<a class="btn ghost" href="/"><Icon name="back" size={18} /></a>
	<div class="brand"><span class="brand-x">co</span>DiagnostiX<span class="brand-web">web</span></div>
	<div class="appbar-sub">Account</div>
	{#if saved}<span class="saved-note"><Icon name="check" size={14} /> Saved</span>{/if}
</header>

<div class="account-wrap">
	<form class="panel account-form" method="POST" action="?/profile" use:enhance>
		<div class="panel-header">Profile</div>
		<div class="account-body">
			{#if form?.profileError}<div class="form-error">{form.profileError}</div>{/if}
			<div class="field-row">
				<div>
					<label for="a-name">Name</label>
					<input id="a-name" name="name" value={data.account.name} style="width:100%" />
				</div>
				<div>
					<label for="a-email">Email</label>
					<input id="a-email" value={data.account.email} disabled style="width:100%" />
				</div>
			</div>
			<div class="field-row">
				<div>
					<span class="field-label">Tier</span>
					<span class="tier-badge" class:viewer={data.account.tier === 'viewer'}>{data.account.tier}</span>
				</div>
				<div>
					<span class="field-label">Export credits</span>
					<span class="credits">{data.account.credits}</span>
				</div>
			</div>
		</div>
		<div class="account-actions">
			<button class="btn primary" type="submit">Save profile</button>
		</div>
	</form>

	<form class="panel account-form section" method="POST" action="?/buyCredits" use:enhance>
		<div class="panel-header">Export credits</div>
		<div class="account-body">
			<p class="muted">
				Each surgical-guide export for production consumes one credit. Remaining: <strong>{data.account.credits}</strong>
			</p>
		</div>
		<div class="account-actions">
			<button class="btn primary" type="submit">Buy 10 credits</button>
		</div>
	</form>

	<form class="panel account-form section" method="POST" action="?/password" use:enhance>
		<div class="panel-header">Change password</div>
		<div class="account-body">
			{#if form?.passwordError}<div class="form-error">{form.passwordError}</div>{/if}
			<div class="field-row">
				<div>
					<label for="a-current">Current password</label>
					<input id="a-current" name="current_password" type="password" required autocomplete="current-password" style="width:100%" />
				</div>
				<div>
					<label for="a-new">New password (min. 8)</label>
					<input id="a-new" name="new_password" type="password" minlength="8" required autocomplete="new-password" style="width:100%" />
				</div>
			</div>
		</div>
		<div class="account-actions">
			<button class="btn primary" type="submit">Change password</button>
		</div>
	</form>

	<div class="panel account-form section">
		<div class="panel-header">Two-factor authentication (TOTP)</div>
		<div class="account-body">
			{#if data.mfaEnabled}
				<p class="muted">
					<Icon name="check" size={14} /> Enabled — signing in requires a 6-digit code from your authenticator app.
				</p>
				<form method="POST" action="?/mfaDisable" use:enhance class="inline-form">
					{#if form?.mfaDisableError}<div class="form-error">{form.mfaDisableError}</div>{/if}
					<div class="field-row">
						<div>
							<label for="a-mfa-off">Authenticator code</label>
							<input id="a-mfa-off" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required style="width:100%" />
						</div>
						<div class="align-end">
							<button class="btn" type="submit">Disable MFA</button>
						</div>
					</div>
				</form>
			{:else if form?.mfaSecret}
				<p class="muted">
					Add this secret to your authenticator app (Google Authenticator, Aegis, 1Password, …), then confirm with the
					code it shows. MFA is only enabled after a valid code.
				</p>
				{#if form?.mfaError}<div class="form-error">{form.mfaError}</div>{/if}
				<div>
					<label for="a-mfa-url">Setup link (otpauth)</label>
					<input id="a-mfa-url" value={form.mfaUrl} readonly onfocus={(e) => e.currentTarget.select()} style="width:100%" />
				</div>
				<div>
					<label for="a-mfa-secret">Secret (base32, for manual entry)</label>
					<input id="a-mfa-secret" value={form.mfaSecret} readonly onfocus={(e) => e.currentTarget.select()} style="width:100%" class="mono" />
				</div>
				<form method="POST" action="?/mfaEnable" use:enhance class="inline-form">
					<input type="hidden" name="secret" value={form.mfaSecret} />
					<div class="field-row">
						<div>
							<label for="a-mfa-code">Code from your app</label>
							<input id="a-mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required style="width:100%" />
						</div>
						<div class="align-end">
							<button class="btn primary" type="submit">Confirm &amp; enable</button>
						</div>
					</div>
				</form>
			{:else}
				<p class="muted">Protect sign-in with a 6-digit time-based code (RFC 6238) from an authenticator app.</p>
				<form method="POST" action="?/mfaStart" use:enhance class="inline-form">
					<button class="btn primary" type="submit">Enable two-factor authentication</button>
				</form>
			{/if}
		</div>
	</div>

	<div class="panel account-form section">
		<div class="panel-header">Users &amp; tiers</div>
		<div class="account-body">
			<p class="muted">
				<strong>pro</strong> has full planning and export access; <strong>viewer</strong> is read-only (server-enforced).
			</p>
			{#if form?.tierError}<div class="form-error">{form.tierError}</div>{/if}
			<table class="user-table">
				<thead>
					<tr><th>User</th><th>Email</th><th>Credits</th><th>Tier</th></tr>
				</thead>
				<tbody>
					{#each data.users as u (u.id)}
						<tr>
							<td>{u.name || '—'}{#if u.id === data.account.id}&nbsp;<span class="muted">(you)</span>{/if}</td>
							<td>{u.email}</td>
							<td>{u.credits}</td>
							<td>
								{#if data.account.tier === 'pro'}
									<form method="POST" action="?/setTier" use:enhance class="tier-form">
										<input type="hidden" name="user_id" value={u.id} />
										<select name="tier" value={u.tier} onchange={(e) => e.currentTarget.form?.requestSubmit()}>
											<option value="pro">pro</option>
											<option value="viewer">viewer</option>
										</select>
									</form>
								{:else}
									{u.tier}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
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
	.account-wrap {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
	}
	.account-form {
		max-width: 640px;
		margin: 0 auto;
	}
	.section {
		margin-top: 16px;
	}
	.account-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.account-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border-top: 1px solid var(--border-soft);
	}
	.saved-note {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--green);
		font-size: 12px;
		margin-left: auto;
	}
	.form-error {
		color: var(--red);
		font-size: 12px;
	}
	.field-label {
		display: block;
		font-size: 11px;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 4px;
	}
	.tier-badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 10px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--accent-bright);
		border: 1px solid var(--accent-bright);
	}
	.tier-badge.viewer {
		color: var(--text-dim);
		border-color: var(--border);
	}
	.credits {
		font-size: 18px;
		font-weight: 700;
		font-family: var(--mono);
	}
	.inline-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.align-end {
		display: flex;
		align-items: flex-end;
	}
	.mono {
		font-family: var(--mono);
	}
	.user-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.user-table th,
	.user-table td {
		border-bottom: 1px solid var(--border-soft);
		padding: 6px 8px;
		text-align: left;
	}
	.tier-form {
		display: inline;
	}
</style>
