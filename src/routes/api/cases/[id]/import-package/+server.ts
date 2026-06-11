import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { caseRel, db, resolveData } from '$lib/server/db';
import { getCase, getMasterPlan, listModels, logAudit, touchCase } from '$lib/server/db/repo';
import { LIMITS, assertSize, unzipGuarded } from '$lib/server/uploadLimits';
import { parseStl } from '$lib/server/stl';
import { filterLines, implantColor } from '$lib/implantLibrary';
import type { Implant, Model } from '$lib/types';

interface Proposal {
	tooth: string;
	manufacturer: string;
	line: string;
	diameter: number;
	length: number;
	x: number;
	y: number;
	z: number;
	ax: number;
	ay: number;
	az: number;
	/** matches an IMPLANT_LIBRARY line incl. diameter/length — false = warning row */
	known: boolean;
}

export interface PackageManifest {
	scan: { present: boolean; triangles: number };
	restoration: { present: boolean; triangles: number };
	proposals: Proposal[];
}

/**
 * "Import from device or service" stub (SPEC §2.2 step 1, FEATURES §3 P4).
 *
 * Order-inbox integration point: a future implementation lists received
 * order packages (DWOS Connect / 3Shape Communicate equivalents, fed by the
 * transfers inbox) as { sources: [{ id, label }] } so ProstheticImportDialog
 * can offer them next to the local file upload. Intentionally always empty
 * for now — the dialog renders its source select disabled.
 */
export const GET: RequestHandler = async ({ params }) => {
	const c = getCase(Number(params.id));
	if (!c) error(404, 'Case not found');
	return json({ sources: [] });
};

/** Library check: manufacturer/line must exist and offer the proposed size. */
function isKnown(p: Proposal): boolean {
	return filterLines({ manufacturer: p.manufacturer, outdated: 'include' }).some(
		(l) => l.line === p.line && l.diameters.includes(p.diameter) && l.lengths.includes(p.length)
	);
}

function articleFor(p: Proposal): string {
	const line = filterLines({ manufacturer: p.manufacturer, outdated: 'include' }).find(
		(l) => l.line === p.line
	);
	return line?.article ?? '';
}

function parseProposals(bytes: Uint8Array): Proposal[] {
	let data: unknown;
	try {
		data = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		error(400, 'proposals.json is not valid JSON');
	}
	const list = (data as { implants?: unknown }).implants;
	if (!Array.isArray(list)) error(400, 'proposals.json must contain an "implants" array');
	return list.map((raw) => {
		const r = (raw ?? {}) as Record<string, unknown>;
		const p: Proposal = {
			tooth: String(r.tooth ?? ''),
			manufacturer: String(r.manufacturer ?? 'Generic'),
			line: String(r.line ?? ''),
			diameter: Number(r.diameter),
			length: Number(r.length),
			x: Number(r.x) || 0,
			y: Number(r.y) || 0,
			z: Number(r.z) || 0,
			ax: Number(r.ax) || 0,
			ay: Number(r.ay) || 0,
			az: Number(r.az ?? -1),
			known: false
		};
		if (!(p.diameter > 0) || !(p.length > 0)) {
			error(400, 'proposals.json: every implant needs a positive diameter and length');
		}
		p.known = isKnown(p);
		return p;
	});
}

/**
 * Prosthetic design import — order package (SPEC §2.4).
 *
 * Multipart body: { file: <zip>, preview?: 'true', acceptProposals?: 'true' }.
 * The zip may contain any subset of scan.stl / restoration.stl /
 * proposals.json ({ implants: [{ tooth, manufacturer, line, diameter,
 * length, x, y, z, ax, ay, az }] }); entries are matched by basename.
 *
 * - preview=true → returns { manifest } and writes NOTHING (dry run).
 * - otherwise    → imports the present pieces: scan → model kind 'scan',
 *   restoration → model kind 'waxup'. Proposals become implants on the
 *   case's MASTER plan only when acceptProposals=true (409 if it is
 *   locked). Unknown articles (not in IMPLANT_LIBRARY) still import as
 *   written — the implant row carries explicit dimensions — but are flagged
 *   known:false in the manifest so the dialog shows a warning row.
 *   Same-name model rows get a ' (2)' / ' (3)' … suffix (overwrite
 *   handling). Returns { manifest, models, implantsAdded }.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const caseId = Number(params.id);
	const c = getCase(caseId);
	if (!c) error(404, 'Case not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'No package uploaded');
	assertSize(file, LIMITS.archive);
	const preview = String(form.get('preview') ?? '') === 'true';
	const acceptProposals = String(form.get('acceptProposals') ?? '') === 'true';

	const entries = unzipGuarded(new Uint8Array(await file.arrayBuffer()));
	const byBase = new Map<string, Uint8Array>();
	for (const [name, data] of Object.entries(entries)) {
		if (name.endsWith('/') || data.length === 0 || name.startsWith('__MACOSX')) continue;
		const base = name.split('/').pop()!.toLowerCase();
		if (!byBase.has(base)) byBase.set(base, data);
	}
	const scanBytes = byBase.get('scan.stl');
	const restoBytes = byBase.get('restoration.stl');
	const propBytes = byBase.get('proposals.json');
	if (!scanBytes && !restoBytes && !propBytes) {
		error(400, 'Package contains none of scan.stl / restoration.stl / proposals.json');
	}

	const scanMesh = scanBytes ? parseStl(scanBytes) : null;
	if (scanBytes && !scanMesh) error(400, 'scan.stl is not a readable STL');
	const restoMesh = restoBytes ? parseStl(restoBytes) : null;
	if (restoBytes && !restoMesh) error(400, 'restoration.stl is not a readable STL');
	const proposals = propBytes ? parseProposals(propBytes) : [];

	const manifest: PackageManifest = {
		scan: { present: !!scanMesh, triangles: scanMesh ? scanMesh.positions.length / 9 : 0 },
		restoration: {
			present: !!restoMesh,
			triangles: restoMesh ? restoMesh.positions.length / 9 : 0
		},
		proposals
	};

	if (preview) return json({ manifest });

	// resolve the master plan (and its lock) BEFORE any file is written so a
	// 409 can never leave a half-imported package behind
	const plan = acceptProposals && proposals.length ? getMasterPlan(caseId) : null;
	if (plan?.locked) error(409, 'Master plan is locked — unlock it to accept implant proposals');

	const taken = new Set(listModels(caseId).map((m) => m.name));
	const uniqueName = (base: string): string => {
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
		taken.add(name);
		return name;
	};

	const models: Model[] = [];
	const writePiece = async (
		base: string,
		kind: string,
		color: string,
		bytes: Uint8Array
	): Promise<void> => {
		const rel = join(caseRel(caseId), `model_${crypto.randomUUID().slice(0, 8)}.stl`);
		await Bun.write(resolveData(rel), bytes);
		const row = db
			.query(
				`INSERT INTO models (case_id, name, kind, file_path, color)
				 VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`
			)
			.get(caseId, uniqueName(base), kind, rel, color) as Model;
		models.push(row);
	};
	if (scanBytes) await writePiece('Scan', 'scan', '#c8b89a', scanBytes);
	if (restoBytes) await writePiece('Restoration', 'waxup', '#e8d8b0', restoBytes);

	let implantsAdded = 0;
	if (plan) {
		for (const p of proposals) {
			db.query(
				`INSERT INTO implants (plan_id, tooth, manufacturer, line, article, diameter, length,
					x, y, z, ax, ay, az, color)
				 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) RETURNING *`
			).get(
				plan.id,
				p.tooth,
				p.manufacturer,
				p.line,
				articleFor(p),
				p.diameter,
				p.length,
				p.x,
				p.y,
				p.z,
				p.ax,
				p.ay,
				p.az,
				implantColor(implantsAdded)
			) as Implant;
			implantsAdded++;
		}
	}

	touchCase(caseId);
	logAudit(
		locals.user,
		'package.import',
		`case:${caseId}`,
		`${file.name} → ${models.length} model(s), ${implantsAdded} implant(s)`
	);
	return json({ manifest, models, implantsAdded });
};
