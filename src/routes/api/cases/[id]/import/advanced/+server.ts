import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LIMITS, assertSize, unzipGuarded } from '$lib/server/uploadLimits';
import { importDicomToCaseAdvanced } from '$lib/server/dicom/importAdvanced';
import type { AdvancedImportOptions } from '$lib/dicomImportTypes';
import { getCase } from '$lib/server/db/repo';

/**
 * Advanced DICOM import: multipart `files` (raw or zipped, same shape as the
 * simple import endpoint) plus a stringified-JSON `options` field
 * (AdvancedImportOptions). Returns { dataset, warnings }.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	if (!getCase(caseId)) error(404, 'Case not found');

	const form = await request.formData();
	const files = form.getAll('files').filter((f): f is File => f instanceof File);
	if (files.length === 0) error(400, 'No files uploaded');
	assertSize(files, LIMITS.dicom);

	let opts: AdvancedImportOptions = {};
	const raw = form.get('options');
	if (typeof raw === 'string' && raw) {
		try {
			opts = JSON.parse(raw) as AdvancedImportOptions;
		} catch {
			error(400, 'Invalid options JSON');
		}
	}

	const buffers: Uint8Array[] = [];
	for (const f of files) {
		const bytes = new Uint8Array(await f.arrayBuffer());
		const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
		if (isZip) {
			const entries = unzipGuarded(bytes);
			for (const [name, data] of Object.entries(entries)) {
				if (!name.endsWith('/') && data.length > 0) buffers.push(data);
			}
		} else {
			buffers.push(bytes);
		}
	}

	try {
		const { dataset, warnings } = await importDicomToCaseAdvanced(
			caseId,
			buffers,
			opts,
			request.signal
		);
		return json({ dataset, warnings });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'DICOM import failed');
	}
};
