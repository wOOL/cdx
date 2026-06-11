/**
 * Virtual Planning Export test suite (pure functions, no server/browser).
 *   bun scripts/test-vpe.ts   (exit 0 = all pass)
 *
 * Part 1: scanbody catalog + platform filtering.
 * Part 2: parametric shells are watertight with the expected extents.
 * Part 3: placement — implant level on the platform, abutment level offset
 *         along the angulated prosthetic direction.
 * Part 4: part assembly (untouched vs analogs) + STL/zip output formats.
 */
import { unzipSync } from 'fflate';
import {
	ANALOG_LENGTH,
	analogMesh,
	buildVpeParts,
	closeBaseModel,
	placeMesh,
	scanbodyMesh,
	scanbodyPlacement,
	vpePreview,
	vpeSingleStl,
	vpeZip,
	type VpeImplant
} from '../src/lib/server/vpe';
import { detectMeshIssues } from '../src/lib/server/meshTools';
import { parseStl } from '../src/lib/server/stl';
import {
	SCANBODY_CATALOG,
	getScanbody,
	implantPlatform,
	scanbodiesForPlatform
} from '../src/lib/vpeCatalog';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-5) => Math.abs(a - b) <= eps;

function bbox(p: Float32Array): { min: number[]; max: number[] } {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < p.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			if (p[i + k] < min[k]) min[k] = p[i + k];
			if (p[i + k] > max[k]) max[k] = p[i + k];
		}
	}
	return { min, max };
}

// ---------------- Part 1: catalog ----------------

check('catalog has entries', SCANBODY_CATALOG.length >= 5);
check(
	'catalog ids unique',
	new Set(SCANBODY_CATALOG.map((s) => s.id)).size === SCANBODY_CATALOG.length
);
{
	const rc = implantPlatform({ manufacturer: 'Straumann', line: 'BLT (Bone Level Tapered)', diameter: 4.1 });
	check('Straumann BLT 4.1 → RC platform', rc === 'Straumann RC', `got ${rc}`);
	check('RC platform has scanbodies', scanbodiesForPlatform(rc).length > 0);
	const nc = implantPlatform({ manufacturer: 'Straumann', line: 'BLT (Bone Level Tapered)', diameter: 3.3 });
	check('Straumann BLT 3.3 → NC platform', nc === 'Straumann NC', `got ${nc}`);
	const pin = implantPlatform({ manufacturer: 'coDiagnostiX', line: 'Fixation Pin', diameter: 1.5 });
	check('fixation pin → no platform', pin === null);
	check('no platform → no scanbodies available', scanbodiesForPlatform(pin).length === 0);
	check('getScanbody unknown id → null', getScanbody('nope') === null);
}

// ---------------- Part 2: shells ----------------

const SB = SCANBODY_CATALOG[1]; // CARES Mono RC
{
	const mesh = scanbodyMesh(SB);
	const issues = detectMeshIssues(mesh);
	check('scanbody shell watertight', issues.openEdges === 0, `${issues.openEdges} open edges`);
	check('scanbody shell no degenerate triangles', issues.degenerate === 0);
	const { min, max } = bbox(mesh);
	const totalH = SB.collarHeight + SB.bodyHeight;
	check('scanbody spans z 0 → collar+body height', near(min[2], 0) && near(max[2], totalH));
	// the anti-rotation flat clamps +x of the body section to r − flatDepth
	let bodyMaxX = -Infinity;
	for (let i = 0; i < mesh.length; i += 3) {
		if (mesh[i + 2] > SB.collarHeight + 0.01 && mesh[i] > bodyMaxX) bodyMaxX = mesh[i];
	}
	check(
		'scanbody flat cut at bodyØ/2 − flatDepth',
		near(bodyMaxX, SB.bodyDiameter / 2 - SB.flatDepth),
		`maxX=${bodyMaxX}`
	);
}
{
	const mesh = analogMesh(4.1);
	const issues = detectMeshIssues(mesh);
	check('analog shell watertight', issues.openEdges === 0, `${issues.openEdges} open edges`);
	const { min, max } = bbox(mesh);
	check('analog spans z −length → 0', near(min[2], -ANALOG_LENGTH) && near(max[2], 0));
	check('analog seat Ø = platform Ø', near(max[0], 2.05) && near(max[1], 2.05));
}

// ---------------- Part 3: placement ----------------

const baseImplant: VpeImplant = {
	id: 1,
	tooth: '33',
	manufacturer: 'Straumann',
	line: 'BLT (Bone Level Tapered)',
	diameter: 4.1,
	x: 10,
	y: 20,
	z: 30,
	ax: 0,
	ay: 0,
	az: 1,
	abutment: null
};
{
	const p = scanbodyPlacement(baseImplant, 'implant');
	check(
		'implant level: seat on the platform',
		near(p.origin.x, 10) && near(p.origin.y, 20) && near(p.origin.z, 30)
	);
	check('implant level: direction = −axis', near(p.dir.x, 0) && near(p.dir.y, 0) && near(p.dir.z, -1));
	const placed = placeMesh(scanbodyMesh(SB), p.origin, p.dir);
	const { min, max } = bbox(placed);
	const totalH = SB.collarHeight + SB.bodyHeight;
	check(
		'implant level: scanbody extends against the axis from the platform',
		near(max[2], 30) && near(min[2], 30 - totalH),
		`z=[${min[2]}, ${max[2]}]`
	);
}
{
	// 17° angulated abutment, height 4 mm: axis +z ⇒ axisFrame u = +x;
	// rotation 0 ⇒ direction d = −(z·cos17 + x·sin17), top = head + d·4.
	const s = Math.sin((17 * Math.PI) / 180);
	const c = Math.cos((17 * Math.PI) / 180);
	const im: VpeImplant = {
		...baseImplant,
		abutment: { type: 'angled', angle: 17, height: 4, diameter: 4.5, rotation: 0 }
	};
	const p = scanbodyPlacement(im, 'abutment');
	check(
		'abutment level: direction tilted 17° toward −x',
		near(p.dir.x, -s) && near(p.dir.y, 0) && near(p.dir.z, -c),
		`dir=(${p.dir.x}, ${p.dir.y}, ${p.dir.z})`
	);
	check(
		'abutment level: seat at head + dir·height',
		near(p.origin.x, 10 - 4 * s) && near(p.origin.y, 20) && near(p.origin.z, 30 - 4 * c)
	);
	// rotation 90° tips toward −y instead (v = n × u = +y)
	const im90: VpeImplant = {
		...baseImplant,
		abutment: { type: 'angled', angle: 17, height: 4, diameter: 4.5, rotation: 90 }
	};
	const p90 = scanbodyPlacement(im90, 'abutment');
	check(
		'abutment level: rotation 90° tips toward −y',
		near(p90.dir.x, 0) && near(p90.dir.y, -s) && near(p90.dir.z, -c)
	);
	// straight 0° abutment: same direction as implant level, offset by height
	const im0: VpeImplant = {
		...baseImplant,
		abutment: { type: 'straight', angle: 0, height: 4, diameter: 4.5 }
	};
	const p0 = scanbodyPlacement(im0, 'abutment');
	check(
		'abutment level: straight abutment offsets along −axis',
		near(p0.origin.z, 26) && near(p0.dir.z, -1)
	);
	check(
		'abutment level without planned abutment degenerates to implant level',
		near(scanbodyPlacement(baseImplant, 'abutment').origin.z, 30)
	);
}

// ---------------- Part 4: assembly + output ----------------

/** open box: 10×10×10 mm cube missing its top face (2 triangles per side, 5 sides) */
function openBox(): Float32Array {
	const v = (x: number, y: number, z: number) => [x * 10, y * 10, z * 10];
	const quads = [
		[v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], // bottom
		[v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], // y=0
		[v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], // x=1
		[v(1, 1, 0), v(0, 1, 0), v(0, 1, 1), v(1, 1, 1)], // y=1
		[v(0, 1, 0), v(0, 0, 0), v(0, 0, 1), v(0, 1, 1)] // x=0
	];
	const out: number[] = [];
	for (const [a, b, c, d] of quads) out.push(...a, ...b, ...c, ...a, ...c, ...d);
	return Float32Array.from(out);
}

const pinImplant: VpeImplant = {
	id: 2,
	tooth: 'XX',
	manufacturer: 'coDiagnostiX',
	line: 'Fixation Pin',
	diameter: 1.5,
	x: 0,
	y: 0,
	z: 0,
	ax: 1,
	ay: 0,
	az: 0,
	abutment: null
};

{
	check('open box has open edges', detectMeshIssues(openBox()).openEdges > 0);
	const closed = closeBaseModel(openBox());
	check('closeBaseModel closes the box', detectMeshIssues(closed).openEdges === 0);
}
{
	const parts = buildVpeParts(
		{ name: 'Arch scan', positions: openBox() },
		'untouched',
		[baseImplant, pinImplant],
		[
			{ implantId: 1, level: 'implant', scanbodyId: SB.id, include: true },
			{ implantId: 2, level: 'implant', scanbodyId: null, include: true }
		]
	);
	check('untouched: base + 1 scanbody (pin adds nothing)', parts.length === 2, `${parts.length} parts`);
	check('untouched: base mesh passes through untouched', parts[0].positions.length === openBox().length);

	const excluded = buildVpeParts(
		{ name: 'Arch scan', positions: openBox() },
		'untouched',
		[baseImplant],
		[{ implantId: 1, level: 'implant', scanbodyId: SB.id, include: false }]
	);
	check('untouched: excluded item adds no shell', excluded.length === 1);
}
{
	const parts = buildVpeParts(
		{ name: 'Arch scan', positions: openBox() },
		'analogs',
		[baseImplant, pinImplant],
		[
			{ implantId: 1, level: 'implant', scanbodyId: null, include: true },
			{ implantId: 2, level: 'implant', scanbodyId: null, include: true }
		]
	);
	check('analogs: base + 1 analog (no analogs for pins)', parts.length === 2, `${parts.length} parts`);
	check('analogs: base mesh is closed', detectMeshIssues(parts[0].positions).openEdges === 0);
	const shells = parts.slice(1);
	check(
		'analogs: >0 closed shells emitted',
		shells.length > 0 && shells.every((s) => detectMeshIssues(s.positions).openEdges === 0)
	);

	// single-file STL: 80B header + 4B count + 50B per triangle, parses back
	const stl = vpeSingleStl(parts, 'test');
	const triCount = parts.reduce((n, p) => n + p.positions.length / 9, 0);
	check('single STL has 84 + 50·n bytes', stl.byteLength === 84 + 50 * triCount, `${stl.byteLength}`);
	const parsed = parseStl(stl);
	check('single STL parses back with all triangles', parsed?.positions.length === triCount * 9);

	// multi-file zip: one STL per part
	const zip = vpeZip(parts);
	const entries = unzipSync(zip);
	const names = Object.keys(entries);
	check('zip contains one STL per part', names.length === parts.length, names.join(', '));
	check('zip entries all parse as STL', names.every((n) => parseStl(entries[n]) !== null));
}
{
	// preview decimation: base strided under the budget, shells intact
	const big = new Float32Array(120_000 * 9); // 120k triangles ≈ 1.08M floats
	for (let i = 0; i < big.length; i++) big[i] = (i * 37) % 101;
	const sbMesh = scanbodyMesh(SB);
	const pv = vpePreview(
		[
			{ name: 'base', positions: big },
			{ name: 'shell', positions: sbMesh }
		],
		300_000
	);
	check('preview stays under 300k floats', pv.positions.length <= 300_000, `${pv.positions.length}`);
	check('preview keeps shells intact', pv.parts[1].count === sbMesh.length);
	check(
		'preview part offsets are consistent',
		pv.parts[0].offset === 0 && pv.parts[1].offset === pv.parts[0].count
	);
}

// ----------------

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
