import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createCatalog, listCatalogs, validateLines } from '$lib/server/catalogs';
import { logAudit } from '$lib/server/db/repo';

export const GET: RequestHandler = () => json({ catalogs: listCatalogs() });

/**
 * Upload a catalog version. Accepts either
 *  - multipart/form-data: file (.json) + name + version fields, or
 *  - application/json: { name, version, lines: ImplantLine[] }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const ct = request.headers.get('content-type') ?? '';
	let name = '';
	let version = '';
	let payload: unknown;

	if (ct.includes('multipart/form-data')) {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) error(400, 'Missing catalog JSON file');
		if (file.size > 5_000_000) error(400, 'Catalog file too large (max 5 MB)');
		try {
			payload = JSON.parse(await file.text());
		} catch {
			error(400, 'File is not valid JSON');
		}
		name = String(form.get('name') ?? '').trim() || file.name.replace(/\.json$/i, '');
		version = String(form.get('version') ?? '').trim();
	} else {
		const body = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') error(400, 'Invalid JSON body');
		name = String((body as { name?: unknown }).name ?? '').trim();
		version = String((body as { version?: unknown }).version ?? '').trim();
		payload = (body as { lines?: unknown }).lines;
	}

	if (!name) error(400, 'Catalog name is required');
	const parsed = validateLines(payload);
	if ('error' in parsed) error(400, parsed.error);

	const catalog = createCatalog(name.slice(0, 120), (version || '1').slice(0, 40), parsed.lines);
	logAudit(locals.user, 'catalog.upload', `catalog:${catalog.id}`, `${name} v${catalog.version} (${catalog.count} lines)`);
	return json({ catalog }, { status: 201 });
};
