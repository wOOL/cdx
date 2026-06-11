import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getCase } from '$lib/server/db/repo';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';
import type { Plan } from '$lib/types';

/** Import a single-plan archive (from /api/plans/[id]/export) as a new plan of this case. */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No plan file uploaded');
	assertSize(file, LIMITS.plan);

	let payload;
	try {
		payload = JSON.parse(await file.text());
	} catch {
		error(400, 'Not a valid plan file');
	}
	if (payload?.kind !== 'cdx-web-plan' || payload?.version !== 1) {
		error(400, 'Unsupported plan file (expected a .cdxplan.json export)');
	}

	const p = payload.plan ?? {};
	const plan = db
		.query(
			`INSERT INTO plans (case_id, name, jaw, pan_curve, settings)
			 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`
		)
		.get(
			caseId,
			`${p.name ?? 'Imported plan'} (imported)`,
			p.jaw === 'maxilla' ? 'maxilla' : 'mandible',
			p.pan_curve ?? '',
			p.settings ?? ''
		) as Plan;

	for (const n of payload.nerves ?? []) {
		db.query(
			`INSERT INTO nerves (plan_id, name, color, diameter, points, visible) VALUES (?1,?2,?3,?4,?5,?6)`
		).run(plan.id, n.name ?? 'Nerve', n.color ?? '#e8d44d', n.diameter ?? 2, n.points ?? '[]', n.visible ?? 1);
	}
	for (const im of payload.implants ?? []) {
		db.query(
			`INSERT INTO implants (plan_id, tooth, manufacturer, line, article, diameter, length,
				x, y, z, ax, ay, az, rotation, color, sleeve, abutment, visible)
			 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`
		).run(
			plan.id, im.tooth ?? '', im.manufacturer ?? 'Generic', im.line ?? '', im.article ?? '',
			im.diameter ?? 4.1, im.length ?? 10, im.x ?? 0, im.y ?? 0, im.z ?? 0,
			im.ax ?? 0, im.ay ?? 0, im.az ?? -1, im.rotation ?? 0,
			im.color ?? '#3aa757', im.sleeve ?? '', im.abutment ?? '', im.visible ?? 1
		);
	}
	for (const m of payload.measurements ?? []) {
		db.query(
			`INSERT INTO measurements (plan_id, type, points, value, label) VALUES (?1,?2,?3,?4,?5)`
		).run(plan.id, m.type ?? 'distance', m.points ?? '[]', m.value ?? 0, m.label ?? '');
	}

	return json({ planId: plan.id });
};
