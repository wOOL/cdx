import { error, json } from '@sveltejs/kit';
import { unlinkSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { logAudit } from '$lib/server/db/repo';
import { evictVolume } from '$lib/server/volumeCache';
import type { Dataset } from '$lib/types';

function getDataset(id: number): Dataset | null {
	return (db.query('SELECT * FROM datasets WHERE id = ?1').get(id) as Dataset) ?? null;
}

export const GET: RequestHandler = async ({ params }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');
	return json({ dataset: ds });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	const ds = getDataset(id);
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	if ('locked' in body) {
		db.query('UPDATE datasets SET locked = ?2 WHERE id = ?1').run(id, body.locked ? 1 : 0);
		logAudit(locals.user, body.locked ? 'dataset.lock' : 'dataset.unlock', `dataset:${id}`);
	}
	if ('description' in body) {
		if (ds.locked) error(409, 'Dataset is locked');
		db.query('UPDATE datasets SET description = ?2 WHERE id = ?1').run(
			id,
			String(body.description)
		);
	}
	return json({ dataset: getDataset(id) });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	const ds = getDataset(id);
	if (!ds) error(404, 'Dataset not found');
	if (ds.locked) error(409, 'Dataset is locked — unlock it before deleting');

	evictVolume(id);
	for (const f of [ds.volume_path, ds.preview_path]) {
		if (!f) continue;
		try {
			unlinkSync(resolveData(f));
		} catch {
			// already gone
		}
	}
	db.query('DELETE FROM datasets WHERE id = ?1').run(id);
	logAudit(locals.user, 'dataset.delete', `dataset:${id}`, ds.series_description || ds.description);
	return json({ ok: true });
};
