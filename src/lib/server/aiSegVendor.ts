/**
 * Real vendor CBCT AI segmentation backend (replaces the offline heuristic in
 * aiSeg.ts behind the same async-job + review-dialog contract).
 *
 * Pipeline:
 *   getVolume → downsample (longest axis ≤ MAX_AXIS voxels) → MetaImage (.mha)
 *   → POST {BASE}/api/ai/cbct_seg_inference (multipart, return_json) → unzip
 *   results.json (a [Z][Y][X][3] sRGB labelmap, voxel-aligned to the *sent*
 *   downsampled grid) → per-class binary masks (nearest legend color within a
 *   tolerance) → marching cubes (on the downsampled grid, spacing = the sent
 *   spacing, so vertices land in real mm aligned to the volume origin) → STL.
 *
 * Mask resolution therefore follows the DOWNSAMPLED grid: the longest axis is
 * capped at MAX_AXIS voxels (integer stride), which bounds the returned-JSON
 * in-memory parse. Sent spacing = origSpacing * stride keeps every mesh vertex
 * in the volume's real mm coordinate frame (origin 0,0,0).
 *
 * The vendor does NOT segment soft tissue; softTissueMask() adds a rule-based
 * soft-tissue envelope locally (HU > SOFT_HU minus the union of vendor masks),
 * exposed as an optional class the caller may include.
 *
 * Sending volume data to an external service is why this is behind an explicit,
 * audited "AI segmentation" user action (see the endpoint).
 */
import { unzipSync } from 'fflate';
import { marchingCubes } from '$lib/server/marchingCubes';
import { laplacianSmooth, removeSmallComponents } from '$lib/server/segLod';
import { meshToStlBinary } from '$lib/server/stl';
import { loadVolume } from '$lib/server/volumeCache';
import type { Dataset } from '$lib/types';

// ---------------------------------------------------------------------------
// Class legend (42 classes: name → sRGB color the labelmap encodes)
// ---------------------------------------------------------------------------

export const CLASS_LEGEND: Record<string, [number, number, number]> = {
	'Lower Jawbone': [216, 82, 24],
	'Upper Jawbone': [236, 176, 31],
	'Left Inferior Alveolar Canal': [125, 46, 141],
	'Right Inferior Alveolar Canal': [118, 171, 47],
	'Left Maxillary Sinus': [76, 189, 237],
	'Right Maxillary Sinus': [161, 19, 46],
	Pharynx: [76, 76, 76],
	Bridge: [153, 153, 153],
	Crown: [255, 0, 0],
	Implant: [255, 127, 0],
	'Upper Right Central Incisor': [190, 190, 0],
	'Upper Right Lateral Incisor': [0, 255, 0],
	'Upper Right Canine': [0, 0, 255],
	'Upper Right First Premolar': [170, 0, 255],
	'Upper Right Second Premolar': [84, 84, 0],
	'Upper Right First Molar': [84, 170, 0],
	'Upper Right Second Molar': [84, 255, 0],
	'Upper Right Third Molar (Wisdom Tooth)': [170, 84, 0],
	'Upper Left Central Incisor': [170, 170, 0],
	'Upper Left Lateral Incisor': [170, 255, 0],
	'Upper Left Canine': [255, 84, 0],
	'Upper Left First Premolar': [255, 170, 0],
	'Upper Left Second Premolar': [255, 255, 0],
	'Upper Left First Molar': [0, 84, 127],
	'Upper Left Second Molar': [0, 170, 127],
	'Upper Left Third Molar (Wisdom Tooth)': [0, 255, 127],
	'Lower Left Central Incisor': [84, 0, 127],
	'Lower Left Lateral Incisor': [84, 84, 127],
	'Lower Left Canine': [84, 170, 127],
	'Lower Left First Premolar': [84, 255, 127],
	'Lower Left Second Premolar': [170, 0, 127],
	'Lower Left First Molar': [170, 84, 127],
	'Lower Left Second Molar': [170, 170, 127],
	'Lower Left Third Molar (Wisdom Tooth)': [170, 255, 127],
	'Lower Right Central Incisor': [255, 0, 127],
	'Lower Right Lateral Incisor': [255, 84, 127],
	'Lower Right Canine': [255, 170, 127],
	'Lower Right First Premolar': [255, 255, 127],
	'Lower Right Second Premolar': [0, 84, 255],
	'Lower Right First Molar': [0, 170, 255],
	'Lower Right Second Molar': [0, 255, 255],
	'Lower Right Third Molar (Wisdom Tooth)': [84, 0, 255]
};

const TOOTH_QUADRANT: Record<string, number> = {
	'Upper Right': 1,
	'Upper Left': 2,
	'Lower Left': 3,
	'Lower Right': 4
};

const TOOTH_POSITION: [RegExp, number][] = [
	[/Central Incisor/, 1],
	[/Lateral Incisor/, 2],
	[/Canine/, 3],
	[/First Premolar/, 4],
	[/Second Premolar/, 5],
	[/First Molar/, 6],
	[/Second Molar/, 7],
	[/Third Molar/, 8]
];

/** FDI tooth number for a tooth class name, or null for non-tooth classes. */
export function toothFdi(name: string): number | null {
	let quadrant = 0;
	for (const [prefix, q] of Object.entries(TOOTH_QUADRANT)) {
		if (name.startsWith(prefix)) {
			quadrant = q;
			break;
		}
	}
	if (!quadrant) return null;
	for (const [re, pos] of TOOTH_POSITION) {
		if (re.test(name)) return quadrant * 10 + pos;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Longest downsampled axis (voxels) sent to the vendor / parsed back. */
export const MAX_AXIS = 300;
/** Max sRGB Euclidean distance for a voxel color to match a legend color. */
export const COLOR_TOLERANCE = 12;
/** Classes below this voxel count are dropped (noise). */
export const MIN_VOXELS = 40;
/** Local soft-tissue envelope threshold (HU). */
export const SOFT_HU = -300;

export interface VolumeData {
	vol: Int16Array;
	dims: { x: number; y: number; z: number };
	spacing: { x: number; y: number; z: number };
}

export interface VendorResult {
	labelmap: Uint8Array; // Z*Y*X*3 sRGB, x-fastest
	dims: { x: number; y: number; z: number };
	spacing: { x: number; y: number; z: number };
}

export interface ClassMesh {
	name: string;
	color: [number, number, number];
	fdi: number | null;
	stlBytes: Uint8Array;
	triangles: number;
}

// ---------------------------------------------------------------------------
// MetaImage (.mha) writer — exact header then raw int16 LE x-fastest body
// ---------------------------------------------------------------------------

/** Encode a volume as an uncompressed MetaImage (.mha). */
export function mhaEncode(v: VolumeData): Uint8Array {
	const header =
		'ObjectType = Image\n' +
		'NDims = 3\n' +
		'BinaryData = True\n' +
		'BinaryDataByteOrderMSB = False\n' +
		'CompressedData = False\n' +
		'TransformMatrix = 1 0 0 0 1 0 0 0 1\n' +
		'Offset = 0 0 0\n' +
		'CenterOfRotation = 0 0 0\n' +
		`ElementSpacing = ${v.spacing.x} ${v.spacing.y} ${v.spacing.z}\n` +
		`DimSize = ${v.dims.x} ${v.dims.y} ${v.dims.z}\n` +
		'ElementType = MET_SHORT\n' +
		'ElementDataFile = LOCAL\n';
	const headerBytes = new TextEncoder().encode(header);

	// raw int16 little-endian body, x-fastest (matches our volume layout)
	const expected = v.dims.x * v.dims.y * v.dims.z;
	const body = v.vol.length === expected ? v.vol : v.vol.subarray(0, expected);
	const bodyBytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);

	const out = new Uint8Array(headerBytes.length + bodyBytes.length);
	out.set(headerBytes, 0);
	out.set(bodyBytes, headerBytes.length);
	return out;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function vendorConfig(): { base: string; email: string; password: string } {
	const base = process.env.CDX_AISEG_URL ?? 'https://pbapi.becertain.ai';
	const email = process.env.CDX_AISEG_EMAIL ?? '';
	const password = process.env.CDX_AISEG_PASSWORD ?? '';
	if (!email || !password) {
		throw new Error('CDX_AISEG_EMAIL / CDX_AISEG_PASSWORD not set');
	}
	return { base: base.replace(/\/$/, ''), email, password };
}

/** True when vendor credentials are configured (used for backend selection). */
export function vendorConfigured(): boolean {
	return !!(process.env.CDX_AISEG_EMAIL && process.env.CDX_AISEG_PASSWORD);
}

/**
 * Authenticate against the PocketBase auth endpoint and return the raw token
 * (used verbatim as the `Authorization` header — NO "Bearer " prefix). The
 * token occasionally comes back empty transiently → retry once.
 */
export async function authenticate(): Promise<string> {
	const { base, email, password } = vendorConfig();
	const url = `${base}/api/collections/users/auth-with-password`;
	for (let attempt = 0; attempt < 2; attempt++) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identity: email, password })
		});
		if (!res.ok) {
			throw new Error(`Vendor auth failed: HTTP ${res.status}`);
		}
		const data = (await res.json()) as { token?: string };
		if (data.token) return data.token;
	}
	throw new Error('Vendor auth returned an empty token (after retry)');
}

// ---------------------------------------------------------------------------
// Downsampling
// ---------------------------------------------------------------------------

/** Integer stride so the longest axis is ≤ MAX_AXIS voxels. */
export function downsampleStride(dims: { x: number; y: number; z: number }): number {
	const longest = Math.max(dims.x, dims.y, dims.z);
	return Math.max(1, Math.ceil(longest / MAX_AXIS));
}

/** Nearest-neighbour decimate by an integer stride (x-fastest). */
export function downsampleVolume(v: VolumeData, stride: number): VolumeData {
	if (stride <= 1) return v;
	const nx = Math.floor((v.dims.x - 1) / stride) + 1;
	const ny = Math.floor((v.dims.y - 1) / stride) + 1;
	const nz = Math.floor((v.dims.z - 1) / stride) + 1;
	const out = new Int16Array(nx * ny * nz);
	const srcNxny = v.dims.x * v.dims.y;
	let o = 0;
	for (let z = 0; z < nz; z++) {
		const sz = z * stride * srcNxny;
		for (let y = 0; y < ny; y++) {
			const sy = sz + y * stride * v.dims.x;
			for (let x = 0; x < nx; x++) {
				out[o++] = v.vol[sy + x * stride];
			}
		}
	}
	return {
		vol: out,
		dims: { x: nx, y: ny, z: nz },
		spacing: {
			x: v.spacing.x * stride,
			y: v.spacing.y * stride,
			z: v.spacing.z * stride
		}
	};
}

// ---------------------------------------------------------------------------
// Vendor inference
// ---------------------------------------------------------------------------

/**
 * Run vendor inference on a volume. Downsamples so the longest axis ≤ MAX_AXIS,
 * encodes MetaImage, posts with return_json, unzips results.json, and parses it
 * into a flat x-fastest sRGB labelmap at the downsampled dims.
 */
export async function runVendorInference(
	v: VolumeData,
	opts?: { token?: string }
): Promise<VendorResult> {
	const stride = downsampleStride(v.dims);
	const ds = downsampleVolume(v, stride);
	const mha = mhaEncode(ds);

	const token = opts?.token ?? (await authenticate());
	const { base } = vendorConfig();

	const form = new FormData();
	form.set('input_file', new Blob([mha as Uint8Array<ArrayBuffer>]), 'input.mha');
	form.set(
		'meta_data',
		new Blob([JSON.stringify({ return_json: true })], { type: 'application/json' })
	);

	const res = await fetch(`${base}/api/ai/cbct_seg_inference`, {
		method: 'POST',
		headers: { Authorization: token },
		body: form
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Vendor inference failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
	}

	const zipBytes = new Uint8Array(await res.arrayBuffer());
	const files = unzipSync(zipBytes);
	const jsonName = Object.keys(files).find((n) => n.endsWith('results.json'));
	if (!jsonName) {
		throw new Error(`Vendor response zip missing results.json (entries: ${Object.keys(files).join(', ')})`);
	}
	const parsed = JSON.parse(new TextDecoder().decode(files[jsonName])) as number[][][][];

	const labelmap = flattenLabelmap(parsed, ds.dims);
	return { labelmap, dims: ds.dims, spacing: ds.spacing };
}

/** [Z][Y][X][3] nested array → flat x-fastest Uint8Array of length Z*Y*X*3. */
function flattenLabelmap(
	arr: number[][][][],
	dims: { x: number; y: number; z: number }
): Uint8Array {
	const { x: nx, y: ny, z: nz } = dims;
	const out = new Uint8Array(nx * ny * nz * 3);
	let o = 0;
	for (let z = 0; z < nz; z++) {
		const zPlane = arr[z];
		for (let y = 0; y < ny; y++) {
			const row = zPlane?.[y];
			for (let x = 0; x < nx; x++) {
				const px = row?.[x];
				if (px) {
					out[o] = px[0] | 0;
					out[o + 1] = px[1] | 0;
					out[o + 2] = px[2] | 0;
				}
				o += 3;
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Labelmap → per-class masks
// ---------------------------------------------------------------------------

const LEGEND_ENTRIES = Object.entries(CLASS_LEGEND) as [string, [number, number, number]][];

/** Nearest legend class for an sRGB triple within COLOR_TOLERANCE, else null. */
export function nearestClass(r: number, g: number, b: number): string | null {
	if (r === 0 && g === 0 && b === 0) return null; // background
	let best: string | null = null;
	let bestD = COLOR_TOLERANCE * COLOR_TOLERANCE;
	for (const [name, [lr, lg, lb]] of LEGEND_ENTRIES) {
		const dr = r - lr;
		const dg = g - lg;
		const db = b - lb;
		const d = dr * dr + dg * dg + db * db;
		if (d <= bestD) {
			bestD = d;
			best = name;
		}
	}
	return best;
}

/**
 * Decode a flat sRGB labelmap into per-class binary masks. Each voxel is
 * assigned to its nearest legend color (≤ COLOR_TOLERANCE); classes with
 * ≥ MIN_VOXELS voxels are returned.
 */
export function labelmapToClassMasks(
	labelmap: Uint8Array,
	dims: { x: number; y: number; z: number }
): Map<string, Uint8Array> {
	const voxels = dims.x * dims.y * dims.z;
	const masks = new Map<string, Uint8Array>();
	const counts = new Map<string, number>();
	for (let i = 0; i < voxels; i++) {
		const o = i * 3;
		const cls = nearestClass(labelmap[o], labelmap[o + 1], labelmap[o + 2]);
		if (!cls) continue;
		let mask = masks.get(cls);
		if (!mask) {
			mask = new Uint8Array(voxels);
			masks.set(cls, mask);
			counts.set(cls, 0);
		}
		mask[i] = 1;
		counts.set(cls, (counts.get(cls) ?? 0) + 1);
	}
	for (const [cls, n] of counts) {
		if (n < MIN_VOXELS) masks.delete(cls);
	}
	return masks;
}

// ---------------------------------------------------------------------------
// Soft tissue (locally computed; vendor does not segment it)
// ---------------------------------------------------------------------------

/**
 * Rule-based soft-tissue envelope: HU > SOFT_HU minus the union of the given
 * (downsampled-grid) vendor masks. Operates on the downsampled volume so it is
 * voxel-aligned with the class masks. Returns null if below MIN_VOXELS.
 */
export function softTissueMask(
	dsVol: VolumeData,
	vendorMasks: Iterable<Uint8Array>
): Uint8Array | null {
	const voxels = dsVol.dims.x * dsVol.dims.y * dsVol.dims.z;
	const union = new Uint8Array(voxels);
	for (const m of vendorMasks) {
		for (let i = 0; i < voxels; i++) if (m[i]) union[i] = 1;
	}
	const out = new Uint8Array(voxels);
	let count = 0;
	for (let i = 0; i < voxels; i++) {
		if (dsVol.vol[i] > SOFT_HU && !union[i]) {
			out[i] = 1;
			count++;
		}
	}
	return count >= MIN_VOXELS ? out : null;
}

// ---------------------------------------------------------------------------
// Mask → mesh → STL
// ---------------------------------------------------------------------------

/**
 * Marching cubes on a binary mask at the downsampled grid (spacing = the sent
 * spacing, so verts land in real mm aligned to the volume origin), light noise
 * removal + one Laplacian smoothing pass, then binary STL.
 */
export function maskToStl(
	mask: Uint8Array,
	dims: { x: number; y: number; z: number },
	spacing: { x: number; y: number; z: number },
	name: string
): { stlBytes: Uint8Array; triangles: number } {
	const d: [number, number, number] = [dims.x, dims.y, dims.z];
	const work = mask.slice();
	removeSmallComponents(work, d, MIN_VOXELS);

	// smooth-ish scalar field: 1 → 200, iso 100 (matches segLod convention)
	const scalars = new Uint8Array(work.length);
	for (let i = 0; i < work.length; i++) if (work[i]) scalars[i] = 200;

	const mesh = marchingCubes(scalars, d, [spacing.x, spacing.y, spacing.z], 100, 1);
	const positions = mesh.positions.length >= 9 ? laplacianSmooth(mesh.positions, 1) : mesh.positions;
	const triangles = Math.floor(positions.length / 9);
	return { stlBytes: meshToStlBinary(positions, name), triangles };
}

// ---------------------------------------------------------------------------
// Full volume helper
// ---------------------------------------------------------------------------

/** Load a dataset's HU volume into the VolumeData shape this module uses. */
export async function getVolume(ds: Dataset): Promise<VolumeData> {
	const vol = await loadVolume(ds);
	return {
		vol,
		dims: { x: ds.cols, y: ds.rows, z: ds.slices },
		spacing: { x: ds.spacing_x, y: ds.spacing_y, z: ds.spacing_z }
	};
}
