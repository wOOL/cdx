import type { PageServerLoad } from './$types';
import { getSettings, setSetting } from '$lib/server/db/repo';
import { listContacts } from '$lib/server/collab';

export const load: PageServerLoad = async () => {
	const settings = getSettings();
	let practiceCode = settings.practice_code ?? '';
	if (!/^\d{7}$/.test(practiceCode)) {
		practiceCode = String(1000000 + Math.floor(Math.random() * 9000000));
		setSetting('practice_code', practiceCode);
	}
	return { practiceCode, contacts: listContacts() };
};
