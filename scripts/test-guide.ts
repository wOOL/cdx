/**
 * Drill guide generation smoke test: synthetic wavy surface scan, two
 * planned implants with sleeves, default generation parameters.
 *   bun run scripts/test-guide.ts
 */
import { writeFileSync } from 'node:fs';
import { generateGuide, type GuideImplant } from '../src/lib/server/guideGen';
import { meshToStlBinary } from '../src/lib/server/stl';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
	const status = ok ? 'PASS' : 'FAIL';
	console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

/* ---- synthetic scan: wavy top surface over [0,60]x[0,40] at 1mm ---- */
const surfZ = (x: number, y: number): number => 20 + 2 * Math.sin(x / 4) * Math.cos(y / 5);

const XMAX = 60;
const YMAX = 40;
const scan = new Float32Array(XMAX * YMAX * 2 * 9);
let o = 0;
for (let y = 0; y < YMAX; y++) {
	for (let x = 0; x < XMAX; x++) {
		const z00 = surfZ(x, y);
		const z10 = surfZ(x + 1, y);
		const z11 = surfZ(x + 1, y + 1);
		const z01 = surfZ(x, y + 1);
		// (x,y) (x+1,y) (x+1,y+1)
		scan.set([x, y, z00, x + 1, y, z10, x + 1, y + 1, z11], o);
		o += 9;
		// (x,y) (x+1,y+1) (x,y+1)
		scan.set([x, y, z00, x + 1, y + 1, z11, x, y + 1, z01], o);
		o += 9;
	}
}

/* ---- two implants: heads at (20,20,18) and (40,20,18), axes straight down ---- */
const implants: GuideImplant[] = [
	{
		head: { x: 20, y: 20, z: 18 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 } // sleeve spans z 22..27
	},
	{
		head: { x: 40, y: 20, z: 18 },
		axis: { x: 0, y: 0, z: -1 },
		sleeve: { diameter: 5, height: 5, offset: 4 }
	}
];

const OFFSET = 0.15;
const THICKNESS = 2.5;
const REGION_R = 9;
const SLEEVE_R = 2.5;
const MOUNT_WALL = 1.6;
const SLEEVE_TOP_Z = 27;

const t0 = performance.now();
const guide = generateGuide(scan, null, implants);
const dt = (performance.now() - t0).toFixed(0);
const { positions, normals, triangles } = guide;
console.log(`generated ${triangles} triangles in ${dt}ms`);

/* ---- 1. triangle count ---- */
check('triangles > 5000', triangles > 5000, `${triangles} triangles`);

/* ---- 2. all vertices within region bbox + 1mm margin ---- */
// Region bbox: implant heads +/- regionRadius in xy; z from the lowest
// possible intaglio (min scan z + offset) up to sleeve top + mount margin.
const bbMinX = 20 - REGION_R - 1;
const bbMaxX = 40 + REGION_R + 1;
const bbMinY = 20 - REGION_R - 1;
const bbMaxY = 20 + REGION_R + 1;
const bbMinZ = 18 + OFFSET - 1; // global surface minimum is z = 18
const bbMaxZ = SLEEVE_TOP_Z + 0.5 + 1;
let outOfBox = 0;
for (let i = 0; i + 2 < positions.length; i += 3) {
	const x = positions[i];
	const y = positions[i + 1];
	const z = positions[i + 2];
	if (x < bbMinX || x > bbMaxX || y < bbMinY || y > bbMaxY || z < bbMinZ || z > bbMaxZ) {
		outOfBox++;
	}
}
check(
	'all vertices within region bbox + 1mm',
	positions.length > 0 && outOfBox === 0,
	`${outOfBox} outside [${bbMinX},${bbMaxX}]x[${bbMinY},${bbMaxY}]x[${bbMinZ.toFixed(2)},${bbMaxZ}]`
);

/* ---- 3. guide cap exists between the implants ---- */
let capFound = false;
for (let i = 0; i + 2 < positions.length; i += 3) {
	if (
		Math.abs(positions[i] - 30) <= 1.5 &&
		Math.abs(positions[i + 1] - 20) <= 1.5 &&
		Math.abs(positions[i + 2] - 22.7) <= 1.5
	) {
		capFound = true;
		break;
	}
}
check('guide cap exists near (30, 20, ~22.7)', capFound);

/* ---- 4. drill channels open with walls present ---- */
for (let m = 0; m < implants.length; m++) {
	const h = implants[m].head;
	const zs = surfZ(h.x, h.y);
	const zMin = zs + OFFSET + 0.3;
	const zMax = zs + OFFSET + THICKNESS - 0.3;
	let inChannel = 0;
	let minR = Infinity;
	let wallFound = false;
	for (let i = 0; i + 2 < positions.length; i += 3) {
		const z = positions[i + 2];
		if (z < zMin || z > zMax) continue;
		const r = Math.hypot(positions[i] - h.x, positions[i + 1] - h.y);
		if (r < minR) minR = r;
		if (r < 2.0) inChannel++;
		if (r >= 2.4 && r <= 2.8) wallFound = true;
	}
	check(
		`channel ${m + 1} open (no vertex < 2mm of axis, z in [${zMin.toFixed(2)},${zMax.toFixed(2)}])`,
		inChannel === 0,
		`${inChannel} inside, closest ${minR.toFixed(2)}mm`
	);
	check(`channel ${m + 1} wall present (vertex within 2.4-2.8mm of axis)`, wallFound);
}

/* ---- 5. sleeve mounts near sleeve top ---- */
const mountReach = SLEEVE_R + MOUNT_WALL + 0.4;
for (let m = 0; m < implants.length; m++) {
	const h = implants[m].head;
	let mountFound = false;
	for (let i = 0; i + 2 < positions.length; i += 3) {
		if (Math.abs(positions[i + 2] - 26) > 0.5) continue;
		const r = Math.hypot(positions[i] - h.x, positions[i + 1] - h.y);
		if (r <= mountReach) {
			mountFound = true;
			break;
		}
	}
	check(`mount ${m + 1} exists (vertex within ${mountReach}mm of axis at z~26)`, mountFound);
}

/* ---- 6. valid triangle soup ---- */
let nanCount = 0;
for (let i = 0; i < positions.length; i++) {
	if (Number.isNaN(positions[i]) || Number.isNaN(normals[i])) nanCount++;
}
check(
	'valid soup (length % 9 == 0, normals match, no NaN)',
	positions.length % 9 === 0 &&
		normals.length === positions.length &&
		nanCount === 0 &&
		triangles === positions.length / 9,
	`${positions.length} floats, ${nanCount} NaN`
);

/* ---- write STL ---- */
const stl = meshToStlBinary(positions, 'drill-guide');
writeFileSync('/tmp/test-guide.stl', stl);
console.log(`wrote /tmp/test-guide.stl (${stl.length} bytes)`);

if (failures > 0) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nAll checks passed');
