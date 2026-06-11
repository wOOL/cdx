/**
 * Guide generator rotation-marker test ("Engrave rotation markers", the
 * Labels-step checkbox of the original's drill-guide wizard):
 *  - generateGuide params.rotationMarkers engraves a narrow radial slot into
 *    each sleeve mount's TOP face (55%→95% of the mount radius, ~0.8mm wide,
 *    ~0.6mm deep) along the implant's marker azimuth
 *  - azimuth convention: GuideImplant.markerDir when supplied, else
 *    axisFrame(axis).u (azimuth 0)
 *  - live guide endpoint invoked DIRECTLY (no dev server / browser): an
 *    implant whose stored abutment carries rotation=90° moves the slot to
 *    the 90° azimuth; the flag round-trips into the persisted guide params.
 * Creates its own temporary patient/case/plan/models in the database and
 * cleans everything up. Run from the repo root:
 *   bun run scripts/test-guide4.ts
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { generateGuide, type GuideImplant } from '../src/lib/server/guideGen';

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

// Sleeves span z 36..41 → mount top face at z = 41 + MOUNT_TOP_MARGIN = 41.5.
// Mount radius = 5/2 + mountWall 1.6 = 4.1; slot mid-radius 0.75·4.1 = 3.075.
const implants: GuideImplant[] = [
	{
		head: { x: 22, y: 20, z: 32 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 }
	},
	{
		head: { x: 38, y: 20, z: 32 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 }
	}
];
const MOUNT_TOP = 41.5;
const SLOT_MID_R = 3.075;
// Azimuth convention for axis (0,0,-1): axisFrame n=(0,0,-1), u=(1,0,0),
// v = n×u = (0,-1,0) — azimuth 0 points +x, azimuth 90° points −y.
// Sample points sit at the slot mid-radius, jittered 0.07mm off the grid's
// 0.1mm marching-cubes vertex lattice so vertical parity rays never graze a
// vertex/edge exactly; z = 41.2 lies inside the 0.6mm slot (floor ≈ 40.9).
const ZP = 41.2;

/** Even-odd parity of an upward vertical ray: is (x,y,z) inside the mesh? */
function insideMesh(pos: Float32Array, x: number, y: number, z: number): boolean {
	let crossings = 0;
	for (let t = 0; t + 8 < pos.length; t += 9) {
		const x0 = pos[t];
		const y0 = pos[t + 1];
		const x1 = pos[t + 3];
		const y1 = pos[t + 4];
		const x2 = pos[t + 6];
		const y2 = pos[t + 7];
		const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
		if (Math.abs(denom) < 1e-12) continue;
		const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / denom;
		const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / denom;
		const c = 1 - a - b;
		if (a < 0 || b < 0 || c < 0) continue;
		const zi = a * pos[t + 2] + b * pos[t + 5] + c * pos[t + 8];
		if (zi > z) crossings++;
	}
	return crossings % 2 === 1;
}

const maxZNear = (pos: Float32Array, px: number, py: number, r: number): number => {
	let top = -Infinity;
	for (let i = 0; i + 2 < pos.length; i += 3) {
		if (Math.hypot(pos[i] - px, pos[i + 1] - py) > r) continue;
		if (pos[i + 2] > top) top = pos[i + 2];
	}
	return top;
};

const arraysDiffer = (a: Float32Array, b: Float32Array): boolean => {
	if (a.length !== b.length) return true;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
	return false;
};

/* ================= 1. generator: marker slot on / off ================= */

const common = { largeConnectors: true, voxel: 0.2 };
const meshOff = generateGuide(scan, null, implants, common);
const meshOn = generateGuide(scan, null, implants, { ...common, rotationMarkers: true });

// (a) flag off: the mount-top column at the marker location is solid
const mk1x = 22 + SLOT_MID_R; // implant 1 marker centre (azimuth 0 → +x)
check(
	'rotationMarkers off: mount-top column at the marker location is intact',
	insideMesh(meshOff.positions, mk1x, 20.07, ZP)
);

// (b) flag on: output differs; slot volume cleared, opposite azimuth intact
check('rotationMarkers on: output mesh differs', arraysDiffer(meshOff.positions, meshOn.positions));
check(
	'slot volume cleared at the marker azimuth',
	!insideMesh(meshOn.positions, mk1x, 20.07, ZP)
);
check(
	'opposite azimuth (180°) side of the mount stays intact',
	insideMesh(meshOn.positions, 22 - SLOT_MID_R, 20.07, ZP)
);
check(
	'second sleeve mount gets its own marker',
	!insideMesh(meshOn.positions, 38 + SLOT_MID_R, 20.07, ZP)
);
// depth: below the slot floor (~0.6mm under the top) material remains
check(
	'≥0.4mm of mount material remains under the slot',
	insideMesh(meshOn.positions, mk1x, 20.07, MOUNT_TOP - 0.95)
);
const zOff = maxZNear(meshOff.positions, mk1x, 20.07, 0.25);
const zOn = maxZNear(meshOn.positions, mk1x, 20.07, 0.25);
check(
	'engraved slot depth ≈ 0.6mm',
	Math.abs(zOff - zOn - 0.6) < 0.3,
	`top ${zOff.toFixed(2)} → ${zOn.toFixed(2)} (depth ${(zOff - zOn).toFixed(2)} mm)`
);

// explicit markerDir (azimuth 90° for a −z axis points −y) moves the slot
const implantsMD: GuideImplant[] = [
	{ ...implants[0], markerDir: { x: 0, y: -1, z: 0 } },
	implants[1]
];
const meshMD = generateGuide(scan, null, implantsMD, { ...common, rotationMarkers: true });
check(
	'explicit markerDir moves the slot to the 90° azimuth',
	!insideMesh(meshMD.positions, 22.07, 20 - SLOT_MID_R, ZP) &&
		insideMesh(meshMD.positions, mk1x, 20.07, ZP)
);

/* ================= 2. guide endpoint: abutment rotation + persistence ================= */

async function endpointTest(): Promise<void> {
	const { db, resolveData, caseRel, DATA_DIR } = await import('../src/lib/server/db');
	const { meshToStlBinary, parseStl } = await import('../src/lib/server/stl');
	const { POST } = await import('../src/routes/api/cases/[id]/guide/+server');

	// temp patient / case / plan / model / implants
	const patient = db
		.query(`INSERT INTO patients (first_name, last_name) VALUES ('Guide4', 'Test') RETURNING id`)
		.get() as { id: number };
	const kase = db
		.query(`INSERT INTO cases (patient_id, title) VALUES (?1, 'guide4 temp case') RETURNING id`)
		.get(patient.id) as { id: number };
	const plan = db
		.query(`INSERT INTO plans (case_id, name) VALUES (?1, 'guide4 plan') RETURNING id`)
		.get(kase.id) as { id: number };

	const rel = caseRel(kase.id);
	const scanPath = join(rel, 'guide4_scan.stl');
	await Bun.write(resolveData(scanPath), meshToStlBinary(scan, 'guide4_scan'));
	const scanRow = db
		.query(
			`INSERT INTO models (case_id, name, kind, file_path) VALUES (?1, 'guide4_scan', 'scan', ?2) RETURNING id`
		)
		.get(kase.id, scanPath) as { id: number };

	// implant 1: no abutment → marker azimuth 0 (+x); implant 2: stored
	// abutment with rotation 90° → marker azimuth 90° (−y for a −z axis)
	const abutments = ['', JSON.stringify({ type: 'straight', angle: 0, height: 4, diameter: 4, rotation: 90 })];
	implants.forEach((im, i) => {
		db.query(
			`INSERT INTO implants (plan_id, x, y, z, ax, ay, az, sleeve, abutment)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
		).run(plan.id, im.head.x, im.head.y, im.head.z, im.axis.x, im.axis.y, im.axis.z,
			JSON.stringify(im.sleeve), abutments[i]);
	});

	const callPost = async (params: Record<string, unknown>): Promise<{
		status: number;
		json: { model?: { id: number; file_path: string }; message?: string };
	}> => {
		const event = {
			params: { id: String(kase.id) },
			request: new Request('http://test.local/api/guide', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ modelId: scanRow.id, planId: plan.id, insertion: 'auto', params })
			}),
			locals: { user: { email: 'guide4@test' } }
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
		/* ---- run 1: flag off ---- */
		const runOff = await callPost({ voxel: 0.2 });
		check('endpoint run (flag off) responds 200', runOff.status === 200, runOff.json.message ?? '');
		const posOff = runOff.json.model
			? await loadGuideStl(runOff.json.model.file_path)
			: new Float32Array(0);
		check(
			'flag off: both marker columns intact',
			insideMesh(posOff, 22 + SLOT_MID_R, 20.07, ZP) &&
				insideMesh(posOff, 38.07, 20 - SLOT_MID_R, ZP)
		);

		/* ---- run 2: flag on ---- */
		const runOn = await callPost({ voxel: 0.2, rotationMarkers: true });
		check('endpoint run (flag on) responds 200', runOn.status === 200, runOn.json.message ?? '');
		const posOn = runOn.json.model
			? await loadGuideStl(runOn.json.model.file_path)
			: new Float32Array(0);
		check('flag on: output STL differs', arraysDiffer(posOff, posOn));
		// implant 1 (no abutment): slot at azimuth 0 (+x)
		check(
			'no abutment → slot at azimuth 0 (+x)',
			!insideMesh(posOn, 22 + SLOT_MID_R, 20.07, ZP) &&
				insideMesh(posOn, 22 - SLOT_MID_R, 20.07, ZP)
		);
		// (c) implant 2 (abutment rotation 90°): slot moved to azimuth 90° (−y)
		check(
			'abutment rotation 90° moves the slot to the 90° azimuth (−y)',
			!insideMesh(posOn, 38.07, 20 - SLOT_MID_R, ZP) &&
				insideMesh(posOn, 38 + SLOT_MID_R, 20.07, ZP)
		);

		// (d) flag round-trips into the persisted per-plan guide params
		const saved = db
			.query(`SELECT value FROM settings WHERE key = ?1`)
			.get(`guide_params_${plan.id}`) as { value: string } | null;
		const savedJson = saved ? JSON.parse(saved.value) : {};
		check(
			'rotationMarkers persisted with the guide params',
			savedJson.params?.rotationMarkers === true,
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
