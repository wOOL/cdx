import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unlink } from 'node:fs/promises';
import { db, resolveData } from '$lib/server/db';
import type { Model } from '$lib/types';

function getModel(id: number): Model | null {
	return (db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model) ?? null;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const m = getModel(id);
	if (!m) error(404, 'Model not found');

	const body = await request.json().catch(() => ({}));
	let paramsJson = m.params;
	if ('shading' in body) {
		let p: Record<string, unknown> = {};
		try {
			p = m.params ? JSON.parse(m.params) : {};
		} catch {
			p = {};
		}
		if (body.shading === 'metallic' || body.shading === 'wireframe') p.shading = body.shading;
		else delete p.shading;
		paramsJson = JSON.stringify(p);
	}
	db.query(
		`UPDATE models SET name=?2, color=?3, opacity=?4, visible=?5, transform=?6, params=?7 WHERE id=?1`
	).run(
		id,
		'name' in body ? String(body.name) : m.name,
		'color' in body ? String(body.color) : m.color,
		'opacity' in body ? Number(body.opacity) : m.opacity,
		'visible' in body ? (body.visible ? 1 : 0) : m.visible,
		'transform' in body ? JSON.stringify(body.transform) : m.transform,
		paramsJson
	);
	return json({ model: getModel(id) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const m = getModel(id);
	if (m?.file_path) {
		await unlink(resolveData(m.file_path)).catch(() => {});
	}
	db.query('DELETE FROM models WHERE id = ?1').run(id);
	return json({ ok: true });
};
