import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SETTING_DEFAULTS, getSettings, listAudit, logAudit, setSetting } from '$lib/server/db/repo';
import { DATA_DIR, db } from '$lib/server/db';
import { createUser } from '$lib/server/auth';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
	const users = db
		.query('SELECT id, email, name, work_mode, created_at FROM users ORDER BY id')
		.all() as { id: number; email: string; name: string }[];
	return { settings: getSettings(), audit: listAudit(100), users };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		for (const key of Object.keys(SETTING_DEFAULTS)) {
			const v = form.get(key);
			if (v != null && typeof v === 'string') setSetting(key, v);
		}
		// checkbox: absent when unchecked
		for (const cb of [
			'logo_enabled',
			'plan_comment_on_material',
			'smooth_transitions',
			'nerve_safety_on',
			'implant_safety_on',
			'snapshot_notify'
		])
			setSetting(cb, form.get(cb) ? '1' : '0');

		const logo = form.get('logo');
		if (logo instanceof File && logo.size > 0) {
			await Bun.write(`${DATA_DIR}/logo.png`, await logo.arrayBuffer());
			setSetting('logo_enabled', '1');
		}
		redirect(303, '/settings?saved=1');
	},

	createUser: async ({ request, locals }) => {
		const form = await request.formData();
		const email = String(form.get('new_email') ?? '').trim();
		const name = String(form.get('new_name') ?? '').trim();
		const password = String(form.get('new_password') ?? '');
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, { userError: 'Invalid email' });
		if (password.length < 8) return fail(400, { userError: 'Password must be at least 8 characters' });
		const user = await createUser(email, password, name);
		if (!user) return fail(400, { userError: 'An account with this email already exists' });
		logAudit(locals.user, 'user.create', `user:${user.id}`, email);
		redirect(303, '/settings?saved=1');
	}
};
