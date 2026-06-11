import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import type { Implant } from '$lib/types';

function getImplant(id: number): Implant | null {
	return (db.query('SELECT * FROM implants WHERE id = ?1').get(id) as Implant) ?? null;
}

const NUM_FIELDS = ['diameter', 'length', 'x', 'y', 'z', 'ax', 'ay', 'az', 'rotation'] as const;
const STR_FIELDS = ['tooth', 'manufacturer', 'line', 'article', 'color'] as const;

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const implant = getImplant(id);
	if (!implant) error(404, 'Implant not found');

	const body = await request.json().catch(() => ({}));
	const updated: Record<string, string | number> = { ...implant };
	for (const f of NUM_FIELDS) {
		if (f in body && Number.isFinite(Number(body[f]))) updated[f] = Number(body[f]);
	}
	for (const f of STR_FIELDS) {
		if (f in body) updated[f] = String(body[f]);
	}
	if ('sleeve' in body) updated.sleeve = body.sleeve ? JSON.stringify(body.sleeve) : '';
	if ('visible' in body) updated.visible = body.visible ? 1 : 0;

	db.query(
		`UPDATE implants SET tooth=?2, manufacturer=?3, line=?4, article=?5, diameter=?6, length=?7,
			x=?8, y=?9, z=?10, ax=?11, ay=?12, az=?13, rotation=?14, color=?15, sleeve=?16, visible=?17
		 WHERE id=?1`
	).run(
		id,
		updated.tooth,
		updated.manufacturer,
		updated.line,
		updated.article,
		updated.diameter,
		updated.length,
		updated.x,
		updated.y,
		updated.z,
		updated.ax,
		updated.ay,
		updated.az,
		updated.rotation,
		updated.color,
		updated.sleeve,
		updated.visible
	);
	return json({ implant: getImplant(id) });
};

export const DELETE: RequestHandler = async ({ params }) => {
	db.query('DELETE FROM implants WHERE id = ?1').run(Number(params.id));
	return json({ ok: true });
};
