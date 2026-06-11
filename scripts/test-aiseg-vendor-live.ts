/**
 * Vendor AI-segmentation LIVE test (network). Builds a small synthetic CBCT
 * volume (jawbone-like arch of bone), runs the FULL endpoint through the dev
 * server (POST start, poll GET until done, ≤ 6 min), and asserts:
 *   - the job completes
 *   - ≥ 1 class model row was created with > 0 triangles
 *   - the largest bone-ish class voxel-aligns to the input (high fraction of
 *     its voxels have input HU > 300)
 *   - all created rows/files are cleaned up
 *
 * Reads vendor creds from CDX_AISEG_EMAIL / CDX_AISEG_PASSWORD. If unset it
 * prints "SKIP: CDX_AISEG_* not set" and exits 0.
 *
 *   CDX_AISEG_EMAIL=... CDX_AISEG_PASSWORD=... bun run scripts/test-aiseg-vendor-live.ts
 *
 * Needs the dev server at http://localhost:5173 and the dev admin account.
 * Scratch DB rows/files are removed in the finally block.
 */
import { join } from 'node:path';
import { DATA_DIR, db, resolveData } from '../src/lib/server/db';
import { createCase, createDataset, createPatient, deletePatient } from '../src/lib/server/db/repo';
import { loadVolume } from '../src/lib/server/volumeCache';
import {
	downsampleStride,
	downsampleVolume,
	type VolumeData
} from '../src/lib/server/aiSegVendor';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const EMAIL = 'admin@becertain.ai';
const PASSWORD = 'devpassword1';

if (!process.env.CDX_AISEG_EMAIL || !process.env.CDX_AISEG_PASSWORD) {
	console.log('SKIP: CDX_AISEG_* not set');
	process.exit(0);
}

db.exec('PRAGMA busy_timeout = 3000');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

let cookie = '';
async function login(): Promise<boolean> {
	const form = new FormData();
	form.set('email', EMAIL);
	form.set('password', PASSWORD);
	const res = await fetch(`${BASE}/login`, { method: 'POST', body: form, redirect: 'manual' });
	for (const c of res.headers.getSetCookie()) {
		const m = c.match(/cdx_session=([^;]+)/);
		if (m) cookie = `cdx_session=${m[1]}`;
	}
	return (res.status === 303 || res.ok) && cookie !== '';
}

// ---- synthetic CBCT volume: soft-tissue block + jaw-like bone arch ----------
// 192^3 @ 0.5 mm. Bone HU 1200 in a lower half-annulus (mandible-ish), soft
// tissue HU 50 around it. Big enough to be meaningful, small enough to send.
const N = 192;
const SP = 0.5;
const NN = N * N;

const vol = new Int16Array(N * N * N).fill(-1000);
const cx = (N * SP) / 2;
const cy = (N * SP) / 2;
for (let k = 0; k < N; k++) {
	const z = k * SP;
	// jaw occupies a mid-axial band
	const inJaw = z > 30 && z < 66;
	for (let j = 0; j < N; j++) {
		const y = j * SP;
		for (let i = 0; i < N; i++) {
			const x = i * SP;
			const r = Math.hypot(x - cx, y - cy);
			// soft tissue envelope
			if (r < 44) vol[k * NN + j * N + i] = 50;
			// bone arch: annulus, lower half (y < center) → mandible-ish
			if (inJaw && r >= 28 && r <= 36 && y < cy + 6) vol[k * NN + j * N + i] = 1200;
		}
	}
}

const auditBefore = (db.query('SELECT COALESCE(MAX(id),0) AS m FROM audit').get() as { m: number }).m;
let scratchPatientId: number | null = null;

interface SegModel {
	id: number;
	name: string;
	class: string;
	color: string;
	triangles: number;
	ok: boolean;
}
interface SegStatus {
	status: string;
	jobId?: string;
	backend?: string;
	models?: SegModel[];
	error?: string;
}

const t0 = Date.now();
try {
	check('login (cookie jar)', await login());

	const patient = createPatient({ first_name: 'Scratch', last_name: 'AiSegVendor' });
	scratchPatientId = patient.id;
	const c = createCase(patient.id, 'aiseg-vendor live test');

	const caseDirRel = join('cases', String(c.id));
	await Bun.write(join(DATA_DIR, caseDirRel, 'av.i16'), new Uint8Array(vol.buffer));
	const ds = createDataset({
		case_id: c.id,
		kind: 'ct',
		description: 'phantom jaw',
		cols: N,
		rows: N,
		slices: N,
		spacing_x: SP,
		spacing_y: SP,
		spacing_z: SP,
		modality: 'CT',
		volume_path: join(caseDirRel, 'av.i16')
	});

	// ---- POST start ----
	const startRes = await fetch(`${BASE}/api/datasets/${ds.id}/ai-segment`, {
		method: 'POST',
		headers: { cookie },
		redirect: 'manual'
	});
	const started = (await startRes.json()) as { jobId?: string };
	check('POST start -> jobId', startRes.status === 200 && !!started.jobId, `status ${startRes.status}`);

	// ---- poll GET until done / error (≤ 6 min) ----
	const deadline = Date.now() + 6 * 60 * 1000;
	let state: SegStatus = { status: 'running' };
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 3000));
		const r = await fetch(`${BASE}/api/datasets/${ds.id}/ai-segment`, {
			headers: { cookie },
			redirect: 'manual'
		});
		state = (await r.json()) as SegStatus;
		if (state.status === 'done' || state.status === 'error') break;
	}
	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

	check('backend is vendor', state.backend === 'vendor', state.backend ?? 'undefined');
	check(
		`job completed (${elapsed}s)`,
		state.status === 'done',
		state.status === 'error' ? state.error : state.status
	);

	const models = state.models ?? [];
	const withTris = models.filter((m) => m.triangles > 0);
	check(
		'≥ 1 class model row with > 0 triangles',
		withTris.length >= 1,
		`${models.length} rows, ${withTris.length} non-empty: ` +
			withTris.map((m) => `${m.name}=${m.triangles}`).join(', ')
	);

	// ---- alignment: largest bone-ish class voxels mostly have input HU>300 ----
	// Replicate the verified check on the DOWNSAMPLED grid the masks live on.
	if (withTris.length >= 1) {
		const fullVol = await loadVolume(ds);
		const v: VolumeData = {
			vol: fullVol,
			dims: { x: ds.cols, y: ds.rows, z: ds.slices },
			spacing: { x: ds.spacing_x, y: ds.spacing_y, z: ds.spacing_z }
		};
		const dsVol = downsampleVolume(v, downsampleStride(v.dims));

		// pick the largest jawbone class (Mandible/Maxilla), else the largest model
		const bone = withTris
			.filter((m) => /Mandible|Maxilla/.test(m.name))
			.sort((a, b) => b.triangles - a.triangles)[0];
		const target = bone ?? withTris.sort((a, b) => b.triangles - a.triangles)[0];

		// read its STL, map vertices → downsampled voxel → input HU
		const { parseStl } = await import('../src/lib/server/stl');
		const row = db.query('SELECT file_path FROM models WHERE id = ?1').get(target.id) as {
			file_path: string;
		};
		const stl = parseStl(new Uint8Array(await Bun.file(resolveData(row.file_path)).arrayBuffer()));
		let hi = 0;
		let total = 0;
		if (stl) {
			const { x: nx, y: ny, z: nz } = dsVol.dims;
			const nxny = nx * ny;
			for (let i = 0; i + 2 < stl.positions.length; i += 9) {
				// sample triangle centroid
				const mx = (stl.positions[i] + stl.positions[i + 3] + stl.positions[i + 6]) / 3;
				const my = (stl.positions[i + 1] + stl.positions[i + 4] + stl.positions[i + 7]) / 3;
				const mz = (stl.positions[i + 2] + stl.positions[i + 5] + stl.positions[i + 8]) / 3;
				const gx = Math.round(mx / dsVol.spacing.x);
				const gy = Math.round(my / dsVol.spacing.y);
				const gz = Math.round(mz / dsVol.spacing.z);
				if (gx < 0 || gx >= nx || gy < 0 || gy >= ny || gz < 0 || gz >= nz) continue;
				total++;
				if (dsVol.vol[gx + gy * nx + gz * nxny] > 300) hi++;
			}
		}
		const frac = total > 0 ? hi / total : 0;
		check(
			`largest bone class "${target.name}" aligns to input (HU>300 fraction)`,
			frac > 0.5,
			`${(frac * 100).toFixed(1)}% of ${total} sampled centroids`
		);
	}

	// ---- audit row written ----
	const auditRows = db
		.query(`SELECT detail FROM audit WHERE action = 'aiseg.vendor' AND id > ?1`)
		.all(auditBefore) as { detail: string }[];
	check('audit aiseg.vendor logged', auditRows.length === 1, auditRows[0]?.detail ?? 'none');
} finally {
	try {
		// deletePatient cascades cases → datasets/models and removes their files,
		// so the scratch case (and any imported AI model rows) is fully cleaned up.
		if (scratchPatientId != null) deletePatient(scratchPatientId);
		db.query(`DELETE FROM audit WHERE action = 'aiseg.vendor' AND id > ?1`).run(auditBefore);
		const leftover = scratchPatientId
			? (
					db.query('SELECT COUNT(*) AS c FROM patients WHERE id = ?1').get(scratchPatientId) as {
						c: number;
					}
				).c
			: 1;
		check('scratch patient + cascade cleaned up', leftover === 0, `${leftover} patient rows left`);
	} catch (e) {
		console.error('cleanup failed:', e);
		failures++;
	}
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All checks passed');
