import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteCatalog, getCatalog, patchCatalog } from '$lib/server/catalogs';
import { logAudit } from '$lib/server/db/repo';

export const GET: RequestHandler = ({ params }) => {
	const catalog = getCatalog(Number(params.id));
	if (!catalog) error(404, 'Catalog not found');
	return json({ catalog });
};

/** PATCH { active?: boolean, outdated?: boolean } — toggle merge inclusion / outdated flag. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const body = await request.json().catch(() => ({}));
	const fields: { active?: boolean; outdated?: boolean } = {};
	if ('active' in body) fields.active = !!body.active;
	if ('outdated' in body) fields.outdated = !!body.outdated;
	if (fields.active === undefined && fields.outdated === undefined) {
		error(400, 'Nothing to update — pass active and/or outdated');
	}
	const catalog = patchCatalog(id, fields);
	if (!catalog) error(404, 'Catalog not found');
	logAudit(
		locals.user,
		'catalog.update',
		`catalog:${id}`,
		`active=${catalog.active} outdated=${catalog.outdated}`
	);
	return json({ catalog });
};

export const DELETE: RequestHandler = ({ params, locals }) => {
	const id = Number(params.id);
	const catalog = getCatalog(id);
	if (!catalog || !deleteCatalog(id)) error(404, 'Catalog not found');
	logAudit(locals.user, 'catalog.delete', `catalog:${id}`, catalog.name);
	return json({ ok: true });
};
