/**
 * Vendor AI-segmentation unit tests (NO network):
 *   - mhaEncode header + dims round-trip
 *   - nearestClass: exact, within-tolerance, background, beyond-tolerance
 *   - toothFdi for all 32 teeth + non-tooth classes
 *   - labelmapToClassMasks on a hand-built [z][y][x][3] labelmap
 *   - maskToStl produces > 0 triangles
 *
 *   bun run scripts/test-aiseg-vendor-unit.ts
 */
import {
	mhaEncode,
	nearestClass,
	toothFdi,
	labelmapToClassMasks,
	maskToStl,
	CLASS_LEGEND,
	type VolumeData
} from '../src/lib/server/aiSegVendor';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failures++;
}

// ---- mhaEncode --------------------------------------------------------------

{
	const vol: VolumeData = {
		vol: Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
		dims: { x: 2, y: 2, z: 2 },
		spacing: { x: 0.3, y: 0.4, z: 0.5 }
	};
	const bytes = mhaEncode(vol);
	// header is ASCII up to "ElementDataFile = LOCAL\n"
	const text = new TextDecoder().decode(bytes.subarray(0, 400));
	const headerStr = text.slice(0, text.indexOf('LOCAL\n') + 'LOCAL\n'.length);
	check('mhaEncode: header has DimSize 2 2 2', headerStr.includes('DimSize = 2 2 2'));
	check('mhaEncode: header has spacing', headerStr.includes('ElementSpacing = 0.3 0.4 0.5'));
	check('mhaEncode: MET_SHORT + LOCAL', headerStr.includes('ElementType = MET_SHORT') && headerStr.includes('ElementDataFile = LOCAL'));
	check('mhaEncode: little-endian', headerStr.includes('BinaryDataByteOrderMSB = False'));

	// body = 8 int16 LE after the header
	const bodyOff = headerStr.length;
	const bodyBytes = bytes.subarray(bodyOff);
	check('mhaEncode: body byte length', bodyBytes.length === 16, `${bodyBytes.length}`);
	const body = new Int16Array(bodyBytes.buffer, bodyBytes.byteOffset, 8);
	let bodyOk = true;
	for (let i = 0; i < 8; i++) if (body[i] !== i + 1) bodyOk = false;
	check('mhaEncode: int16 body round-trips x-fastest', bodyOk, [...body].join(','));
}

// ---- nearestClass -----------------------------------------------------------

{
	const lower = CLASS_LEGEND['Lower Jawbone']; // [216,82,24]
	check('nearestClass: exact match', nearestClass(lower[0], lower[1], lower[2]) === 'Lower Jawbone');
	check(
		'nearestClass: within tolerance (+5 each)',
		nearestClass(lower[0] - 5, lower[1] + 5, lower[2] - 5) === 'Lower Jawbone'
	);
	check('nearestClass: background [0,0,0] → null', nearestClass(0, 0, 0) === null);
	check('nearestClass: far color → null', nearestClass(120, 120, 120) === null);
	const implant = CLASS_LEGEND['Implant']; // [255,127,0]
	check('nearestClass: Implant exact', nearestClass(implant[0], implant[1], implant[2]) === 'Implant');
}

// ---- toothFdi ---------------------------------------------------------------

{
	const cases: [string, number | null][] = [
		['Upper Right First Molar', 16],
		['Lower Left Canine', 33],
		['Lower Right Third Molar (Wisdom Tooth)', 48],
		['Upper Right Central Incisor', 11],
		['Upper Left Third Molar (Wisdom Tooth)', 28],
		['Upper Left Central Incisor', 21],
		['Lower Left Central Incisor', 31],
		['Lower Right Central Incisor', 41],
		['Lower Right Second Premolar', 45],
		['Upper Right Lateral Incisor', 12],
		['Lower Jawbone', null],
		['Implant', null],
		['Pharynx', null]
	];
	let fdiOk = true;
	let detail = '';
	for (const [name, want] of cases) {
		const got = toothFdi(name);
		if (got !== want) {
			fdiOk = false;
			detail += `${name}: got ${got} want ${want}; `;
		}
	}
	check('toothFdi: spot cases (16,33,48,11,28,...)', fdiOk, detail || 'all correct');

	// all 32 teeth resolve to a unique FDI
	const fdis = new Set<number>();
	let allTeeth = true;
	for (const name of Object.keys(CLASS_LEGEND)) {
		const fdi = toothFdi(name);
		if (fdi != null) {
			if (fdis.has(fdi)) allTeeth = false;
			fdis.add(fdi);
		}
	}
	check('toothFdi: 32 unique tooth FDIs', fdis.size === 32 && allTeeth, `${fdis.size} teeth`);
}

// ---- labelmapToClassMasks ---------------------------------------------------

{
	// tiny 4x4x8 [z][y][x][3] labelmap: plant two classes as z-slab blocks
	const nx = 4;
	const ny = 4;
	const nz = 8;
	const lower = CLASS_LEGEND['Lower Jawbone'];
	const implant = CLASS_LEGEND['Implant'];

	// flat x-fastest sRGB labelmap (what runVendorInference returns)
	const labelmap = new Uint8Array(nx * ny * nz * 3);
	const set = (x: number, y: number, z: number, c: [number, number, number]) => {
		const o = (x + y * nx + z * nx * ny) * 3;
		labelmap[o] = c[0];
		labelmap[o + 1] = c[1];
		labelmap[o + 2] = c[2];
	};
	// "Lower Jawbone": z planes 0..3 (4*16 = 64 voxels, exact color)
	let lowerCount = 0;
	for (let z = 0; z < 4; z++)
		for (let y = 0; y < ny; y++)
			for (let x = 0; x < nx; x++) {
				set(x, y, z, lower as [number, number, number]);
				lowerCount++;
			}
	// "Implant": z planes 4..6 (3*16 = 48 voxels) with an off-by-3 green
	// channel (within tolerance 12) to exercise the nearest-within-tolerance
	// path. z=7 left as background.
	let implantCount = 0;
	for (let z = 4; z < 7; z++)
		for (let y = 0; y < ny; y++)
			for (let x = 0; x < nx; x++) {
				set(x, y, z, [implant[0], implant[1] - 3, implant[2]] as [number, number, number]);
				implantCount++;
			}

	const masks = labelmapToClassMasks(labelmap, { x: nx, y: ny, z: nz });
	check('labelmapToClassMasks: 2 classes found', masks.size === 2, [...masks.keys()].join(', '));
	const lowerMask = masks.get('Lower Jawbone');
	const implantMask = masks.get('Implant');
	const sum = (m?: Uint8Array) => (m ? m.reduce((a, b) => a + b, 0) : -1);
	check(
		'labelmapToClassMasks: Lower Jawbone voxel count',
		sum(lowerMask) === lowerCount,
		`${sum(lowerMask)} vs ${lowerCount}`
	);
	check(
		'labelmapToClassMasks: Implant voxel count (tolerance path)',
		sum(implantMask) === implantCount,
		`${sum(implantMask)} vs ${implantCount}`
	);
	check(
		'labelmapToClassMasks: a planted lower voxel is set, an implant voxel is not lower',
		!!lowerMask && lowerMask[0 + 0 * nx + 0 * nx * ny] === 1 && !!implantMask && implantMask[0 + 0 * nx + 4 * nx * ny] === 1
	);
}

// ---- maskToStl --------------------------------------------------------------

{
	// solid 8x8x8 cube → marching cubes must yield triangles
	const n = 8;
	const mask = new Uint8Array(n * n * n);
	for (let z = 1; z < n - 1; z++)
		for (let y = 1; y < n - 1; y++)
			for (let x = 1; x < n - 1; x++) mask[x + y * n + z * n * n] = 1;
	const { stlBytes, triangles } = maskToStl(
		mask,
		{ x: n, y: n, z: n },
		{ x: 0.5, y: 0.5, z: 0.5 },
		'cube'
	);
	check('maskToStl: > 0 triangles', triangles > 0, `${triangles} triangles`);
	check('maskToStl: STL byte length matches tri count', stlBytes.length === 84 + triangles * 50);
}

if (failures > 0) {
	console.error(`${failures} check(s) failed`);
	process.exit(1);
}
console.log('All checks passed');
