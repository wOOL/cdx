import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SETTING_DEFAULTS, getSettings, listAudit, setSetting } from '$lib/server/db/repo';
import { DATA_DIR } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	return { settings: getSettings(), audit: listAudit(100) };
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		for (const key of Object.keys(SETTING_DEFAULTS)) {
			const v = form.get(key);
			if (v != null && typeof v === 'string') setSetting(key, v);
		}
		// checkbox: absent when unchecked
		setSetting('logo_enabled', form.get('logo_enabled') ? '1' : '0');

		const logo = form.get('logo');
		if (logo instanceof File && logo.size > 0) {
			await Bun.write(`${DATA_DIR}/logo.png`, await logo.arrayBuffer());
			setSetting('logo_enabled', '1');
		}
		redirect(303, '/settings?saved=1');
	}
};
