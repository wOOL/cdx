import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getCase, getDataset, logAudit } from '$lib/server/db/repo';
import { loadVolume } from '$lib/server/volumeCache';
import {
	detectMarkers,
	extractTemplateSurface,
	matchMarkers,
	type VolumeGrid
} from '$lib/server/markerReg';
import { meshToStlBinary } from '$lib/server/stl';
import type { Dataset, Model } from '$lib/types';

function asGrid(ds: Dataset, data: Int16Array): VolumeGrid {
	return {
		data,
		dims: [ds.cols, ds.rows, ds.slices],
		spacing: [ds.spacing_x, ds.spacing_y, ds.spacing_z]
	};
}

/**
 * Marker-based dual-scan template registration.
 *
 * Body: { patientDatasetId, templateDatasetId, apply?: boolean,
 *         surfaceThreshold?: number }
 *
 * Detects radiopaque fiducial markers in both volumes (template scanned in
 * the patient's mouth and alone) and matches template → patient. Without
 * `apply` this is a dry run returning markers, pairs, RMS and confidence —
 * nothing is written. With `apply: true` (refused with 409 when matching
 * failed) the template surface is extracted from the template dataset at
 * `surfaceThreshold` HU (default -300), transformed into patient space
 * (baked into the vertices; model.transform stays unset) and stored as a
 * 'scan' model named 'Template (dual scan)'.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const raw = await request.json().catch(() => null);
	if (raw === null || typeof raw !== 'object') error(400, 'Invalid JSON body');
	const body = raw as Record<string, unknown>;

	const patientDatasetId = Number(body.patientDatasetId);
	const templateDatasetId = Number(body.templateDatasetId);
	if (!Number.isInteger(patientDatasetId) || !Number.isInteger(templateDatasetId)) {
		error(400, 'patientDatasetId and templateDatasetId are required');
	}
	if (patientDatasetId === templateDatasetId) {
		error(400, 'Patient and template scan must be different datasets');
	}
	const apply = body.apply === true;
	let surfaceThreshold = -300;
	if (body.surfaceThreshold !== undefined) {
		surfaceThreshold = Number(body.surfaceThreshold);
		if (!Number.isFinite(surfaceThreshold) || surfaceThreshold < -1000 || surfaceThreshold > 3000) {
			error(400, 'surfaceThreshold must be a number between -1000 and 3000 HU');
		}
	}

	const dsPatient = getDataset(patientDatasetId);
	if (!dsPatient || dsPatient.case_id !== caseId) error(404, 'Patient dataset not found in this case');
	const dsTemplate = getDataset(templateDatasetId);
	if (!dsTemplate || dsTemplate.case_id !== caseId) error(404, 'Template dataset not found in this case');

	const gridPatient = asGrid(dsPatient, await loadVolume(dsPatient));
	const gridTemplate = asGrid(dsTemplate, await loadVolume(dsTemplate));

	const markersPatient = detectMarkers(gridPatient);
	const markersTemplate = detectMarkers(gridTemplate);
	// pairs: si indexes markersTemplate, di indexes markersPatient
	const match = matchMarkers(markersTemplate, markersPatient);

	const base = {
		markersPatient,
		markersTemplate,
		pairs: match.pairs,
		rmsMM: Number.isFinite(match.rmsMM) ? match.rmsMM : null,
		confidence: match.confidence,
		...(match.reason ? { reason: match.reason } : {})
	};

	if (!apply) return json(base);

	if (match.confidence === 'failed' || !match.transform) {
		error(409, `Cannot apply template match: ${match.reason ?? 'matching failed'}`);
	}

	const surface = extractTemplateSurface(gridTemplate, surfaceThreshold);
	if (surface.length === 0) {
		error(400, `No template surface found at ${surfaceThreshold} HU`);
	}

	// Bake the template→patient transform into the vertices.
	const m = match.transform;
	for (let i = 0; i < surface.length; i += 3) {
		const x = surface[i];
		const y = surface[i + 1];
		const z = surface[i + 2];
		surface[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
		surface[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
		surface[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
	}

	const name = 'Template (dual scan)';
	const path = join(caseRel(caseId), `template_${crypto.randomUUID().slice(0, 8)}.stl`);
	await Bun.write(resolveData(path), meshToStlBinary(surface, name));

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color, params)
			 VALUES (?1, ?2, 'scan', ?3, '#bcd2e8', ?4) RETURNING *`
		)
		.get(
			caseId,
			name,
			path,
			JSON.stringify({
				source: 'template-match',
				patient_dataset_id: dsPatient.id,
				template_dataset_id: dsTemplate.id,
				rms_mm: match.rmsMM,
				pairs: match.pairs.length,
				confidence: match.confidence,
				surface_threshold: surfaceThreshold
			})
		) as Model;

	logAudit(
		locals.user,
		'template.match',
		`case:${caseId}`,
		`template ds:${dsTemplate.id} → patient ds:${dsPatient.id} rms ${match.rmsMM.toFixed(3)} mm, ` +
			`${match.pairs.length} pairs → model:${model.id}`
	);

	return json({ ...base, model, triangles: surface.length / 9 });
};
