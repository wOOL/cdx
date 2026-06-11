import type { PageServerLoad } from './$types';
import { getPrinterScales, listSystems, usedSystemIds } from '$lib/server/sleeveGeom';

// Auth: like /settings, this page relies on the global guard in
// hooks.server.ts (unauthenticated users are redirected to /login).
export const load: PageServerLoad = async () => {
	const used = usedSystemIds();
	return {
		systems: listSystems().map((s) => ({ ...s, used: used.has(s.id) })),
		printers: getPrinterScales()
	};
};
