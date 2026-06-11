import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, resolveData } from '$lib/server/db';
import { db } from '$lib/server/db';
import { getCase } from '$lib/server/db/repo';
import type { Model } from '$lib/types';
import { LIMITS, assertSize } from '$lib/server/uploadLimits';

const KINDS = new Set(['scan', 'segmentation', 'guide', 'waxup', 'other']);

/** Multipart upload: file=<stl/ply>, kind=scan|waxup|other, name=<display name> */
export const POST: RequestHandler = async ({ params, request }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No file uploaded');
	assertSize(file, LIMITS.model);
	const kind = KINDS.has(String(form.get('kind'))) ? String(form.get('kind')) : 'scan';
	const name = String(form.get('name') || file.name || 'Model');

	const ext = (file.name.split('.').pop() ?? 'stl').toLowerCase();
	if (!['stl', 'ply', 'obj'].includes(ext)) {
		error(400, `Unsupported model format .${ext} — use STL or PLY`);
	}

	const path = join(caseRel(caseId), `model_${crypto.randomUUID().slice(0, 8)}.${ext}`);
	const buf = await file.arrayBuffer();
	await Bun.write(resolveData(path), buf);
	const triCount = countTriangles(buf, ext);

	const model = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path, color)
			 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`
		)
		.get(caseId, name, kind, path, kind === 'segmentation' ? '#d8cfc0' : '#c8b89a') as Model;

	return json({ model, triCount });
};


/** cheap triangle count for the import-time optimize offer (null = unknown) */
function countTriangles(buf: ArrayBuffer, ext: string): number | null {
	try {
		const bytes = new Uint8Array(buf);
		if (ext === 'stl') {
			if (bytes.length < 84) return null;
			const head = new TextDecoder().decode(bytes.slice(0, 512));
			const ascii = head.trimStart().startsWith('solid') && head.includes('facet');
			if (!ascii) {
				const n = new DataView(buf).getUint32(80, true);
				// sanity: byte size must match the binary layout
				if (84 + n * 50 === bytes.length) return n;
				return n > 0 && n < 50_000_000 ? n : null;
			}
			return countToken(bytes, 'facet normal');
		}
		if (ext === 'ply') {
			const head = new TextDecoder().decode(bytes.slice(0, 4096));
			const m = /element\s+face\s+(\d+)/.exec(head);
			return m ? Number(m[1]) : null;
		}
		if (ext === 'obj') return countToken(bytes, '\nf ');
	} catch {
		// fall through
	}
	return null;
}

function countToken(bytes: Uint8Array, token: string): number {
	const t = new TextEncoder().encode(token);
	let count = 0;
	outer: for (let i = 0; i + t.length <= bytes.length; i++) {
		for (let j = 0; j < t.length; j++) {
			if (bytes[i + j] !== t[j]) continue outer;
		}
		count++;
		i += t.length - 1;
	}
	return count;
}
