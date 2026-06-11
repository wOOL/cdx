import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { caseDir, db } from '$lib/server/db';
import { getDataset } from '$lib/server/db/repo';
import { evictVolume, loadVolume } from '$lib/server/volumeCache';
import { rotateVolume, rotationMatrix } from '$lib/server/resample';
import { buildPreview } from '$lib/server/dicom/import';
import { listPlans, logAudit } from '$lib/server/db/repo';
import type { Model, Plan } from '$lib/types';

function angle(v: unknown): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-45, Math.min(45, n));
}

/**
 * Body: { yaw?: number, pitch?: number, roll?: number } (degrees, each clamped
 * to [-45, 45]) → bakes the rotation into the volume (resample about the
 * center in mm space) and replaces the dataset's volume + preview files.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const ds = getDataset(Number(params.id));
	if (!ds) error(404, 'Dataset not found');

	const body = await request.json().catch(() => ({}));
	const yaw = angle(body.yaw);
	const pitch = angle(body.pitch);
	const roll = angle(body.roll);
	if (yaw === 0 && pitch === 0 && roll === 0) error(400, 'nothing to do');

	const vol = await loadVolume(ds);
	const rotated = rotateVolume(
		vol,
		[ds.cols, ds.rows, ds.slices],
		[ds.spacing_x, ds.spacing_y, ds.spacing_z],
		yaw,
		pitch,
		roll
	);

	const preview = buildPreview({
		volume: rotated,
		cols: ds.cols,
		rows: ds.rows,
		slices: ds.slices,
		spacing: [ds.spacing_x, ds.spacing_y, ds.spacing_z],
		windowCenter: ds.window_center,
		windowWidth: ds.window_width,
		patientName: ds.patient_name,
		patientBirthDate: '',
		patientSex: '',
		studyDate: ds.study_date,
		modality: ds.modality,
		seriesDescription: ds.series_description
	});

	const dir = caseDir(ds.case_id);
	const stamp = crypto.randomUUID().slice(0, 8);
	const volPath = join(dir, `vol_${stamp}.i16`);
	const prevPath = join(dir, `vol_${stamp}_preview.u8`);
	await Bun.write(volPath, new Uint8Array(rotated.buffer, 0, rotated.byteLength));
	await Bun.write(prevPath, preview.data);

	db.query(
		`UPDATE datasets SET
			volume_path = ?2, preview_path = ?3,
			preview_cols = ?4, preview_rows = ?5, preview_slices = ?6
		 WHERE id = ?1`
	).run(ds.id, volPath, prevPath, preview.cols, preview.rows, preview.slices);

	evictVolume(ds.id);
	await unlink(ds.volume_path).catch(() => {});
	await unlink(ds.preview_path).catch(() => {});

	// rotate every planned object of this case the same way the anatomy moved:
	// p' = c + R·(p − c), axes v' = R·v
	const R = rotationMatrix(yaw, pitch, roll);
	const c = {
		x: ((ds.cols - 1) / 2) * ds.spacing_x,
		y: ((ds.rows - 1) / 2) * ds.spacing_y,
		z: ((ds.slices - 1) / 2) * ds.spacing_z
	};
	const rotP = (p: { x: number; y: number; z: number }) => {
		const dx = p.x - c.x;
		const dy = p.y - c.y;
		const dz = p.z - c.z;
		return {
			x: c.x + R[0] * dx + R[1] * dy + R[2] * dz,
			y: c.y + R[3] * dx + R[4] * dy + R[5] * dz,
			z: c.z + R[6] * dx + R[7] * dy + R[8] * dz
		};
	};
	const rotV = (v: { x: number; y: number; z: number }) => ({
		x: R[0] * v.x + R[1] * v.y + R[2] * v.z,
		y: R[3] * v.x + R[4] * v.y + R[5] * v.z,
		z: R[6] * v.x + R[7] * v.y + R[8] * v.z
	});

	for (const plan of listPlans(ds.case_id) as Plan[]) {
		// panoramic curve (2D control points at curveZ → rotate in 3D, re-flatten)
		try {
			const saved = plan.pan_curve ? JSON.parse(plan.pan_curve) : null;
			if (saved?.control?.length) {
				const zmm = (saved.z ?? 0) * ds.spacing_z;
				const rotated2 = saved.control.map((p: { x: number; y: number }) =>
					rotP({ x: p.x, y: p.y, z: zmm })
				);
				const meanZ = rotated2.reduce((a: number, p: { z: number }) => a + p.z, 0) / rotated2.length;
				const next = {
					control: rotated2.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
					z: Math.max(0, Math.min(ds.slices - 1, Math.round(meanZ / ds.spacing_z)))
				};
				db.query(`UPDATE plans SET pan_curve = ?2 WHERE id = ?1`).run(plan.id, JSON.stringify(next));
			}
		} catch {
			// leave a corrupt curve untouched
		}

		const nerves = db.query('SELECT id, points FROM nerves WHERE plan_id = ?1').all(plan.id) as {
			id: number;
			points: string;
		}[];
		for (const n of nerves) {
			try {
				const pts = JSON.parse(n.points || '[]') as { x: number; y: number; z: number; d?: number }[];
				const next = pts.map((p) => ({ ...rotP(p), ...(p.d != null ? { d: p.d } : {}) }));
				db.query('UPDATE nerves SET points = ?2 WHERE id = ?1').run(n.id, JSON.stringify(next));
			} catch {
				// skip corrupt points
			}
		}

		const implants = db
			.query('SELECT id, x, y, z, ax, ay, az FROM implants WHERE plan_id = ?1')
			.all(plan.id) as { id: number; x: number; y: number; z: number; ax: number; ay: number; az: number }[];
		for (const im of implants) {
			const head = rotP(im);
			const axis = rotV({ x: im.ax, y: im.ay, z: im.az });
			db.query('UPDATE implants SET x=?2, y=?3, z=?4, ax=?5, ay=?6, az=?7 WHERE id=?1').run(
				im.id, head.x, head.y, head.z, axis.x, axis.y, axis.z
			);
		}

		const measurements = db
			.query('SELECT id, points FROM measurements WHERE plan_id = ?1')
			.all(plan.id) as { id: number; points: string }[];
		for (const m of measurements) {
			try {
				const pts = JSON.parse(m.points || '[]') as { x: number; y: number; z: number }[];
				db.query('UPDATE measurements SET points = ?2 WHERE id = ?1').run(
					m.id,
					JSON.stringify(pts.map(rotP))
				);
			} catch {
				// skip
			}
		}
	}

	// surface models: prepend the about-center rotation to their transform
	const Rc4 = [
		R[0], R[3], R[6], 0,
		R[1], R[4], R[7], 0,
		R[2], R[5], R[8], 0,
		c.x - (R[0] * c.x + R[1] * c.y + R[2] * c.z),
		c.y - (R[3] * c.x + R[4] * c.y + R[5] * c.z),
		c.z - (R[6] * c.x + R[7] * c.y + R[8] * c.z),
		1
	];
	const models = db.query('SELECT id, transform FROM models WHERE case_id = ?1').all(ds.case_id) as Model[];
	for (const m of models) {
		let t: number[] | null = null;
		try {
			const parsed = m.transform ? JSON.parse(m.transform) : null;
			if (Array.isArray(parsed) && parsed.length === 16) t = parsed;
		} catch {
			t = null;
		}
		const base = t ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		// column-major multiply: next = Rc4 · base
		const next = new Array(16).fill(0);
		for (let col = 0; col < 4; col++) {
			for (let row = 0; row < 4; row++) {
				let acc = 0;
				for (let k = 0; k < 4; k++) acc += Rc4[k * 4 + row] * base[col * 4 + k];
				next[col * 4 + row] = acc;
			}
		}
		db.query('UPDATE models SET transform = ?2 WHERE id = ?1').run(m.id, JSON.stringify(next));
	}

	logAudit(locals.user, 'dataset.align', `dataset:${ds.id}`, `yaw ${yaw}° pitch ${pitch}° roll ${roll}°`);
	return json({ dataset: getDataset(ds.id) });
};
