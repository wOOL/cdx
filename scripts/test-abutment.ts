/**
 * Abutment math + virtual tooth + user-abutment test suite.
 *   bun scripts/test-abutment.ts   (exit 0 = all pass)
 *
 * Part 1: computeAbutmentAlignment / chooseAngulation / residualDeviation.
 * Part 2: virtualToothOutline closed polygons for all 32 FDI teeth.
 * Part 3: userAbutmentToSpec shape compatibility with the stored abutment JSON.
 */
import {
	axisFrame,
	chooseAngulation,
	computeAbutmentAlignment,
	residualDeviation
} from '../src/lib/abutmentMath';
import {
	FDI_LOWER,
	FDI_UPPER,
	VIRTUAL_TEETH,
	userAbutmentToSpec,
	virtualToothOutline,
	virtualToothTemplate,
	type UserAbutment
} from '../src/lib/implantLibrary';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
	if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------- Part 1: alignment math ----------------

{
	// 1. axis = target → tilt 0
	const r = computeAbutmentAlignment({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -1 });
	check('axis = target → tilt 0°', near(r.tiltDeg, 0), `tilt=${r.tiltDeg}`);
	check('axis = target → azimuth 0 (no preferred direction)', near(r.azimuthDeg, 0));
}
{
	// 2. perpendicular → 90°
	const r = computeAbutmentAlignment({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
	check('perpendicular → tilt 90°', near(r.tiltDeg, 90), `tilt=${r.tiltDeg}`);
	// → null when the largest available angulation is 30
	check('chooseAngulation(90, [0,17,30]) → null', chooseAngulation(r.tiltDeg, [0, 17, 30]) === null);
}
{
	// 3. 45° tilt, un-normalized inputs
	const r = computeAbutmentAlignment({ x: 0, y: 0, z: 2 }, { x: 0, y: 3, z: 3 });
	check('45° tilt from un-normalized vectors', near(r.tiltDeg, 45, 1e-9), `tilt=${r.tiltDeg}`);
}
{
	// 4. azimuth: axis +z, target tipped toward +x → azimuth 0 (u = world +x)
	const s = Math.sin((10 * Math.PI) / 180);
	const c = Math.cos((10 * Math.PI) / 180);
	const rx = computeAbutmentAlignment({ x: 0, y: 0, z: 1 }, { x: s, y: 0, z: c });
	check('tilt toward +x → tilt 10°', near(rx.tiltDeg, 10, 1e-9), `tilt=${rx.tiltDeg}`);
	check('tilt toward +x → azimuth 0°', near(rx.azimuthDeg, 0, 1e-9), `az=${rx.azimuthDeg}`);
	// 5. target tipped toward +y → azimuth 90 (v = n × u)
	const ry = computeAbutmentAlignment({ x: 0, y: 0, z: 1 }, { x: 0, y: s, z: c });
	check('tilt toward +y → azimuth 90°', near(ry.azimuthDeg, 90, 1e-9), `az=${ry.azimuthDeg}`);
	// 6. target tipped toward −x → azimuth 180
	const rnx = computeAbutmentAlignment({ x: 0, y: 0, z: 1 }, { x: -s, y: 0, z: c });
	check('tilt toward −x → azimuth 180°', near(rnx.azimuthDeg, 180, 1e-9), `az=${rnx.azimuthDeg}`);
	// 7. target tipped toward −y → azimuth 270 (normalized to [0,360))
	const rny = computeAbutmentAlignment({ x: 0, y: 0, z: 1 }, { x: 0, y: -s, z: c });
	check('tilt toward −y → azimuth 270°', near(rny.azimuthDeg, 270, 1e-9), `az=${rny.azimuthDeg}`);
}
{
	// 8. axis near ±x uses the +y reference (frame stays orthonormal)
	const f = axisFrame({ x: 1, y: 0, z: 0 });
	const dotUN = f.u.x * f.n.x + f.u.y * f.n.y + f.u.z * f.n.z;
	const lenU = Math.hypot(f.u.x, f.u.y, f.u.z);
	check('axisFrame(±x) orthonormal', near(dotUN, 0, 1e-9) && near(lenU, 1, 1e-9));
	const r = computeAbutmentAlignment({ x: 1, y: 0, z: 0 }, { x: 1, y: 0.1, z: 0 });
	check('axis ≈ +x tilt finite + azimuth in [0,360)', r.tiltDeg > 0 && r.azimuthDeg >= 0 && r.azimuthDeg < 360);
}
{
	// 9. chooseAngulation picks the smallest sufficient angle
	check('chooseAngulation(0) → 0', chooseAngulation(0, [0, 17, 30]) === 0);
	check('chooseAngulation(12) → 17', chooseAngulation(12, [0, 17, 30]) === 17);
	check('chooseAngulation(17 + tiny) → 17 (tolerance)', chooseAngulation(17 + 1e-9, [0, 17, 30]) === 17);
	check('chooseAngulation(20) → 30', chooseAngulation(20, [0, 17, 30]) === 30);
	check('chooseAngulation unsorted list', chooseAngulation(12, [30, 0, 17]) === 17);
	check('chooseAngulation(5, []) → null', chooseAngulation(5, []) === null);
}
{
	// 10. residual deviation
	check('residual 17° abutment on 12° tilt = 5°', near(residualDeviation(12, 17), 5));
	check('residual with no abutment = full tilt', near(residualDeviation(40, null), 40));
}
{
	// 11. opposite axis/target (180°) stays finite
	const r = computeAbutmentAlignment({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 });
	check('antiparallel → tilt 180°', near(r.tiltDeg, 180, 1e-9), `tilt=${r.tiltDeg}`);
}

// ---------------- Part 2: virtual teeth ----------------

check('VIRTUAL_TEETH has 16 templates', VIRTUAL_TEETH.length === 16);
check(
	'VIRTUAL_TEETH tooth numbers unique',
	new Set(VIRTUAL_TEETH.map((t) => t.tooth)).size === 16
);
check(
	'VIRTUAL_TEETH plausible dimensions',
	VIRTUAL_TEETH.every((t) => t.widthMM >= 4 && t.widthMM <= 13 && t.heightMM >= 5 && t.heightMM <= 13)
);

const ALL_FDI = [...FDI_UPPER, ...FDI_LOWER];
check('32 FDI teeth listed', ALL_FDI.length === 32);
let outlinesOk = true;
let outlineDetail = '';
for (const tooth of ALL_FDI) {
	const poly = virtualToothOutline(tooth);
	const tpl = virtualToothTemplate(tooth);
	if (!tpl) {
		outlinesOk = false;
		outlineDetail = `tooth ${tooth}: no template`;
		break;
	}
	if (poly.length < 9) {
		// ≥ 8 distinct points + explicit closing point
		outlinesOk = false;
		outlineDetail = `tooth ${tooth}: only ${poly.length} points`;
		break;
	}
	const first = poly[0];
	const last = poly[poly.length - 1];
	if (first.x !== last.x || first.y !== last.y) {
		outlinesOk = false;
		outlineDetail = `tooth ${tooth}: not closed`;
		break;
	}
	if (!poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
		outlinesOk = false;
		outlineDetail = `tooth ${tooth}: non-finite point`;
		break;
	}
	const maxX = Math.max(...poly.map((p) => Math.abs(p.x)));
	const maxY = Math.max(...poly.map((p) => Math.abs(p.y)));
	if (maxX > tpl.widthMM || maxY > tpl.heightMM || maxX < 1 || maxY < 1) {
		outlinesOk = false;
		outlineDetail = `tooth ${tooth}: extent ${maxX.toFixed(1)}×${maxY.toFixed(1)} outside template box`;
		break;
	}
}
check('virtualToothOutline: closed polygon ≥ 8 points for all 32 FDI teeth', outlinesOk, outlineDetail);
check('virtualToothOutline rejects invalid FDI', virtualToothOutline(99).length === 0);
{
	const q1 = virtualToothOutline(16);
	const q2 = virtualToothOutline(26);
	check(
		'quadrant 2 mirrors quadrant 1 in x',
		q1.length === q2.length && q1.every((p, i) => near(p.x, -q2[i].x) && near(p.y, q2[i].y))
	);
}

// ---------------- Part 3: userAbutmentToSpec ----------------

const ua: UserAbutment = {
	name: 'Test custom',
	segments: [
		{ height: 2, lowerD: 4.5, upperD: 5.5 },
		{ height: 4, lowerD: 5.0, upperD: 4.0 }
	],
	inclination: 25,
	rotation: 135
};
const spec = userAbutmentToSpec(ua);
check('spec.type angled when inclination > 0', spec.type === 'angled');
check('spec.angle = inclination', spec.angle === 25);
check('spec.height = Σ segment heights', near(spec.height, 6));
check('spec.diameter = widest segment Ø', near(spec.diameter, 5.5));
check('spec.preset = custom', spec.preset === 'custom');
check('spec.rotation passthrough', spec.rotation === 135);
check(
	'spec.segments deep-copied',
	spec.segments?.length === 2 && spec.segments[0] !== ua.segments[0] &&
		spec.segments[0].upperD === 5.5
);
const straight = userAbutmentToSpec({ ...ua, inclination: 0 });
check('spec.type straight when inclination = 0', straight.type === 'straight' && straight.angle === 0);

// ----------------

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
