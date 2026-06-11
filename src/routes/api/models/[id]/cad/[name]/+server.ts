import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, resolveData } from '$lib/server/db';
import { parsePly, parseStl, meshToStlBinary } from '$lib/server/stl';
import { decimateMesh } from '$lib/server/segLod';
import type { Model } from '$lib/types';

/**
 * Suffix-named STL of the model, for consumers that infer the format from the
 * URL's final path segment (the embedded CAD's loadFileFromUrl). `name` is
 * display-only; the bytes always come from the model's own file.
 *
 * The bridge imports STL as a display MeshNode (OCCT's StlAPI sewing path
 * hangs on large organic meshes), which handles full-resolution anatomy.
 * Decimation remains as a safety valve for extreme meshes; the planning-side
 * file is never touched — only the copy sent to the CAD.
 */
const TRIANGLE_CAP = 400_000;

/** model id → { mtimeMs, bytes, triangles } for decimated handoffs */
const cadCache = new Map<number, { mtimeMs: number; bytes: Uint8Array; triangles: number }>();

export const GET: RequestHandler = async ({ params }) => {
	if (!/^[\w\-. %]+\.(stl|ply)$/i.test(params.name)) error(404, 'Not found');
	const m = db.query('SELECT * FROM models WHERE id = ?1').get(Number(params.id)) as Model | null;
	if (!m || !m.file_path) error(404, 'Model not found');
	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) error(404, 'Model file missing');

	const raw = new Uint8Array(await file.arrayBuffer());
	const parsed = m.file_path.toLowerCase().endsWith('.ply') ? parsePly(raw) : parseStl(raw);
	if (!parsed) error(422, 'Model file could not be parsed');
	const mesh = parsed.positions;

	let triangles = mesh.length / 9;
	let bytes: Uint8Array;
	if (triangles <= TRIANGLE_CAP && m.file_path.toLowerCase().endsWith('.stl')) {
		bytes = raw; // small STL: pass through untouched
	} else {
		const cached = cadCache.get(m.id);
		const mtimeMs = file.lastModified;
		if (cached && cached.mtimeMs === mtimeMs) {
			bytes = cached.bytes;
			triangles = cached.triangles;
		} else {
			let pos: Float32Array = mesh;
			let cell = 0.3;
			while (pos.length / 9 > TRIANGLE_CAP && cell <= 5) {
				pos = decimateMesh(mesh, cell);
				cell *= 1.5;
			}
			triangles = pos.length / 9;
			bytes = meshToStlBinary(pos, m.name);
			cadCache.set(m.id, { mtimeMs, bytes, triangles });
		}
	}

	return new Response(bytes.slice().buffer as ArrayBuffer, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Triangles': String(triangles),
			'Cache-Control': 'private, max-age=60'
		}
	});
};
