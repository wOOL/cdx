/**
 * Virtual tooth mesh generation test suite.
 *   bun scripts/test-virtualtooth.ts   (exit 0 = all pass)
 *
 * For all 32 FDI teeth:
 *   - watertight-ish: positive signed volume, every undirected edge shared by
 *     exactly 2 triangles, every directed half-edge used exactly once
 *     (consistent outward winding), no degenerate triangles
 *   - bbox height (z) matches template heightMM, width (x) matches widthMM
 *   - z-up convention: base at z=0, occlusal at z=heightMM
 *   - scale parameter scales all dimensions uniformly
 *   - triangle budget < 2000
 * Plus: unknown FDI numbers are rejected, and virtualToothTransform encodes
 * translation / 180°-X flip in the column-major mat4 convention.
 */
import { virtualToothTemplate } from '../src/lib/implantLibrary';
import { generateVirtualTooth, virtualToothTransform } from '../src/lib/server/virtualTooth';

let failures = 0;
function check(cond: boolean, label: string) {
	if (!cond) {
		failures++;
		console.error(`FAIL  ${label}`);
	}
}

function signedVolume(pos: Float32Array): number {
	let v = 0;
	for (let i = 0; i < pos.length; i += 9) {
		const ax = pos[i],
			ay = pos[i + 1],
			az = pos[i + 2];
		const bx = pos[i + 3],
			by = pos[i + 4],
			bz = pos[i + 5];
		const cx = pos[i + 6],
			cy = pos[i + 7],
			cz = pos[i + 8];
		// dot(a, cross(b, c)) / 6
		v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
	}
	return v;
}

/** undirected edge use counts + directed half-edge use counts + degenerates */
function edgeStats(pos: Float32Array): {
	badUndirected: number;
	badDirected: number;
	degenerate: number;
	edges: number;
} {
	const undirected = new Map<string, number>();
	const directed = new Map<string, number>();
	let degenerate = 0;
	for (let i = 0; i < pos.length; i += 9) {
		const v = [
			`${pos[i]},${pos[i + 1]},${pos[i + 2]}`,
			`${pos[i + 3]},${pos[i + 4]},${pos[i + 5]}`,
			`${pos[i + 6]},${pos[i + 7]},${pos[i + 8]}`
		];
		if (v[0] === v[1] || v[1] === v[2] || v[2] === v[0]) {
			degenerate++;
			continue;
		}
		for (let e = 0; e < 3; e++) {
			const a = v[e];
			const b = v[(e + 1) % 3];
			directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
			const u = a < b ? `${a}|${b}` : `${b}|${a}`;
			undirected.set(u, (undirected.get(u) ?? 0) + 1);
		}
	}
	let badUndirected = 0;
	for (const n of undirected.values()) if (n !== 2) badUndirected++;
	let badDirected = 0;
	for (const n of directed.values()) if (n !== 1) badDirected++;
	return { badUndirected, badDirected, degenerate, edges: undirected.size };
}

function bbox(pos: Float32Array) {
	const mn = [Infinity, Infinity, Infinity];
	const mx = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < pos.length; i += 3) {
		for (let a = 0; a < 3; a++) {
			mn[a] = Math.min(mn[a], pos[i + a]);
			mx[a] = Math.max(mx[a], pos[i + a]);
		}
	}
	return { mn, mx, dim: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

// ---------- Part 1: all 32 FDI teeth ----------
const ALL_FDI: number[] = [];
for (const q of [1, 2, 3, 4]) for (let p = 1; p <= 8; p++) ALL_FDI.push(q * 10 + p);

const TOL = 0.02; // mm (float32 rounding)
for (const tooth of ALL_FDI) {
	const tpl = virtualToothTemplate(tooth);
	check(!!tpl, `tooth ${tooth}: template exists`);
	if (!tpl) continue;

	const mesh = generateVirtualTooth(tooth);
	check(mesh.length % 9 === 0, `tooth ${tooth}: triangle soup (len % 9 == 0)`);
	const tris = mesh.length / 9;
	check(tris > 100 && tris < 2000, `tooth ${tooth}: triangle budget (${tris})`);

	const vol = signedVolume(mesh);
	check(vol > 0, `tooth ${tooth}: positive signed volume (${vol.toFixed(2)} mm³)`);

	const es = edgeStats(mesh);
	check(es.degenerate === 0, `tooth ${tooth}: no degenerate triangles (${es.degenerate})`);
	check(
		es.badUndirected === 0,
		`tooth ${tooth}: every edge shared by exactly 2 triangles (${es.badUndirected}/${es.edges} bad)`
	);
	check(es.badDirected === 0, `tooth ${tooth}: consistent winding (${es.badDirected} bad half-edges)`);

	const { mn, mx, dim } = bbox(mesh);
	check(Math.abs(dim[2] - tpl.heightMM) < TOL, `tooth ${tooth}: height ${dim[2].toFixed(3)} ≈ ${tpl.heightMM}`);
	check(Math.abs(dim[0] - tpl.widthMM) < TOL, `tooth ${tooth}: width ${dim[0].toFixed(3)} ≈ ${tpl.widthMM}`);
	check(Math.abs(mn[2]) < TOL, `tooth ${tooth}: base at z=0 (${mn[2].toFixed(4)})`);
	check(Math.abs(mx[2] - tpl.heightMM) < TOL, `tooth ${tooth}: occlusal at z=heightMM`);
	check(dim[1] > 0.5 * tpl.widthMM && dim[1] < 1.3 * tpl.widthMM, `tooth ${tooth}: plausible BL width (${dim[1].toFixed(2)})`);
}
console.log(`Part 1: all ${ALL_FDI.length} FDI teeth generated, watertight, dimensions match`);

// ---------- Part 2: scale ----------
for (const tooth of [11, 23, 36, 44]) {
	const tpl = virtualToothTemplate(tooth)!;
	for (const s of [0.5, 1.5]) {
		const mesh = generateVirtualTooth(tooth, { scale: s });
		const { dim } = bbox(mesh);
		check(Math.abs(dim[2] - tpl.heightMM * s) < TOL, `tooth ${tooth} scale ${s}: height`);
		check(Math.abs(dim[0] - tpl.widthMM * s) < TOL, `tooth ${tooth} scale ${s}: width`);
		check(signedVolume(mesh) > 0, `tooth ${tooth} scale ${s}: positive volume`);
		check(edgeStats(mesh).badUndirected === 0, `tooth ${tooth} scale ${s}: watertight`);
	}
}
console.log('Part 2: scale parameter scales height/width uniformly');

// ---------- Part 3: unknown teeth rejected ----------
for (const bad of [0, 9, 10, 19, 29, 40, 49, 55, 99, -11, 1.5, NaN]) {
	let threw = false;
	try {
		generateVirtualTooth(bad as number);
	} catch {
		threw = true;
	}
	check(threw, `unknown tooth ${bad}: generateVirtualTooth throws`);
}
console.log('Part 3: unknown FDI numbers rejected');

// ---------- Part 4: transform convention ----------
const t1 = virtualToothTransform({ x: 10, y: -5, z: 42.5 });
check(t1.length === 16, 'transform: 16 floats');
check(t1[12] === 10 && t1[13] === -5 && t1[14] === 42.5, 'transform: translation in elements 12–14');
check(t1[0] === 1 && t1[5] === 1 && t1[10] === 1 && t1[15] === 1, 'transform: identity rotation');
const t2 = virtualToothTransform({ x: 0, y: 0, z: 0 }, true);
check(t2[0] === 1 && t2[5] === -1 && t2[10] === -1 && t2[15] === 1, 'transform: flip = 180° about X');
console.log('Part 4: transform convention (column-major, translation @12–14, flip diag(1,−1,−1))');

if (failures > 0) {
	console.error(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll virtual-tooth checks passed.');
