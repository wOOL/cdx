import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addCredits,
	changePassword,
	getTotpSecret,
	setTier,
	setTotpSecret,
	updateName,
	verifyPassword
} from '$lib/server/auth';
import { logAudit } from '$lib/server/db/repo';
import { generateSecret, otpauthUrl, verifyCode } from '$lib/server/totp';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const users = db
		.query('SELECT id, email, name, tier, credits, created_at FROM users ORDER BY id')
		.all() as { id: number; email: string; name: string; tier: string; credits: number; created_at: string }[];
	return {
		account: user,
		mfaEnabled: getTotpSecret(user.id) !== '',
		users
	};
};

export const actions: Actions = {
	profile: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { profileError: 'Name cannot be empty' });
		updateName(user.id, name);
		logAudit(user, 'account.profile', `user:${user.id}`, `name: ${name}`);
		redirect(303, '/account?saved=1');
	},

	password: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const current = String(form.get('current_password') ?? '');
		const next = String(form.get('new_password') ?? '');
		if (next.length < 8) return fail(400, { passwordError: 'New password must be at least 8 characters' });
		if (!(await verifyPassword(user.id, current))) {
			return fail(400, { passwordError: 'Current password is incorrect' });
		}
		await changePassword(user.id, next);
		logAudit(user, 'account.password', `user:${user.id}`);
		redirect(303, '/account?saved=1');
	},

	buyCredits: async ({ locals }) => {
		const user = locals.user!;
		const balance = addCredits(user.id, 10);
		logAudit(user, 'credits.purchase', `user:${user.id}`, `+10 credits — balance: ${balance}`);
		redirect(303, '/account?saved=1');
	},

	// step 1 of enabling MFA: hand the browser a fresh secret to add to an authenticator app.
	// Nothing is stored yet — the secret only sticks once a valid code proves possession.
	mfaStart: async ({ locals }) => {
		const user = locals.user!;
		const secret = generateSecret();
		return { mfaSecret: secret, mfaUrl: otpauthUrl(user.email, secret) };
	},

	mfaEnable: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const secret = String(form.get('secret') ?? '');
		const code = String(form.get('code') ?? '');
		if (!secret || !verifyCode(secret, code)) {
			return fail(400, {
				mfaError: 'Code did not match — check your authenticator app',
				mfaSecret: secret,
				mfaUrl: otpauthUrl(user.email, secret)
			});
		}
		setTotpSecret(user.id, secret);
		logAudit(user, 'mfa.enable', `user:${user.id}`);
		redirect(303, '/account?saved=1');
	},

	mfaDisable: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const code = String(form.get('code') ?? '');
		const secret = getTotpSecret(user.id);
		if (!secret || !verifyCode(secret, code)) {
			return fail(400, { mfaDisableError: 'Enter a valid authenticator code to disable MFA' });
		}
		setTotpSecret(user.id, '');
		logAudit(user, 'mfa.disable', `user:${user.id}`);
		redirect(303, '/account?saved=1');
	},

	// single-practice trust model: any pro user may set tiers; viewers may not.
	setTier: async ({ request, locals }) => {
		const user = locals.user!;
		if (user.tier !== 'pro') return fail(403, { tierError: 'Only pro users can change tiers' });
		const form = await request.formData();
		const targetId = Number(form.get('user_id'));
		const tier = String(form.get('tier'));
		if (!Number.isInteger(targetId) || (tier !== 'pro' && tier !== 'viewer')) {
			return fail(400, { tierError: 'Invalid tier change' });
		}
		const target = db.query('SELECT id, email FROM users WHERE id = ?1').get(targetId) as {
			id: number;
			email: string;
		} | null;
		if (!target) return fail(404, { tierError: 'User not found' });
		setTier(targetId, tier);
		logAudit(user, 'user.tier', `user:${targetId}`, `${target.email} → ${tier}`);
		redirect(303, '/account?saved=1');
	}
};
