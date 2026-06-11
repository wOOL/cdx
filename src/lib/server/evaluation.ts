/**
 * Treatment Evaluation module (SPEC §10.5, FEATURES §11 P4).
 *
 * Compares planned implant positions of a plan with the positions actually
 * achieved, as found in a postoperative model: either a scanbody model scan
 * or a CT/CBCT-derived surface model.
 *
 * Studies are stored in the settings table as a JSON array under the key
 * 'evaluation_studies' — no schema migration needed.
 *
 * Pipeline per study run:
 *  1. Load the study model mesh (triangle soup, model transform applied).
 *  2. Rigid-register it onto the planning base model of the same case
 *     (first model of kind 'scan'; identity when none exists) with ICP.
 *  3. For every planned implant, sample aligned mesh vertices within 4 mm of
 *     the planned head→apex segment and fit the achieved axis as the
 *     largest-variance principal direction (PCA via power iteration).
 *  4. Report per implant: entry deviation (planned head vs the closest point
 *     on the achieved axis line), apex deviation at the planned depth, and
 *     angular deviation. Fewer than 30 supporting points → 'insufficient data'.
 */
import { db, resolveData } from '$lib/server/db';
import { getSettings, listImplants, setSetting } from '$lib/server/db/repo';
import { parsePly, parseStl } from '$lib/server/stl';
import { applyMat4, icp, identityMat4, type Mat4, type Point3 } from '$lib/registration';
import type { Implant, Model } from '$lib/types';

export const EVALUATION_SETTINGS_KEY = 'evaluation_studies';

/** Mesh vertices farther than this from the planned segment are ignored (mm). */
const SAMPLE_RADIUS_MM = 4;
/** Minimum supporting vertices for a usable axis fit. */
const MIN_SAMPLES = 30;

export type StudyType = 'scanbody' | 'postopCT';

export interface ImplantDeviation {
	tooth: string;
	/** Entry deviation in mm, or 'insufficient data' when the axis fit failed. */
	entryMM: number | 'insufficient data';
	/** Apex deviation at the planned depth in mm (null when degenerate). */
	apexMM: number | null;
	/** Angle between planned and achieved axis in degrees (null when degenerate). */
	angleDeg: number | null;
	/** Number of mesh vertices that supported the fit. */
	samples: number;
}

export interface EvaluationResult {
	implants: ImplantDeviation[];
	/** RMS of the entry deviations over all implants with a valid fit (mm). */
	rms: number;
	/** RMS of the accepted ICP correspondences (mm); 0 when no base scan existed. */
	alignedRmsICP: number;
	ranAt: string;
}

export interface EvaluationStudy {
	id: string;
	name: string;
	caseId: number;
	planId: number;
	type: StudyType;
	/** The postop scan / CT-derived model (models table row). */
	modelId: number;
	createdAt: string;
	result?: EvaluationResult;
}

export interface StudyListing extends EvaluationStudy {
	caseTitle: string;
	patient: string;
	planName: string;
	modelName: string;
}

/* ------------------------------------------------------------------ */
/* storage (settings table, JSON under 'evaluation_studies')           */
/* ------------------------------------------------------------------ */

export function listStudies(): EvaluationStudy[] {
	try {
		const raw = getSettings()[EVALUATION_SETTINGS_KEY];
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? (parsed as EvaluationStudy[]) : [];
	} catch {
		return [];
	}
}

function saveStudies(studies: EvaluationStudy[]): void {
	setSetting(EVALUATION_SETTINGS_KEY, JSON.stringify(studies));
}

export function getStudy(id: string): EvaluationStudy | null {
	return listStudies().find((s) => s.id === id) ?? null;
}

export function createStudy(input: {
	name: string;
	caseId: number;
	planId: number;
	type: StudyType;
	modelId: number;
}): EvaluationStudy {
	const study: EvaluationStudy = {
		id: crypto.randomUUID(),
		name: input.name,
		caseId: input.caseId,
		planId: input.planId,
		type: input.type,
		modelId: input.modelId,
		createdAt: new Date().toISOString()
	};
	saveStudies([...listStudies(), study]);
	return study;
}

export function deleteStudy(id: string): boolean {
	const studies = listStudies();
	const next = studies.filter((s) => s.id !== id);
	if (next.length === studies.length) return false;
	saveStudies(next);
	return true;
}

export function setStudyResult(id: string, result: EvaluationResult): EvaluationStudy | null {
	const studies = listStudies();
	const idx = studies.findIndex((s) => s.id === id);
	if (idx < 0) return null;
	studies[idx] = { ...studies[idx], result };
	saveStudies(studies);
	return studies[idx];
}

/** Studies joined with case / patient / plan / model names for list views. */
export function listStudiesJoined(): StudyListing[] {
	return listStudies().map((s) => {
		const caseRow = db
			.query(
				`SELECT c.title AS title, TRIM(p.last_name || ', ' || p.first_name, ', ') AS patient
				 FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1`
			)
			.get(s.caseId) as { title: string; patient: string } | null;
		const planRow = db.query('SELECT name FROM plans WHERE id = ?1').get(s.planId) as {
			name: string;
		} | null;
		const modelRow = db.query('SELECT name FROM models WHERE id = ?1').get(s.modelId) as {
			name: string;
		} | null;
		return {
			...s,
			caseTitle: caseRow?.title ?? '(deleted case)',
			patient: caseRow?.patient ?? '',
			planName: planRow?.name ?? '(deleted plan)',
			modelName: modelRow?.name ?? '(deleted model)'
		};
	});
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function sub(a: Point3, b: Point3): Point3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Point3, b: Point3): number {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(a: Point3): number {
	return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Point3): Point3 {
	const l = len(a) || 1;
	return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** Squared distance from p to the segment a→b. */
function distSqToSegment(p: Point3, a: Point3, ab: Point3, abLenSq: number): number {
	const ap = sub(p, a);
	const t = abLenSq > 0 ? Math.max(0, Math.min(1, dot(ap, ab) / abLenSq)) : 0;
	const dx = ap.x - t * ab.x;
	const dy = ap.y - t * ab.y;
	const dz = ap.z - t * ab.z;
	return dx * dx + dy * dy + dz * dz;
}

/**
 * Largest-variance principal direction of a point cloud (PCA dominant
 * eigenvector of the 3x3 covariance, found by power iteration seeded with
 * the planned axis so the achieved direction converges fast and keeps a
 * deterministic sign reference).
 */
function principalAxis(
	points: Point3[],
	seed: Point3
): { centroid: Point3; dir: Point3 } | null {
	const n = points.length;
	if (n < 3) return null;

	let cx = 0;
	let cy = 0;
	let cz = 0;
	for (const p of points) {
		cx += p.x;
		cy += p.y;
		cz += p.z;
	}
	cx /= n;
	cy /= n;
	cz /= n;

	// symmetric covariance (xx, xy, xz, yy, yz, zz)
	let xx = 0;
	let xy = 0;
	let xz = 0;
	let yy = 0;
	let yz = 0;
	let zz = 0;
	for (const p of points) {
		const dx = p.x - cx;
		const dy = p.y - cy;
		const dz = p.z - cz;
		xx += dx * dx;
		xy += dx * dy;
		xz += dx * dz;
		yy += dy * dy;
		yz += dy * dz;
		zz += dz * dz;
	}
	xx /= n;
	xy /= n;
	xz /= n;
	yy /= n;
	yz /= n;
	zz /= n;

	// power iteration; tiny jitter keeps the seed from being exactly orthogonal
	let v = normalize({ x: seed.x + 1e-4, y: seed.y + 2e-4, z: seed.z + 3e-4 });
	for (let iter = 0; iter < 64; iter++) {
		const w = {
			x: xx * v.x + xy * v.y + xz * v.z,
			y: xy * v.x + yy * v.y + yz * v.z,
			z: xz * v.x + yz * v.y + zz * v.z
		};
		const l = len(w);
		if (l < 1e-12) return null; // no variance at all
		v = { x: w.x / l, y: w.y / l, z: w.z / l };
	}
	return { centroid: { x: cx, y: cy, z: cz }, dir: v };
}

/* ------------------------------------------------------------------ */
/* mesh loading                                                        */
/* ------------------------------------------------------------------ */

export function getModelRow(id: number): Model | null {
	return (db.query('SELECT * FROM models WHERE id = ?1').get(id) as Model) ?? null;
}

function parseTransform(m: Model): Mat4 | null {
	try {
		const t = m.transform ? JSON.parse(m.transform) : null;
		return Array.isArray(t) && t.length === 16 ? (t as Mat4) : null;
	} catch {
		return null;
	}
}

/** Triangle-soup vertices of a stored model, with its own transform applied. */
async function loadModelPoints(m: Model): Promise<Point3[]> {
	if (!m.file_path) throw new Error(`Model "${m.name}" has no mesh file`);
	const file = Bun.file(resolveData(m.file_path));
	if (!(await file.exists())) throw new Error(`Mesh file of model "${m.name}" is missing`);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const parsed = m.file_path.endsWith('.ply') ? parsePly(bytes) : parseStl(bytes);
	if (!parsed) throw new Error(`Could not parse mesh file of model "${m.name}"`);

	const t = parseTransform(m);
	const pos = parsed.positions;
	const out: Point3[] = new Array(pos.length / 3);
	for (let i = 0, j = 0; i < pos.length; i += 3, j++) {
		const p = { x: pos[i], y: pos[i + 1], z: pos[i + 2] };
		out[j] = t ? applyMat4(t, p) : p;
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* study execution                                                     */
/* ------------------------------------------------------------------ */

function round3(v: number): number {
	return Math.round(v * 1000) / 1000;
}

/**
 * Run a study: register the postop model to the case's planning base scan,
 * then measure per-implant deviations. Throws Error with a user-readable
 * message on unusable input (missing model, unparsable mesh, no implants).
 */
export async function runStudy(study: EvaluationStudy): Promise<EvaluationResult> {
	const model = getModelRow(study.modelId);
	if (!model || model.case_id !== study.caseId) {
		throw new Error('Study model no longer exists in this case');
	}
	const implants = listImplants(study.planId) as Implant[];
	if (implants.length === 0) {
		throw new Error('The selected plan has no implants to evaluate');
	}

	let points = await loadModelPoints(model);
	if (points.length === 0) throw new Error('Study model mesh is empty');

	// registration target: first 'scan' model of the case (excluding the study
	// model itself); identity alignment when the case has no base scan.
	const base = (db
		.query(
			`SELECT * FROM models WHERE case_id = ?1 AND kind = 'scan' AND id != ?2
			 ORDER BY created_at LIMIT 1`
		)
		.get(study.caseId, study.modelId) as Model | null) ?? null;

	let transform: Mat4 = identityMat4();
	let alignedRmsICP = 0;
	if (base) {
		const basePoints = await loadModelPoints(base);
		if (basePoints.length > 0) {
			const reg = icp(points, basePoints, {
				maxIterations: 50,
				maxPairDistance: 8,
				tolerance: 1e-5
			});
			if (Number.isFinite(reg.rms)) {
				transform = reg.transform;
				alignedRmsICP = reg.rms;
			}
		}
	}
	points = points.map((p) => applyMat4(transform, p));

	const deviations: ImplantDeviation[] = [];
	const radiusSq = SAMPLE_RADIUS_MM * SAMPLE_RADIUS_MM;

	for (const im of implants) {
		const head: Point3 = { x: im.x, y: im.y, z: im.z };
		const axis = normalize({ x: im.ax, y: im.ay, z: im.az });
		const length = im.length > 0 ? im.length : 10;
		const apex: Point3 = {
			x: head.x + axis.x * length,
			y: head.y + axis.y * length,
			z: head.z + axis.z * length
		};
		const seg = sub(apex, head);
		const segLenSq = dot(seg, seg);

		const samples: Point3[] = [];
		for (const p of points) {
			if (distSqToSegment(p, head, seg, segLenSq) <= radiusSq) samples.push(p);
		}

		const fit = samples.length >= MIN_SAMPLES ? principalAxis(samples, axis) : null;
		if (!fit) {
			deviations.push({
				tooth: im.tooth,
				entryMM: 'insufficient data',
				apexMM: null,
				angleDeg: null,
				samples: samples.length
			});
			continue;
		}

		// orient the achieved axis the same way as the planned axis
		let dir = fit.dir;
		if (dot(dir, axis) < 0) dir = { x: -dir.x, y: -dir.y, z: -dir.z };

		// entry deviation: planned head vs closest point on the achieved axis line
		const toHead = sub(head, fit.centroid);
		const along = dot(toHead, dir);
		const achievedEntry: Point3 = {
			x: fit.centroid.x + dir.x * along,
			y: fit.centroid.y + dir.y * along,
			z: fit.centroid.z + dir.z * along
		};
		const entryMM = len(sub(head, achievedEntry));

		// apex deviation at the planned depth along the achieved axis
		const achievedApex: Point3 = {
			x: achievedEntry.x + dir.x * length,
			y: achievedEntry.y + dir.y * length,
			z: achievedEntry.z + dir.z * length
		};
		const apexMM = len(sub(apex, achievedApex));

		const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot(axis, dir)))) * 180) / Math.PI;

		deviations.push({
			tooth: im.tooth,
			entryMM: round3(entryMM),
			apexMM: round3(apexMM),
			angleDeg: round3(angleDeg),
			samples: samples.length
		});
	}

	const numeric = deviations.filter((d) => typeof d.entryMM === 'number');
	const rms =
		numeric.length > 0
			? Math.sqrt(
					numeric.reduce((acc, d) => acc + (d.entryMM as number) ** 2, 0) / numeric.length
				)
			: 0;

	return {
		implants: deviations,
		rms: round3(rms),
		alignedRmsICP: round3(alignedRmsICP),
		ranAt: new Date().toISOString()
	};
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function fmt(v: number | null): string {
	return v == null ? '' : v.toFixed(2);
}

/** Deviation table as CSV (header + one row per implant). */
export function studyCsv(study: EvaluationStudy): string {
	const lines = ['tooth,entry_mm,apex_mm,angle_deg'];
	for (const d of study.result?.implants ?? []) {
		const entry = typeof d.entryMM === 'number' ? d.entryMM.toFixed(2) : d.entryMM;
		lines.push(`${d.tooth},${entry},${fmt(d.apexMM)},${fmt(d.angleDeg)}`);
	}
	return lines.join('\n') + '\n';
}
