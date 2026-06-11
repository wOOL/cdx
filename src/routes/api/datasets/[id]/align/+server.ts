import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { caseDir, db } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import { evictVolume, loadVolume } from '$lib/server/volumeCache';
import { rotateVolume } from '$lib/server/resample';
import { buildPreview } from '$lib/server/dicom/import';

function angle(v: unknown): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-45, Math.min(45, n));
}

/**
 * Body: { yaw?: number, pitch?: number, roll?: number } (degrees, each clamped
 * to [-45, 45]) → bakes the rotation into the volume (resample about the
 * center in mm space) and replaces the dataset's volume + preview files.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const yaw = angle(body.yaw);
	const pitch = angle(body.pitch);
	const roll = angle(body.roll);
	if (yaw === 0 && pitch === 0 && roll === 0) error(400, 'nothing to do');

	const vol = await loadVolume(ds);
	const rotated = rotateVolume(
		vol,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		yaw,
		pitch,
		roll
	);

	const preview = buildPreview({
		volume: rotated,
		cols: ds.cols,
		rows: ds.rows,
		slices: ds.slices,
		spacing: [ds.spacing_x, ds.spacing_y, ds.spacing_z],
		windowCenter: ds.window_center,
		windowWidth: ds.window_width,
		patientName: ds.patient_name,
		patientBirthDate: '',
		patientSex: '',
		studyDate: ds.study_date,
		modality: ds.modality,
		seriesDescription: ds.series_description
	});

	const dir = caseDir(ds.case_id);
	const stamp = crypto.randomUUID().slice(0, 8);
	const volPath = join(dir, `vol_${stamp}.i16`);
	const prevPath = join(dir, `vol_${stamp}_preview.u8`);
	await Bun.write(volPath, new Uint8Array(rotated.buffer, 0, rotated.byteLength));
	await Bun.write(prevPath, preview.data);

	db.query(
		`UPDATE datasets SET
			volume_path = ?2, preview_path = ?3,
			preview_cols = ?4, preview_rows = ?5, preview_slices = ?6
		 WHERE id = ?1`
	).run(ds.id, volPath, prevPath, preview.cols, preview.rows, preview.slices);

	evictVolume(ds.id);
	await unlink(ds.volume_path).catch(() => {});
	await unlink(ds.preview_path).catch(() => {});

	return json({ dataset: getDataset(ds.id) });
};
