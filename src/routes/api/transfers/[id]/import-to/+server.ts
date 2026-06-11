import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { getCase, logAudit } from '$lib/server/db/repo';
import { getTransfer } from '$lib/server/collab';
import type { Plan } from '$lib/types';

/**
 * Body: { caseId } — imports a received plan transfer as a NEW plan of that case.
 * Mirrors /api/cases/[id]/import-plan, but reads the stored transfer payload and
 * locks the new plan (received plans are write-protected).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const transfer = getTransfer(Number(params.id));
	if (!transfer) error(404, 'Transfer not found');
	if (!transfer.payload_path) error(400, 'Transfer has no plan payload (service request)');

	const body = await request.json().catch(() => ({}));
	const caseId = Number(body.caseId);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	let payload;
	try {
		payload = JSON.parse(await Bun.file(resolveData(transfer.payload_path)).text());
	} catch {
		error(400, 'Transfer payload is missing or unreadable');
	}
	if (payload?.kind !== 'cdx-web-plan' || payload?.version !== 1) {
		error(400, 'Unsupported transfer payload (expected a cdx-web-plan v1 archive)');
	}

	const p = payload.plan ?? {};
	const plan = db
		.query(
			`INSERT INTO plans (case_id, name, jaw, pan_curve, settings, locked)
			 VALUES (?1, ?2, ?3, ?4, ?5, 1) RETURNING *`
		)
		.get(
			caseId,
			`${p.name ?? 'Received plan'} (received)`,
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

	db.query(
		`UPDATE transfers SET state = 'imported', unread = 0, updated_at = datetime('now') WHERE id = ?1`
	).run(transfer.id);
	logAudit(locals.user, 'plan.receive', `plan:${plan.id}`, `${transfer.number} → case:${caseId}`);

	return json({ planId: plan.id });
};
