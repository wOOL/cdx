/**
 * Guide generator §10-features test: synthetic hemisphere scan, two implants
 * with sleeves; exercises embossed labels, bone support regions, free-hand
 * contact polygons, reduction bars, large connectors, fitForm sleeve holes,
 * dual-scan intaglio merging and design-rule validation. Finally pokes the
 * live convertToModel endpoint (read-mode: never regenerates) if suitable
 * data exists, and cleans up everything it created.
 *   bun run scripts/test-guide2.ts
 */
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import {
	generateGuide,
	validateGuideDesign,
	GUIDE_RECIPES,
	type GuideImplant,
	type GuideMesh,
	type GuideParams
} from '../src/lib/server/guideGen';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}
function skip(name: string, why: string): void {
	console.log(`SKIP  ${name} (${why})`);
}

/* ---- synthetic hemisphere scan: dome over [0,60]x[0,40], radius 35 ---- */
const DOME_R = 35;
const domeZ = (x: number, y: number): number => {
	const d2 = (x - 30) * (x - 30) + (y - 20) * (y - 20);
	return Math.sqrt(Math.max(DOME_R * DOME_R - d2, 0));
};
function gridSoup(zOf: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number): Float32Array {
	const w = x1 - x0;
	const h = y1 - y0;
	const out = new Float32Array(w * h * 2 * 9);
	let o = 0;
	for (let y = y0; y < y1; y++) {
		for (let x = x0; x < x1; x++) {
			const z00 = zOf(x, y);
			const z10 = zOf(x + 1, y);
			const z11 = zOf(x + 1, y + 1);
			const z01 = zOf(x, y + 1);
			out.set([x, y, z00, x + 1, y, z10, x + 1, y + 1, z11], o);
			o += 9;
			out.set([x, y, z00, x + 1, y + 1, z11, x, y + 1, z01], o);
			o += 9;
		}
	}
	return out;
}
const scan = gridSoup(domeZ, 0, 60, 0, 40);

/* ---- two implants on the dome flanks, sleeves above the surface ---- */
const implants: GuideImplant[] = [
	{
		head: { x: 22, y: 20, z: 32 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 } // sleeve spans z 36..41
	},
	{
		head: { x: 38, y: 20, z: 32 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 }
	}
];

const vertsNear = (
	mesh: GuideMesh,
	test: (x: number, y: number, z: number) => boolean
): number => {
	let n = 0;
	for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
		if (test(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2])) n++;
	}
	return n;
};

/* ================= 1. baseline & full feature set ================= */

const baseParams: GuideParams = { largeConnectors: true };
const featureParams: GuideParams = {
	largeConnectors: true,
	mountHoleShape: 'fitForm',
	supportRegions: [{ x: 30, y: 32, radius: 5 }],
	contactPolygons: [
		[
			{ x: 28, y: 6 },
			{ x: 36, y: 6 },
			{ x: 36, y: 12 },
			{ x: 28, y: 12 }
		]
	],
	reductionBars: [{ x1: 24, y1: 27, x2: 36, y2: 27, width: 4, height: 3, zTop: 30 }]
};
const labelParams: GuideParams = {
	...featureParams,
	label: { text: 'AB-12', x: 24, y: 13, height: 3, depth: 0.8 }
};

const t0 = performance.now();
const baseline = generateGuide(scan, null, implants, baseParams);
const noLabel = generateGuide(scan, null, implants, featureParams);
const full = generateGuide(scan, null, implants, labelParams);
console.log(
	`generated baseline=${baseline.triangles} noLabel=${noLabel.triangles} ` +
		`full=${full.triangles} triangles in ${(performance.now() - t0).toFixed(0)}ms`
);

check('baseline mesh non-empty', baseline.triangles > 1000, `${baseline.triangles} tris`);
check('full-featured mesh non-empty', full.triangles > 1000, `${full.triangles} tris`);

/* ---- embossed label adds raised geometry ---- */
check(
	'label increases triangle count vs identical params without label',
	full.triangles > noLabel.triangles,
	`${noLabel.triangles} → ${full.triangles}`
);
// raised label voxels live above the cap top (capTop ≈ zSurf + 0.15 + 2.5)
const labelRaised = vertsNear(
	full,
	(x, y, z) => x >= 24 && x <= 36.5 && y >= 13 && y <= 16 && z > domeZ(x, y) + 2.75
);
check('label vertices raised above the cap top', labelRaised > 0, `${labelRaised} verts`);

/* ---- bone support region adds footprint away from implants ---- */
const supBase = vertsNear(baseline, (x, y) => Math.hypot(x - 30, y - 32) < 2);
const supFull = vertsNear(full, (x, y) => Math.hypot(x - 30, y - 32) < 2);
check('support region absent from baseline footprint', supBase === 0, `${supBase} verts`);
check('support region present in full footprint', supFull > 0, `${supFull} verts`);

/* ---- free-hand contact polygon adds footprint ---- */
// box y ≤ 10 stays clear of the regionRadius-wide connector capsule (y ≥ 11)
const polyBase = vertsNear(baseline, (x, y) => x >= 29 && x <= 35 && y >= 7 && y <= 10);
const polyFull = vertsNear(full, (x, y) => x >= 29 && x <= 35 && y >= 7 && y <= 10);
check('contact polygon absent from baseline footprint', polyBase === 0, `${polyBase} verts`);
check('contact polygon present in full footprint', polyFull > 0, `${polyFull} verts`);

/* ---- reduction bar: solid box below the cap (z 27..30) ---- */
const barBase = vertsNear(
	baseline,
	(x, y, z) => x >= 25 && x <= 35 && Math.abs(y - 27) <= 2.5 && z < 31
);
const barFull = vertsNear(
	full,
	(x, y, z) => x >= 25 && x <= 35 && Math.abs(y - 27) <= 2.5 && z < 31
);
check('reduction bar absent from baseline', barBase === 0, `${barBase} verts`);
check('reduction bar present in full mesh', barFull > 0, `${barFull} verts`);

/* ---- large connectors widen the corridor between implants ---- */
const smallConn = generateGuide(scan, null, implants, {});
// box around (30, 13): 6–8mm from the corridor segment and >9mm from both
// implant heads — inside a regionRadius-wide connector (large) but outside a
// regionRadius/2-wide one (default) and outside both head discs.
const corrSmall = vertsNear(smallConn, (x, y) => Math.abs(x - 30) <= 1 && Math.abs(y - 13) <= 1);
const corrLarge = vertsNear(baseline, (x, y) => Math.abs(x - 30) <= 1 && Math.abs(y - 13) <= 1);
check('default connector excludes 7mm-out point', corrSmall === 0, `${corrSmall} verts`);
check('large connector covers 7mm-out point', corrLarge > 0, `${corrLarge} verts`);

/* ================= 2. fitForm sleeve-mount holes ================= */

const one = [implants[0]];
const cyl = generateGuide(scan, null, one, { voxel: 0.2 });
const fit = generateGuide(scan, null, one, { voxel: 0.2, mountHoleShape: 'fitForm' });
check('fitForm mesh non-empty', fit.triangles > 500, `${fit.triangles} tris`);
const minBoreR = (mesh: GuideMesh, zLo: number, zHi: number): number => {
	let min = Infinity;
	for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
		const z = mesh.positions[i + 2];
		if (z < zLo || z > zHi) continue;
		const r = Math.hypot(mesh.positions[i] - 22, mesh.positions[i + 1] - 20);
		if (r < min) min = r;
	}
	return min;
};
const meanBoreR = (mesh: GuideMesh, zLo: number, zHi: number): number => {
	let sum = 0;
	let n = 0;
	for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
		const z = mesh.positions[i + 2];
		if (z < zLo || z > zHi) continue;
		const r = Math.hypot(mesh.positions[i] - 22, mesh.positions[i + 1] - 20);
		if (r < 3.4) {
			sum += r;
			n++;
		}
	}
	return n > 0 ? sum / n : NaN;
};
const cylMin = minBoreR(cyl, 36.5, 40.5);
const fitMin = minBoreR(fit, 36.5, 40.5);
check(
	'fitForm bore is never tighter than cylindrical',
	fitMin >= cylMin - 1e-6,
	`cyl ${cylMin.toFixed(3)} vs fit ${fitMin.toFixed(3)}`
);
const fitBottom = meanBoreR(fit, 36.1, 37.1); // near sleeve bottom: +0.15 clearance
const fitTop = meanBoreR(fit, 39.9, 40.9); // near sleeve top: +0.05 clearance
check(
	'fitForm bore is conical (wider at sleeve bottom than top)',
	fitBottom > fitTop + 0.02,
	`bottom ${fitBottom.toFixed(3)} vs top ${fitTop.toFixed(3)}`
);

/* ================= 3. dual-scan intaglio merging ================= */

// denture-bottom plateau raised above the dome between the implants
const plateau = gridSoup((x, y) => (x >= 27 && x <= 33 && y >= 14 && y <= 18 ? 36 : 0), 27, 33, 14, 18);
const dual = generateGuide(scan, null, implants, {}, plateau);
const topAt = (mesh: GuideMesh): number => {
	let top = -Infinity;
	for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
		if (Math.hypot(mesh.positions[i] - 30, mesh.positions[i + 1] - 16) > 1.5) continue;
		if (mesh.positions[i + 2] > top) top = mesh.positions[i + 2];
	}
	return top;
};
const baseTop = topAt(smallConn);
const dualTop = topAt(dual);
check(
	'dual-scan intaglio raises the seating surface under the plateau',
	dualTop > baseTop + 1,
	`top ${baseTop.toFixed(2)} → ${dualTop.toFixed(2)}`
);

/* ================= 4. design-rule validation ================= */

const okWarnings = validateGuideDesign(implants, labelParams, full);
check(
	'good design: no sleeve-distance or label warnings',
	!okWarnings.some((w) => w.includes('apart') || w.includes('Label')),
	okWarnings.join(' | ') || 'no warnings'
);

const badImplants: GuideImplant[] = [
	{
		head: { x: 30, y: 20, z: 32 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 }
	},
	{
		// 5.2mm centre distance, outer radii 2.5+2.5 → sleeves only 0.2mm apart
		head: { x: 35.2, y: 20, z: 32 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 }
	}
];
const badParams: GuideParams = {
	mountWall: 1.0,
	windows: [{ x: 30, y: 20, diameter: 4 }],
	label: { text: 'X', x: 100, y: 100 },
	reductionBars: [{ x1: 25, y1: 20, x2: 40, y2: 20, width: 4, height: 3, zTop: 31 }]
};
const emptyMesh: GuideMesh = {
	positions: new Float32Array(0),
	normals: new Float32Array(0),
	triangles: 0
};
const bad = validateGuideDesign(badImplants, badParams, emptyMesh);
console.log('bad-design warnings:\n  ' + bad.join('\n  '));
check('bad design: empty-mesh warning', bad.some((w) => w.includes('empty')));
check('bad design: thin-wall warning', bad.some((w) => w.includes('wall')));
check(
	'bad design: sleeves 0.2mm apart flagged',
	bad.some((w) => w.includes('0.20 mm apart')),
	bad.find((w) => w.includes('apart')) ?? 'missing'
);
check('bad design: window-overlaps-mount warning', bad.some((w) => w.includes('Window')));
check('bad design: label-outside-footprint warning', bad.some((w) => w.includes('Label')));
check('bad design: bar-intersects-channel warning', bad.some((w) => w.includes('Reduction bar')));

/* ================= 5. recipe presets ================= */

const keys = GUIDE_RECIPES.map((r) => r.key);
check(
	'recipes: all six presets defined',
	['standard', 'endodontic', 'apicoectomy', 'sinusLift', 'stacked', 'transplant'].every((k) =>
		keys.includes(k)
	),
	keys.join(', ')
);
const endo = GUIDE_RECIPES.find((r) => r.key === 'endodontic');
check(
	'recipes: endodontic preset params + note',
	endo?.params.regionRadius === 6 && endo?.params.thickness === 2 && /straight drill path/i.test(endo?.description ?? ''),
	JSON.stringify(endo?.params)
);
const stacked = GUIDE_RECIPES.find((r) => r.key === 'stacked');
check(
	'recipes: stacked preset uses large connectors + pin-support note',
	stacked?.params.largeConnectors === true && /pin-supported/i.test(stacked?.description ?? ''),
	stacked?.description.slice(0, 60)
);

/* ================= 6. live endpoint: convert guide → 3D model ================= */

async function liveEndpointTest(): Promise<void> {
	const name = 'live endpoint convertToModel';
	let reachable = false;
	try {
		const r = await fetch('http://localhost:5173/login', { redirect: 'manual' });
		reachable = r.status > 0;
	} catch {
		reachable = false;
	}
	if (!reachable) {
		skip(name, 'dev server not reachable on :5173');
		return;
	}

	const { db, resolveData } = await import('../src/lib/server/db');
	const { createSession } = await import('../src/lib/server/auth');

	const row = db
		.query(
			`SELECT m.id AS model_id, m.case_id, m.plan_id, m.file_path, p.locked, p.approved
			 FROM models m JOIN plans p ON p.id = m.plan_id
			 WHERE m.kind = 'guide' AND m.plan_id IS NOT NULL
			 ORDER BY m.id DESC`
		)
		.all() as {
		model_id: number;
		case_id: number;
		plan_id: number;
		file_path: string;
		locked: number;
		approved: number;
	}[];
	const target = row.find(
		(r) => !r.locked && !r.approved && r.file_path && existsSync(resolveData(r.file_path))
	);
	if (!target) {
		skip(name, 'no existing unlocked/unapproved plan with a generated guide');
		return;
	}

	const user = db.query(`SELECT id FROM users WHERE tier != 'viewer' ORDER BY id LIMIT 1`).get() as {
		id: number;
	} | null;
	if (!user) {
		skip(name, 'no non-viewer user account');
		return;
	}
	const session = createSession(user.id);

	let createdModelId: number | null = null;
	let createdFile: string | null = null;
	try {
		const res = await fetch(`http://localhost:5173/api/cases/${target.case_id}/guide`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: `cdx_session=${session.token}`
			},
			body: JSON.stringify({ planId: target.plan_id, convertToModel: true })
		});
		const bodyJson = (await res.json().catch(() => null)) as {
			model?: { id: number; kind: string; name: string; file_path: string };
		} | null;
		check(`${name}: 200 response`, res.ok, `status ${res.status}`);
		const m = bodyJson?.model;
		createdModelId = m?.id ?? null;
		createdFile = m?.file_path ?? null;
		check(
			`${name}: copy row kind 'other' named '… guide as model'`,
			m?.kind === 'other' && /guide as model$/.test(m?.name ?? ''),
			`${m?.kind} / ${m?.name}`
		);
		check(
			`${name}: copied STL exists and original untouched`,
			!!m &&
				existsSync(resolveData(m.file_path)) &&
				m.file_path !== target.file_path &&
				existsSync(resolveData(target.file_path)),
			m?.file_path
		);
		const origStill = db
			.query(`SELECT id FROM models WHERE id = ?1 AND kind = 'guide'`)
			.get(target.model_id);
		check(`${name}: original guide row untouched (no regeneration)`, !!origStill);
	} finally {
		// cleanup: remove the copied model row + file and the test session
		if (createdModelId) db.query('DELETE FROM models WHERE id = ?1').run(createdModelId);
		if (createdFile) await unlink(resolveData(createdFile)).catch(() => {});
		const hash = new Bun.CryptoHasher('sha256').update(session.token).digest('hex');
		db.query('DELETE FROM sessions WHERE token = ?1').run(hash);
	}
}

await liveEndpointTest();

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks passed');
