import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unzipSync } from 'fflate';
import { join } from 'node:path';
import { buildPreview, buildVolume } from '$lib/server/dicom/import';
import { caseDir } from '$lib/server/db';
import { createDataset, getCase, updateCase } from '$lib/server/db/repo';

export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const form = await request.formData();
	const files = form.getAll('files').filter((f): f is File => f instanceof File);
	if (files.length === 0) error(400, 'No files uploaded');

	const buffers: Uint8Array[] = [];
	for (const f of files) {
		const bytes = new Uint8Array(await f.arrayBuffer());
		const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
		if (isZip) {
			try {
				const entries = unzipSync(bytes);
				for (const [name, data] of Object.entries(entries)) {
					if (!name.endsWith('/') && data.length > 0) buffers.push(data);
				}
			} catch {
				error(400, `Could not read zip archive ${f.name}`);
			}
		} else {
			buffers.push(bytes);
		}
	}

	let vol;
	try {
		vol = buildVolume(buffers);
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'DICOM import failed');
	}
	const preview = buildPreview(vol);

	const dir = caseDir(caseId);
	const stamp = crypto.randomUUID().slice(0, 8);
	const volPath = join(dir, `vol_${stamp}.i16`);
	const prevPath = join(dir, `vol_${stamp}_preview.u8`);
	await Bun.write(volPath, new Uint8Array(vol.volume.buffer, vol.volume.byteOffset, vol.volume.byteLength));
	await Bun.write(prevPath, preview.data);

	const dataset = createDataset({
		case_id: caseId,
		kind: 'ct',
		description: `${vol.modality} ${vol.cols}×${vol.rows}×${vol.slices}`,
		cols: vol.cols,
		rows: vol.rows,
		slices: vol.slices,
		spacing_x: vol.spacing[0],
		spacing_y: vol.spacing[1],
		spacing_z: vol.spacing[2],
		window_center: vol.windowCenter,
		window_width: vol.windowWidth,
		patient_name: vol.patientName,
		study_date: vol.studyDate,
		modality: vol.modality,
		series_description: vol.seriesDescription,
		volume_path: volPath,
		preview_path: prevPath,
		preview_cols: preview.cols,
		preview_rows: preview.rows,
		preview_slices: preview.slices
	});

	if (c.status === 'new') updateCase(caseId, { status: 'planning' });

	return json({ dataset });
};
