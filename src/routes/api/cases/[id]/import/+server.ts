import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unzipSync } from 'fflate';
import { importDicomToCase } from '$lib/server/dicom/import';
import { getCase } from '$lib/server/db/repo';

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

	try {
		const dataset = await importDicomToCase(caseId, buffers);
		return json({ dataset });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'DICOM import failed');
	}
};
