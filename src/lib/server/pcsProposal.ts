/**
 * Geometric auto-proposal of the Patient Coordinate System (PCS) and a
 * panoramic curve from a jaw-arch fit on the bone segmentation (FEATURES §5).
 *
 * Algorithm:
 *  1. Threshold bone (HU > 300) and find the axial slice band with the
 *     largest bone cross-section — the jaw-arch region.
 *  2. PCA of the band's bone-voxel positions (mm). The principal axis closest
 *     to vertical is taken as the occlusal-plane normal u (the slab axis);
 *     pitch/roll are derived so that Ry(pitch)·Rx(roll) maps u onto +z, i.e.
 *     they level the occlusal plane.
 *  3. Yaw: in the levelled frame, polar-sample the bone mass from its
 *     centroid (72 rays, per-ray max radius). The horseshoe's posterior
 *     opening shows up as the angular gap (rays with no/short bone); the
 *     anterior direction is opposite the gap. Yaw is the smallest in-plane
 *     rotation that turns the anterior direction onto the ±y axis.
 *  4. Panoramic curve: per-ray outer bone edge minus 3 mm (≈ mid-arch),
 *     smoothed, over the front 240° centred on the anterior direction,
 *     downsampled to 12–20 control points with the anterior point in the
 *     middle of the polyline.
 *
 * The returned yaw/pitch/roll follow the rotationMatrix(yaw, pitch, roll) =
 * Rz·Ry·Rx convention of src/lib/server/resample.ts, i.e. they are exactly
 * the angles to POST to /api/datasets/[id]/align. The curve is returned in
 * volume-local mm (voxel centre = index·spacing) of the volume AFTER that
 * alignment has been applied, so the client should apply the rotation first
 * and then set the curve.
 *
 * Degenerate volumes (no bone, best-slice bone area < 2 cm², or no usable
 * arch) yield { yaw: 0, pitch: 0, roll: 0, curve: null, confidence: 'low' }.
 */

export interface PcsVolume {
	/** HU values, Int16, x fastest, then y, then z (volumeCache convention). */
	data: Int16Array;
	dims: { x: number; y: number; z: number };
	spacing: { x: number; y: number; z: number };
}

export interface PcsProposal {
	yaw: number;
	pitch: number;
	roll: number;
	curve: { x: number; y: number }[] | null;
	confidence: 'good' | 'low';
}

const BONE_HU = 300;
const MIN_AREA_MM2 = 200; // 2 cm²
const BAND_FRACTION = 0.35; // slices with ≥ this fraction of the peak area join the band
const BAND_PAD_MM = 2;
const RAYS = 72;
const CURVE_INSET_MM = 3;
const FRONT_HALF_RAD = (120 * Math.PI) / 180; // front 240°
const MAX_PCA_SAMPLES = 250_000;
const MIN_CURVE_POINTS = 12;
const MAX_CURVE_POINTS = 20;

const RAD2DEG = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;

function lowConfidence(): PcsProposal {
	return { yaw: 0, pitch: 0, roll: 0, curve: null, confidence: 'low' };
}

/** Eigen-decomposition of a symmetric 3×3 matrix via cyclic Jacobi rotations. */
function jacobiEigen3(m: number[]): { values: number[]; vectors: number[][] } {
	// a = working copy (row-major), v = accumulated rotations (columns = eigenvectors)
	const a = m.slice();
	const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	for (let sweep = 0; sweep < 32; sweep++) {
		let off = 0;
		for (const [p, q] of [
			[0, 1],
			[0, 2],
			[1, 2]
		] as const) {
			off += a[p * 3 + q] * a[p * 3 + q];
		}
		if (off < 1e-18) break;
		for (const [p, q] of [
			[0, 1],
			[0, 2],
			[1, 2]
		] as const) {
			const apq = a[p * 3 + q];
			if (Math.abs(apq) < 1e-15) continue;
			const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
			const tSign = theta >= 0 ? 1 : -1;
			const tTan = tSign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
			const c = 1 / Math.sqrt(tTan * tTan + 1);
			const s = tTan * c;
			for (let k = 0; k < 3; k++) {
				const akp = a[k * 3 + p];
				const akq = a[k * 3 + q];
				a[k * 3 + p] = c * akp - s * akq;
				a[k * 3 + q] = s * akp + c * akq;
			}
			for (let k = 0; k < 3; k++) {
				const apk = a[p * 3 + k];
				const aqk = a[q * 3 + k];
				a[p * 3 + k] = c * apk - s * aqk;
				a[q * 3 + k] = s * apk + c * aqk;
			}
			for (let k = 0; k < 3; k++) {
				const vkp = v[k * 3 + p];
				const vkq = v[k * 3 + q];
				v[k * 3 + p] = c * vkp - s * vkq;
				v[k * 3 + q] = s * vkp + c * vkq;
			}
		}
	}
	return {
		values: [a[0], a[4], a[8]],
		vectors: [
			[v[0], v[3], v[6]],
			[v[1], v[4], v[7]],
			[v[2], v[5], v[8]]
		]
	};
}

/** Wrap an angle to (-π, π]. */
function wrapPi(a: number): number {
	let r = a % TWO_PI;
	if (r <= -Math.PI) r += TWO_PI;
	if (r > Math.PI) r -= TWO_PI;
	return r;
}

export function proposePcs(vol: PcsVolume): PcsProposal {
	const nx = vol.dims.x;
	const ny = vol.dims.y;
	const nz = vol.dims.z;
	const sx = vol.spacing.x;
	const sy = vol.spacing.y;
	const sz = vol.spacing.z;
	const data = vol.data;
	const nxy = nx * ny;
	if (nx < 2 || ny < 2 || nz < 1 || data.length !== nxy * nz) return lowConfidence();

	// ---- 1. per-slice bone area, peak slice ----
	const count = new Float64Array(nz);
	let totalBone = 0;
	for (let z = 0; z < nz; z++) {
		let c = 0;
		const base = z * nxy;
		for (let i = 0; i < nxy; i++) if (data[base + i] > BONE_HU) c++;
		count[z] = c;
		totalBone += c;
	}
	if (totalBone === 0) return lowConfidence();

	let zBest = 0;
	for (let z = 1; z < nz; z++) if (count[z] > count[zBest]) zBest = z;
	const pxArea = sx * sy;
	if (count[zBest] * pxArea < MIN_AREA_MM2) return lowConfidence();

	// band: contiguous slices around the peak above BAND_FRACTION of it, padded
	const thr = count[zBest] * BAND_FRACTION;
	let z0 = zBest;
	while (z0 > 0 && count[z0 - 1] >= thr) z0--;
	let z1 = zBest;
	while (z1 < nz - 1 && count[z1 + 1] >= thr) z1++;
	const pad = Math.ceil(BAND_PAD_MM / sz);
	z0 = Math.max(0, z0 - pad);
	z1 = Math.min(nz - 1, z1 + pad);

	// ---- collect (subsampled) bone voxel positions in the band, in mm ----
	let bandCount = 0;
	for (let z = z0; z <= z1; z++) bandCount += count[z];
	if (bandCount === 0) return lowConfidence();
	const stride = Math.max(1, Math.ceil(bandCount / MAX_PCA_SAMPLES));
	const px: number[] = [];
	const py: number[] = [];
	const pz: number[] = [];
	let seen = 0;
	for (let z = z0; z <= z1; z++) {
		const zb = z * nxy;
		const zmm = z * sz;
		for (let y = 0; y < ny; y++) {
			const yb = zb + y * nx;
			const ymm = y * sy;
			for (let x = 0; x < nx; x++) {
				if (data[yb + x] > BONE_HU) {
					if (seen % stride === 0) {
						px.push(x * sx);
						py.push(ymm);
						pz.push(zmm);
					}
					seen++;
				}
			}
		}
	}
	const n = px.length;
	if (n < 32) return lowConfidence();

	// ---- 2. PCA → occlusal-plane normal → pitch/roll ----
	let mx = 0;
	let my = 0;
	let mz = 0;
	for (let i = 0; i < n; i++) {
		mx += px[i];
		my += py[i];
		mz += pz[i];
	}
	mx /= n;
	my /= n;
	mz /= n;
	let cxx = 0,
		cxy = 0,
		cxz = 0,
		cyy = 0,
		cyz = 0,
		czz = 0;
	for (let i = 0; i < n; i++) {
		const dx = px[i] - mx;
		const dy = py[i] - my;
		const dz = pz[i] - mz;
		cxx += dx * dx;
		cxy += dx * dy;
		cxz += dx * dz;
		cyy += dy * dy;
		cyz += dy * dz;
		czz += dz * dz;
	}
	const { vectors } = jacobiEigen3([cxx / n, cxy / n, cxz / n, cxy / n, cyy / n, cyz / n, cxz / n, cyz / n, czz / n]);

	// the principal axis closest to vertical is the slab normal of the
	// (band-limited, roughly planar) jaw arch — robust for tilts < 45°
	let u = vectors[0];
	for (const vec of vectors) if (Math.abs(vec[2]) > Math.abs(u[2])) u = vec;
	const uLen = Math.hypot(u[0], u[1], u[2]);
	if (uLen < 1e-9 || Math.abs(u[2]) / uLen < 0.3) return lowConfidence();
	let ux = u[0] / uLen;
	let uy = u[1] / uLen;
	let uz = u[2] / uLen;
	if (uz < 0) {
		ux = -ux;
		uy = -uy;
		uz = -uz;
	}

	// With R = Rz(yaw)·Ry(pitch)·Rx(roll), R·u = +z for any yaw iff u equals
	// R's third row (-sinP, cosP·sinR, cosP·cosR):
	const pitchRad = Math.asin(Math.max(-1, Math.min(1, -ux)));
	const rollRad = Math.atan2(uy, uz);

	// ---- level the samples: M = Ry(pitch)·Rx(roll), about the volume centre ----
	const cX = ((nx - 1) / 2) * sx;
	const cY = ((ny - 1) / 2) * sy;
	const cZ = ((nz - 1) / 2) * sz;
	const cosP = Math.cos(pitchRad);
	const sinP = Math.sin(pitchRad);
	const cosR = Math.cos(rollRad);
	const sinR = Math.sin(rollRad);
	// row-major M = Ry(pitch)·Rx(roll)
	const m00 = cosP,
		m01 = sinP * sinR,
		m02 = sinP * cosR,
		m10 = 0,
		m11 = cosR,
		m12 = -sinR;
	const qx = new Float64Array(n);
	const qy = new Float64Array(n);
	let gx = 0;
	let gy = 0;
	for (let i = 0; i < n; i++) {
		const dx = px[i] - cX;
		const dy = py[i] - cY;
		const dz = pz[i] - cZ;
		const lx = cX + m00 * dx + m01 * dy + m02 * dz;
		const ly = cY + m10 * dx + m11 * dy + m12 * dz;
		qx[i] = lx;
		qy[i] = ly;
		gx += lx;
		gy += ly;
	}
	gx /= n; // levelled arch centroid (xy)
	gy /= n;

	// ---- 3. polar profile from the centroid: per-ray max bone radius ----
	const rMax = new Float64Array(RAYS).fill(-1); // -1 = no bone on this ray
	for (let i = 0; i < n; i++) {
		const dx = qx[i] - gx;
		const dy = qy[i] - gy;
		const r = Math.hypot(dx, dy);
		if (r < 1e-6) continue;
		let b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / TWO_PI) * RAYS);
		if (b >= RAYS) b = RAYS - 1;
		if (r > rMax[b]) rMax[b] = r;
	}
	const valid = [];
	for (let b = 0; b < RAYS; b++) if (rMax[b] > 0) valid.push(rMax[b]);
	if (valid.length < MIN_CURVE_POINTS) return lowConfidence();
	valid.sort((a, b) => a - b);
	const median = valid[valid.length >> 1];

	// gap = empty rays + rays much shorter than the median (posterior opening)
	let gw = 0;
	let gc = 0;
	let gs = 0;
	for (let b = 0; b < RAYS; b++) {
		const theta = ((b + 0.5) / RAYS) * TWO_PI - Math.PI;
		const w = rMax[b] <= 0 ? median : Math.max(0, median * 0.5 - rMax[b]);
		if (w <= 0) continue;
		gw += w;
		gc += w * Math.cos(theta);
		gs += w * Math.sin(theta);
	}
	let anteriorRad = Math.PI / 2; // default: assume anterior already on +y
	if (gw > 0 && Math.hypot(gc, gs) > 1e-9) {
		anteriorRad = wrapPi(Math.atan2(gs, gc) + Math.PI); // opposite the gap
	}
	// smallest rotation that puts the anterior direction on the ±y axis
	let yawRad = wrapPi(Math.PI / 2 - anteriorRad);
	if (yawRad > Math.PI / 2) yawRad -= Math.PI;
	if (yawRad <= -Math.PI / 2) yawRad += Math.PI;

	// ---- 4. panoramic curve over the front 240°, anterior in the middle ----
	// collect rays within ±120° of the anterior direction (ordered by offset)
	const front: { offset: number; theta: number; r: number }[] = [];
	for (let b = 0; b < RAYS; b++) {
		if (rMax[b] <= 0) continue;
		const theta = ((b + 0.5) / RAYS) * TWO_PI - Math.PI;
		const offset = wrapPi(theta - anteriorRad);
		if (Math.abs(offset) <= FRONT_HALF_RAD) front.push({ offset, theta, r: rMax[b] });
	}
	front.sort((a, b) => a.offset - b.offset);
	if (front.length < MIN_CURVE_POINTS) return lowConfidence();

	// smooth the radial profile (1-2-1 kernel, two passes)
	for (let pass = 0; pass < 2; pass++) {
		const r0 = front.map((f) => f.r);
		for (let i = 0; i < front.length; i++) {
			const a = r0[Math.max(0, i - 1)];
			const c = r0[Math.min(front.length - 1, i + 1)];
			front[i].r = (a + 2 * r0[i] + c) / 4;
		}
	}

	// downsample to 12–20 control points (evenly along the angular range)
	const target = Math.min(Math.max(MIN_CURVE_POINTS, Math.min(front.length, 16)), MAX_CURVE_POINTS);
	const picks: number[] = [];
	for (let i = 0; i < target; i++) {
		const idx = Math.round((i * (front.length - 1)) / (target - 1));
		if (picks.length === 0 || picks[picks.length - 1] !== idx) picks.push(idx);
	}
	if (picks.length < MIN_CURVE_POINTS) return lowConfidence();

	// outer edge minus 3 mm ≈ mid-arch; then rotate by yaw about the volume
	// centre so the points live in the post-align frame (volume-local mm)
	const cosYw = Math.cos(yawRad);
	const sinYw = Math.sin(yawRad);
	const curve = picks.map((i) => {
		const f = front[i];
		const r = Math.max(1, f.r - CURVE_INSET_MM);
		const lx = gx + r * Math.cos(f.theta);
		const ly = gy + r * Math.sin(f.theta);
		const dx = lx - cX;
		const dy = ly - cY;
		return {
			x: cX + cosYw * dx - sinYw * dy,
			y: cY + sinYw * dx + cosYw * dy
		};
	});

	return {
		yaw: yawRad * RAD2DEG,
		pitch: pitchRad * RAD2DEG,
		roll: rollRad * RAD2DEG,
		curve,
		confidence: 'good'
	};
}
