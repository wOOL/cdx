import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlan, listImplants, listMeasurements, listNerves } from '$lib/server/db/repo';

/** Single-plan archive (no volume data) — coDiagnostiX-style quick plan exchange. */
export const GET: RequestHandler = async ({ params }) => {
	const plan = getPlan(Number(params.id));
	if (!plan) error(404, 'Plan not found');

	const payload = {
		version: 1,
		kind: 'cdx-web-plan',
		exported_at: new Date().toISOString(),
		plan: {
			name: plan.name,
			jaw: plan.jaw,
			pan_curve: plan.pan_curve,
			settings: plan.settings,
			approved: plan.approved
		},
		implants: listImplants(plan.id),
		nerves: listNerves(plan.id),
		measurements: listMeasurements(plan.id)
	};

	const safe = plan.name.replace(/[^\w-]+/g, '_');
	return new Response(JSON.stringify(payload, null, 1), {
		headers: {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="plan_${safe}.cdxplan.json"`
		}
	});
};
