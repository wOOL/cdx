import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LIMITS, assertSize, unzipGuarded } from '$lib/server/uploadLimits';
import { preflightDicom } from '$lib/server/dicom/importAdvanced';
import { getCase } from '$lib/server/db/repo';

/**
 * Header-only analysis of an uploaded DICOM set — no volume is built and
 * nothing is stored. Accepts the same multipart body as the import endpoint
 * (raw files or zip archives under the `files` key).
 *
 * The client sends the SAME FileList here first and then to the import
 * endpoint: browser File objects persist between requests, so no server-side
 * caching of the upload is needed.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	if (!getCase(caseId)) error(404, 'Case not found');

	const form = await request.formData();
	const files = form.getAll('files').filter((f): f is File => f instanceof File);
	if (files.length === 0) error(400, 'No files uploaded');
	assertSize(files, LIMITS.dicom);

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
		return json(preflightDicom(buffers));
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'DICOM preflight failed');
	}
};
