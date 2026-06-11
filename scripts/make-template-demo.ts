/**
 * Create a persistent "Template demo (dual scan)" case under patient 1 with a
 * synthetic dual-scan phantom pair: dataset A = patient scan with the
 * radiographic template (acrylic shell + 5 fiducial spheres) in the mouth,
 * dataset B = the template scanned alone in a different pose (known rigid
 * transform). Used for demonstrating/manually testing Align → Match template…
 *
 * Re-running replaces the case. Layout mirrors scripts/test-template-match.ts.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { db, DATA_DIR } from '../src/lib/server/db';
import { createCase, createDataset, deleteCase } from '../src/lib/server/db/repo';
import { applyMat4, type Mat4, type Point3 } from '../src/lib/registration';
import { buildPreview } from '../src/lib/server/dicom/import';

const N = 160; // 160³ voxels
const SP = 0.4; // mm
const NN = N * N;
const SPHERE_R = 1.5; // mm

function rotTrans(axis: Point3, angleDeg: number, t: Point3): Mat4 {
	const a = (angleDeg * Math.PI) / 180;
	const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
	const u = { x: axis.x / len, y: axis.y / len, z: axis.z / len };
	const c = Math.cos(a);
	const s = Math.sin(a);
	const R = [
		[c + u.x * u.x * (1 - c), u.x * u.y * (1 - c) - u.z * s, u.x * u.z * (1 - c) + u.y * s],
		[u.y * u.x * (1 - c) + u.z * s, c + u.y * u.y * (1 - c), u.y * u.z * (1 - c) - u.x * s],
		[u.z * u.x * (1 - c) - u.y * s, u.z * u.y * (1 - c) + u.x * s, c + u.z * u.z * (1 - c)]
	];
	// column-major
	return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t.x, t.y, t.z, 1];
}

function invertRigid(m: Mat4): Mat4 {
	const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
	const t = { x: m[12], y: m[13], z: m[14] };
	return [
		r[0], r[3], r[6], 0,
		r[1], r[4], r[7], 0,
		r[2], r[5], r[8], 0,
		-(r[0] * t.x + r[1] * t.y + r[2] * t.z),
		-(r[3] * t.x + r[4] * t.y + r[5] * t.z),
		-(r[6] * t.x + r[7] * t.y + r[8] * t.z),
		1
	];
}

function boxFill(v: Int16Array, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hu: number) {
	for (let k = Math.max(0, Math.ceil(z0 / SP)); k <= Math.min(N - 1, Math.floor(z1 / SP)); k++)
		for (let j = Math.max(0, Math.ceil(y0 / SP)); j <= Math.min(N - 1, Math.floor(y1 / SP)); j++)
			for (let i = Math.max(0, Math.ceil(x0 / SP)); i <= Math.min(N - 1, Math.floor(x1 / SP)); i++)
				v[k * NN + j * N + i] = hu;
}

function stampSphere(v: Int16Array, c: Point3, r: number, hu = 3000) {
	const i0 = Math.max(0, Math.floor((c.x - r) / SP));
	const i1 = Math.min(N - 1, Math.ceil((c.x + r) / SP));
	const j0 = Math.max(0, Math.floor((c.y - r) / SP));
	const j1 = Math.min(N - 1, Math.ceil((c.y + r) / SP));
	const k0 = Math.max(0, Math.floor((c.z - r) / SP));
	const k1 = Math.min(N - 1, Math.ceil((c.z + r) / SP));
	for (let k = k0; k <= k1; k++)
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const dx = i * SP - c.x;
				const dy = j * SP - c.y;
				const dz = k * SP - c.z;
				if (dx * dx + dy * dy + dz * dz <= r * r) v[k * NN + j * N + i] = hu;
			}
}

// asymmetric marker constellation (mm, A-space) inside the shell slab
const P: Point3[] = [
	{ x: 18, y: 16, z: 43 },
	{ x: 46, y: 15, z: 42.5 },
	{ x: 32, y: 36, z: 44 },
	{ x: 22, y: 30, z: 41.5 },
	{ x: 42, y: 33, z: 45 }
];
const M = rotTrans({ x: 0.3, y: 0.5, z: 1 }, 8, { x: 5.5, y: -3.5, z: 2.5 });
const Minv = invertRigid(M);
const SHELL = { x0: 14, x1: 50, y0: 12, y1: 40, z0: 40, z1: 46 };

// volume A — patient with template
const A = new Int16Array(N * N * N).fill(-1000);
boxFill(A, 8, 56, 8, 56, 6, 30, 50); // soft tissue
for (let k = Math.ceil(10 / SP); k <= Math.floor(28 / SP); k++)
	for (let j = 0; j < N; j++) {
		const y = j * SP;
		if (y > 34) continue;
		for (let i = 0; i < N; i++) {
			const r = Math.hypot(i * SP - 32, y - 32);
			if (r >= 14 && r <= 20) A[k * NN + j * N + i] = 1200; // jaw arch
		}
	}
boxFill(A, SHELL.x0, SHELL.x1, SHELL.y0, SHELL.y1, SHELL.z0, SHELL.z1, -100); // acrylic shell
for (const p of P) stampSphere(A, p, SPHERE_R);

// volume B — template alone, posed by M
const B = new Int16Array(N * N * N).fill(-1000);
for (let k = 0; k < N; k++) {
	const z = k * SP;
	for (let j = 0; j < N; j++) {
		const y = j * SP;
		for (let i = 0; i < N; i++) {
			const x = i * SP;
			const ux = Minv[0] * x + Minv[4] * y + Minv[8] * z + Minv[12];
			if (ux < SHELL.x0 || ux > SHELL.x1) continue;
			const uy = Minv[1] * x + Minv[5] * y + Minv[9] * z + Minv[13];
			if (uy < SHELL.y0 || uy > SHELL.y1) continue;
			const uz = Minv[2] * x + Minv[6] * y + Minv[10] * z + Minv[14];
			if (uz < SHELL.z0 || uz > SHELL.z1) continue;
			B[k * NN + j * N + i] = -100;
		}
	}
}
for (const q of P.map((p) => applyMat4(M, p))) stampSphere(B, q, SPHERE_R);

// replace any previous demo case
const prev = db
	.query(`SELECT id FROM cases WHERE patient_id = 1 AND title = 'Template demo (dual scan)'`)
	.get() as { id: number } | null;
if (prev) deleteCase(prev.id);

const c = createCase(1, 'Template demo (dual scan)');
const rel = join('cases', String(c.id));
mkdirSync(join(DATA_DIR, rel), { recursive: true });
await Bun.write(join(DATA_DIR, rel, 'template_a.i16'), new Uint8Array(A.buffer));
await Bun.write(join(DATA_DIR, rel, 'template_b.i16'), new Uint8Array(B.buffer));

// 3D-view previews (the planner's volume view 404s without them)
const previewOf = (vol: Int16Array) =>
	buildPreview(
		{ volume: vol, cols: N, rows: N, slices: N, spacing: [SP, SP, SP] } as Parameters<
			typeof buildPreview
		>[0],
		256
	);
const prevA = previewOf(A);
const prevB = previewOf(B);
await Bun.write(join(DATA_DIR, rel, 'template_a_preview.u8'), prevA.data);
await Bun.write(join(DATA_DIR, rel, 'template_b_preview.u8'), prevB.data);

const common = { kind: 'ct' as const, spacing_x: SP, spacing_y: SP, spacing_z: SP, modality: 'CT' };
const dsA = createDataset({
	...common,
	case_id: c.id,
	description: 'Patient scan with template',
	cols: N,
	rows: N,
	slices: N,
	volume_path: join(rel, 'template_a.i16'),
	preview_path: join(rel, 'template_a_preview.u8'),
	preview_cols: prevA.cols,
	preview_rows: prevA.rows,
	preview_slices: prevA.slices
});
const dsB = createDataset({
	...common,
	case_id: c.id,
	description: 'Template scanned alone',
	cols: N,
	rows: N,
	slices: N,
	volume_path: join(rel, 'template_b.i16'),
	preview_path: join(rel, 'template_b_preview.u8'),
	preview_cols: prevB.cols,
	preview_rows: prevB.rows,
	preview_slices: prevB.slices
});
console.log(`Template demo case ${c.id} created (datasets ${dsA.id} patient / ${dsB.id} template)`);
