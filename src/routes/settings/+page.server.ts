import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SETTING_DEFAULTS, getSettings, setSetting } from '$lib/server/db/repo';

export const load: PageServerLoad = async () => {
	return { settings: getSettings() };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		for (const key of Object.keys(SETTING_DEFAULTS)) {
			const v = form.get(key);
			if (v != null) setSetting(key, String(v));
		}
		redirect(303, '/settings?saved=1');
	}
};
