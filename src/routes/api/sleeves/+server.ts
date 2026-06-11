/**
 * Custom sleeve systems collection API.
 *
 * GET  /api/sleeves                  -> { systems: (CustomSleeveSystem & { used })[] }
 * GET  /api/sleeves?export=1         -> JSON file download { format, version, systems }
 * GET  /api/sleeves?printers=1       -> { printers: Record<name, scaleFactor> }
 * PUT  /api/sleeves?printers=1       -> save named per-printer scale factors
 *                                       (settings key 'sleeve_printer_scales');
 *                                       body { printers: { [name]: factor 0.5–2 } }
 * POST /api/sleeves                  -> create one system (validated), 201 { system }
 * POST /api/sleeves { import: [..] } -> append systems with new ids; duplicate
 *                                       names get ' (2)', ' (3)', …; 201 { systems }
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setSetting } from '$lib/server/db/repo';
import {
	dedupeName,
	getPrinterScales,
	insertSystem,
	listSystems,
	PRINTER_SCALES_KEY,
	usedSystemIds,
	validateSleeveSystem,
	type CustomSleeveSystem
} from '$lib/server/sleeveGeom';

export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get('printers') === '1') {
		return json({ printers: getPrinterScales() });
	}

	const systems = listSystems();

	if (url.searchParams.get('export') === '1') {
		const payload = {
			format: 'codiagnostix-web-custom-sleeves',
			version: 1,
			exported_at: new Date().toISOString(),
			systems: systems.map(({ name, manufacturer, notes, segments, drillOffset }) => ({
				name,
				manufacturer,
				notes,
				segments,
				drillOffset
			}))
		};
		return new Response(JSON.stringify(payload, null, '\t'), {
			headers: {
				'Content-Type': 'application/json',
				'Content-Disposition': 'attachment; filename="custom-sleeve-systems.json"'
			}
		});
	}

	const used = usedSystemIds();
	return json({ systems: systems.map((s) => ({ ...s, used: used.has(s.id) })) });
};

export const PUT: RequestHandler = async ({ url, request }) => {
	if (url.searchParams.get('printers') !== '1') {
		error(400, 'Unsupported PUT — use /api/sleeves?printers=1');
	}
	const body = (await request.json().catch(() => ({}))) as { printers?: unknown };
	const printers = body.printers;
	if (typeof printers !== 'object' || printers === null || Array.isArray(printers)) {
		error(400, 'printers must be an object of { name: scaleFactor }');
	}
	const entries = Object.entries(printers as Record<string, unknown>);
	if (entries.length > 20) error(400, 'At most 20 printers');
	const clean: Record<string, number> = {};
	for (const [name, v] of entries) {
		const trimmed = name.trim();
		if (!trimmed || trimmed.length > 40) error(400, 'Printer names must be 1–40 characters');
		const factor = Number(v);
		if (!Number.isFinite(factor) || factor < 0.5 || factor > 2) {
			error(400, `Printer "${trimmed}": scale factor must be 0.5–2.0`);
		}
		clean[trimmed] = Math.round(factor * 10000) / 10000;
	}
	setSetting(PRINTER_SCALES_KEY, JSON.stringify(clean));
	return json({ printers: clean });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	// ---- bulk import: { import: [...] } appends with new ids + name dedupe ----
	if ('import' in body) {
		if (!Array.isArray(body.import)) error(400, 'import must be an array of systems');
		if (body.import.length > 200) error(400, 'At most 200 systems per import');

		const validated = body.import.map((item, i) => {
			const res = validateSleeveSystem(item);
			if (!res.ok) error(400, `import item ${i + 1}: ${res.error}`);
			return res.value;
		});

		const taken = new Set(listSystems().map((s) => s.name));
		const created: CustomSleeveSystem[] = [];
		for (const value of validated) {
			created.push(insertSystem({ ...value, name: dedupeName(value.name, taken) }));
		}
		return json({ systems: created }, { status: 201 });
	}

	// ---- single create ----
	const res = validateSleeveSystem(body);
	if (!res.ok) error(400, res.error);
	return json({ system: insertSystem(res.value) }, { status: 201 });
};
