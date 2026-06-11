/**
 * Guide generator stage-2 features test (dual-scan / coDX 9.10 gaps):
 *  - impressed (engraved) vs embossed labels — sampled surface heights
 *  - cutGuideToolPaths: drill corridors + inspection windows cut through an
 *    arbitrary merged mesh ("Add object")
 *  - guideFootprintOutline: client-side cut-profile preview loops
 *  - live guide endpoint invoked DIRECTLY (no dev server / browser): intaglio
 *    param passthrough via params.intaglioModelId, mergeModelIds shells in the
 *    output STL with window/corridor cuts, persisted generation params.
 * Creates its own temporary patient/case/plan/models in the database and
 * cleans everything up. Run from the repo root:
 *   bun run scripts/test-guide3.ts
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
	cutGuideToolPaths,
	generateGuide,
	type GuideImplant,
	type GuideMesh
} from '../src/lib/server/guideGen';
import { guideFootprintOutline } from '../src/lib/guideFootprint';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

/* ---- synthetic hemisphere scan: dome over [0,60]x[0,40], radius 35 ---- */
const DOME_R = 35;
const domeZ = (x: number, y: number): number => {
	const d2 = (x - 30) * (x - 30) + (y - 20) * (y - 20);
	return Math.sqrt(Math.max(DOME_R * DOME_R - d2, 0));
};
function gridSoup(
	zOf: (x: number, y: number) => number,
	x0: number,
	x1: number,
	y0: number,
	y1: number
): Float32Array {
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

/* ================= 1. impressed (engraved) label ================= */

// Label 'H' (left glyph column lit on all 7 rows); sample the surface height
// at the centre of that stroke for: no label / embossed / impressed.
const LBL = { text: 'H', x: 25, y: 14, height: 5, depth: 0.8 };
const cell = LBL.height / 7;
const sx = LBL.x + cell * 0.5; // centre of the left stroke
const sy = LBL.y + cell * 3.5;
const capTopAt = domeZ(sx, sy) + 0.15 + 2.5;

const common = { largeConnectors: true, voxel: 0.2 };
const meshNone = generateGuide(scan, null, implants, common);
const meshEmb = generateGuide(scan, null, implants, {
	...common,
	label: { ...LBL, style: 'embossed' }
});
const meshImp = generateGuide(scan, null, implants, {
	...common,
	label: { ...LBL, style: 'impressed' }
});

const maxZNear = (mesh: GuideMesh, px: number, py: number, r: number): number => {
	let top = -Infinity;
	for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
		if (Math.hypot(mesh.positions[i] - px, mesh.positions[i + 1] - py) > r) continue;
		if (mesh.positions[i + 2] > top) top = mesh.positions[i + 2];
	}
	return top;
};
const zNone = maxZNear(meshNone, sx, sy, 0.3);
const zEmb = maxZNear(meshEmb, sx, sy, 0.3);
const zImp = maxZNear(meshImp, sx, sy, 0.3);
console.log(
	`label stroke heights @(${sx.toFixed(2)},${sy.toFixed(2)}): capTop≈${capTopAt.toFixed(2)} ` +
		`none=${zNone.toFixed(2)} embossed=${zEmb.toFixed(2)} impressed=${zImp.toFixed(2)}`
);
check('embossed label raises the stroke surface', zEmb > zNone + 0.4, `${zNone.toFixed(2)} → ${zEmb.toFixed(2)}`);
check('impressed label lowers the stroke surface', zImp < zNone - 0.4, `${zNone.toFixed(2)} → ${zImp.toFixed(2)}`);
check(
	'impressed engraving depth ≈ label depth',
	Math.abs(zNone - zImp - LBL.depth) < 0.45,
	`engraved ${(zNone - zImp).toFixed(2)} mm vs ${LBL.depth} mm`
);
// sample around the RIGHT glyph stroke — far enough from both sleeve mounts
// that the disc only sees cap (and label) geometry
const rx = LBL.x + cell * 4.5;
const capTopR = domeZ(rx, sy) + 0.15 + 2.5;
check(
	'impressed label adds no raised geometry above the cap',
	maxZNear(meshImp, rx, sy, 2) < capTopR + 0.35,
	`top ${maxZNear(meshImp, rx, sy, 2).toFixed(2)} vs capTop ${capTopR.toFixed(2)}`
);

/* ================= 2. cutGuideToolPaths (merged-mesh tool paths) ================= */

// Flat plate at z=50 (well above the guide) crossing both drill corridors and
// one inspection window.
const plate = gridSoup(() => 50, 10, 50, 10, 30);
const windows = [{ x: 30, y: 25, diameter: 6 }];
const cutPlate = cutGuideToolPaths(plate, implants, { windows });
const soupArea = (pos: Float32Array): number => {
	let a = 0;
	for (let i = 0; i + 8 < pos.length; i += 9) {
		const ux = pos[i + 3] - pos[i];
		const uy = pos[i + 4] - pos[i + 1];
		const uz = pos[i + 5] - pos[i + 2];
		const vx = pos[i + 6] - pos[i];
		const vy = pos[i + 7] - pos[i + 1];
		const vz = pos[i + 8] - pos[i + 2];
		a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
	}
	return a;
};
// triangle COUNT may grow (boundary subdivision) but surface AREA must drop by
// roughly the two corridor discs + the window disc
const removed = soupArea(plate) - soupArea(cutPlate);
const expected = 2 * Math.PI * 2.5 * 2.5 + Math.PI * 3 * 3;
check(
	'cut removes ≈ the corridor + window disc area',
	cutPlate.length > 0 && Math.abs(removed - expected) < expected * 0.25,
	`removed ${removed.toFixed(1)} mm² vs expected ≈${expected.toFixed(1)} mm²`
);
const vertsWhere = (pos: Float32Array, test: (x: number, y: number, z: number) => boolean): number => {
	let n = 0;
	for (let i = 0; i + 2 < pos.length; i += 3) {
		if (test(pos[i], pos[i + 1], pos[i + 2])) n++;
	}
	return n;
};
const inCorr1 = vertsWhere(cutPlate, (x, y) => Math.hypot(x - 22, y - 20) < 1.4);
const inCorr2 = vertsWhere(cutPlate, (x, y) => Math.hypot(x - 38, y - 20) < 1.4);
const inWin = vertsWhere(cutPlate, (x, y) => Math.hypot(x - 30, y - 25) < 2.0);
check('drill corridors cleared through the plate', inCorr1 === 0 && inCorr2 === 0, `${inCorr1}/${inCorr2} verts`);
check('inspection window cleared through the plate', inWin === 0, `${inWin} verts`);
check(
	'geometry away from the cuts is preserved',
	vertsWhere(cutPlate, (x, y) => Math.hypot(x - 15, y - 15) < 2) > 0
);
// corridors only cut from the implant head upward — a plate below stays intact
const plateLow = gridSoup(() => 20, 10, 50, 10, 30);
const cutLow = cutGuideToolPaths(plateLow, implants, {});
check(
	'corridor cut is gated below the implant head',
	cutLow.length === plateLow.length,
	`${plateLow.length / 9} → ${cutLow.length / 9} tris`
);

/* ================= 3. footprint outline helper ================= */

const STEP = 0.5;
const fpBase = { implants: [{ x: 22, y: 20 }, { x: 38, y: 20 }], regionRadius: 9, step: STEP };
const loops = guideFootprintOutline(fpBase);
const closedish = (loop: { x: number; y: number }[]): boolean =>
	loop.length >= 8 &&
	Math.hypot(loop[0].x - loop[loop.length - 1].x, loop[0].y - loop[loop.length - 1].y) <= STEP * 1.5;
check('2-implant footprint yields one outline loop', loops.length === 1, `${loops.length} loops`);
check('outline loop is closed-ish', loops.every(closedish), `${loops[0]?.length ?? 0} points`);
const insideLoops = (lps: { x: number; y: number }[][], px: number, py: number): boolean => {
	let inside = false;
	for (const loop of lps) {
		for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
			const yi = loop[i].y;
			const yj = loop[j].y;
			if (yi > py === yj > py) continue;
			const xc = loop[j].x + ((py - yj) / (yi - yj)) * (loop[i].x - loop[j].x);
			if (px < xc) inside = !inside;
		}
	}
	return inside;
};
check(
	'outline encloses both implants and the connector',
	insideLoops(loops, 22, 20) && insideLoops(loops, 38, 20) && insideLoops(loops, 30, 20)
);
check(
	'outline excludes points outside the footprint',
	!insideLoops(loops, 30, 26) && !insideLoops(loops, 50, 20)
);
const loopsSup = guideFootprintOutline({
	...fpBase,
	supportRegions: [{ x: 30, y: 32, radius: 5 }]
});
check(
	'detached support region adds a second closed loop',
	loopsSup.length === 2 && loopsSup.every(closedish) && insideLoops(loopsSup, 30, 32),
	`${loopsSup.length} loops`
);
const loopsLarge = guideFootprintOutline({ ...fpBase, largeConnectors: true });
check(
	'large connectors widen the outline',
	insideLoops(loopsLarge, 30, 26) && !insideLoops(loops, 30, 26)
);

/* ================= 4. guide endpoint: intaglio passthrough + Add object ================= */

async function endpointTest(): Promise<void> {
	const { db, resolveData, DATA_DIR } = await import('../src/lib/server/db');
	const { meshToStlBinary, parseStl } = await import('../src/lib/server/stl');
	const { POST } = await import('../src/routes/api/cases/[id]/guide/+server');

	// temp patient / case / plan / models / implants
	const patient = db
		.query(`INSERT INTO patients (first_name, last_name) VALUES ('Guide3', 'Test') RETURNING id`)
		.get() as { id: number };
	const kase = db
		.query(`INSERT INTO cases (patient_id, title) VALUES (?1, 'guide3 temp case') RETURNING id`)
		.get(patient.id) as { id: number };
	const plan = db
		.query(`INSERT INTO plans (case_id, name) VALUES (?1, 'guide3 plan') RETURNING id`)
		.get(kase.id) as { id: number };

	const { caseRel } = await import('../src/lib/server/db');
	const rel = caseRel(kase.id);
	const writeModel = async (name: string, kind: string, soup: Float32Array): Promise<number> => {
		const path = join(rel, `${name}.stl`);
		await Bun.write(resolveData(path), meshToStlBinary(soup, name));
		const row = db
			.query(
				`INSERT INTO models (case_id, name, kind, file_path) VALUES (?1, ?2, ?3, ?4) RETURNING id`
			)
			.get(kase.id, name, kind, path) as { id: number };
		return row.id;
	};
	// base anatomy scan, dual-scan denture bottom (plateau above the dome
	// between the implants), and a wide plate to merge ("Add object")
	const scanId = await writeModel('guide3_scan', 'scan', scan);
	const denture = gridSoup((x, y) => (x >= 26 && x <= 34 && y >= 14 && y <= 18 ? 36 : 0), 26, 34, 14, 18);
	const dentureId = await writeModel('guide3_denture', 'other', denture);
	const plateId = await writeModel('guide3_plate', 'other', plate);

	for (const im of implants) {
		db.query(
			`INSERT INTO implants (plan_id, x, y, z, ax, ay, az, sleeve)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
		).run(plan.id, im.head.x, im.head.y, im.head.z, im.axis.x, im.axis.y, im.axis.z,
			JSON.stringify(im.sleeve));
	}

	const callPost = async (body: Record<string, unknown>): Promise<{
		status: number;
		json: { model?: { id: number; file_path: string }; triangles?: number; warnings?: string[]; message?: string };
	}> => {
		const event = {
			params: { id: String(kase.id) },
			request: new Request('http://test.local/api/guide', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			locals: { user: { email: 'guide3@test' } }
		};
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const res = await POST(event as any);
			return { status: res.status, json: await res.json() };
		} catch (e) {
			const he = e as { status?: number; body?: { message?: string } };
			return { status: he.status ?? 500, json: { message: he.body?.message ?? String(e) } };
		}
	};
	const loadGuideStl = async (filePath: string): Promise<Float32Array> => {
		const bytes = new Uint8Array(await Bun.file(resolveData(filePath)).arrayBuffer());
		return parseStl(bytes)?.positions ?? new Float32Array(0);
	};

	try {
		/* ---- run 1: plain guide (no intaglio, no merge) ---- */
		const run1 = await callPost({
			modelId: scanId,
			planId: plan.id,
			insertion: 'auto',
			windows: [{ x: 30, y: 25, z: 0, diameter: 6 }],
			params: {}
		});
		check('endpoint run 1 (plain) responds 200', run1.status === 200, run1.json.message ?? '');
		const pos1 = run1.json.model ? await loadGuideStl(run1.json.model.file_path) : new Float32Array(0);
		check('run 1 has no shell above the guide (nothing merged)', vertsWhere(pos1, (_x, _y, z) => z > 45) === 0);
		// guide top under the future denture plateau (merged shells excluded by z<45)
		const topUnderPlateau = (pos: Float32Array): number => {
			let top = -Infinity;
			for (let i = 0; i + 2 < pos.length; i += 3) {
				if (pos[i + 2] > 45 || Math.hypot(pos[i] - 30, pos[i + 1] - 16) > 1.5) continue;
				if (pos[i + 2] > top) top = pos[i + 2];
			}
			return top;
		};
		const top1 = topUnderPlateau(pos1);

		/* ---- run 2: intaglio + Add object, both passed INSIDE params (the
		        exact shape GuideOptionsPanel emits through the page) ---- */
		const run2 = await callPost({
			modelId: scanId,
			planId: plan.id,
			insertion: 'auto',
			windows: [{ x: 30, y: 25, z: 0, diameter: 6 }],
			params: { intaglioModelId: dentureId, mergeModelIds: [plateId] }
		});
		check('endpoint run 2 (intaglio + merge) responds 200', run2.status === 200, run2.json.message ?? '');
		const pos2 = run2.json.model ? await loadGuideStl(run2.json.model.file_path) : new Float32Array(0);
		check(
			'response triangle count matches the written STL',
			run2.json.triangles === pos2.length / 9,
			`${run2.json.triangles} vs ${pos2.length / 9}`
		);

		// intaglio passthrough: seating surface raised under the denture plateau
		const top2 = topUnderPlateau(pos2);
		check(
			'params.intaglioModelId raises the seating surface (dual-scan)',
			top2 > top1 + 0.8,
			`top ${top1.toFixed(2)} → ${top2.toFixed(2)}`
		);

		// merged shell present (the plate lives at z=50, far above the guide)
		const shellVerts = vertsWhere(pos2, (_x, _y, z) => z > 45);
		check('mergeModelIds shell present in the output STL', shellVerts > 0, `${shellVerts} verts`);
		// …with the window and a drill corridor cut through it
		const shellWin = vertsWhere(pos2, (x, y, z) => z > 45 && Math.hypot(x - 30, y - 25) < 2.0);
		const shellCorr = vertsWhere(pos2, (x, y, z) => z > 45 && Math.hypot(x - 22, y - 20) < 1.4);
		check('window cylinder cleared through the merged shell', shellWin === 0, `${shellWin} verts`);
		check('drill corridor cleared through the merged shell', shellCorr === 0, `${shellCorr} verts`);

		// persisted generation parameters record both ids
		const saved = db
			.query(`SELECT value FROM settings WHERE key = ?1`)
			.get(`guide_params_${plan.id}`) as { value: string } | null;
		const savedJson = saved ? JSON.parse(saved.value) : {};
		check(
			'persisted guide params record intaglioModelId + mergeModelIds',
			savedJson.intaglioModelId === dentureId &&
				Array.isArray(savedJson.mergeModelIds) &&
				savedJson.mergeModelIds.includes(plateId),
			saved?.value?.slice(0, 120) ?? 'missing'
		);
	} finally {
		/* ---- cleanup: rows, files, settings, audit ---- */
		db.query('DELETE FROM settings WHERE key = ?1').run(`guide_params_${plan.id}`);
		db.query('DELETE FROM audit WHERE target = ?1').run(`plan:${plan.id}`);
		db.query('DELETE FROM models WHERE case_id = ?1').run(kase.id);
		db.query('DELETE FROM plans WHERE id = ?1').run(plan.id); // implants cascade
		db.query('DELETE FROM cases WHERE id = ?1').run(kase.id);
		db.query('DELETE FROM patients WHERE id = ?1').run(patient.id);
		await rm(join(DATA_DIR, rel), { recursive: true, force: true }).catch(() => {});
	}
}

await endpointTest();

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks passed');
