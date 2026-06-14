/**
 * Vendor intraoral-scan (IOS) tooth-segmentation backend.
 *
 * Pipeline:
 *   scan mesh bytes (.obj/.stl/.ply) → POST {BASE}/api/ai/ios_seg_inference
 *   (multipart input_file) → binary GLB (the SAME mesh with a per-vertex
 *   COLOR_0 attribute encoding the class) → decode COLOR_0 to per-vertex
 *   label indices (exact RGB → label via the vendored _IOS_COLORS table) →
 *   label → FDI tooth number.
 *
 * The model output is literally `vertex_colors = _IOS_COLORS[label]`, so the
 * decode is an EXACT RGB→label lookup. Label 0 = gingiva; labels 1..32 map to
 * FDI numbers (FDI_TOOTH_NUMBER_CLASSES[label-1]); labels 33..38 are
 * unknown/other (fdi=null); any color with no exact legend match decodes to -1.
 *
 * Reuses authenticate()/base URL from aiSegVendor.ts — auth is NOT
 * reimplemented here.
 */
import { unzipSync } from 'fflate';
import { authenticate } from '$lib/server/aiSegVendor';

// ---------------------------------------------------------------------------
// Vendored constants (must match the model exactly)
// ---------------------------------------------------------------------------

/**
 * _IOS_COLORS — 39 RGBA rows, index = label. The model assigns each vertex
 * `_IOS_COLORS[label]` as its COLOR_0. Decode is the inverse: exact RGB → label.
 */
export const IOS_COLOR_LEGEND: ReadonlyArray<readonly [number, number, number, number]> = [
	[255, 255, 255, 255],
	[174, 199, 232, 255],
	[152, 223, 138, 255],
	[31, 119, 180, 255],
	[255, 187, 120, 255],
	[188, 189, 34, 255],
	[140, 86, 75, 255],
	[255, 152, 150, 255],
	[214, 39, 40, 255],
	[197, 176, 213, 255],
	[148, 103, 189, 255],
	[196, 156, 148, 255],
	[23, 190, 207, 255],
	[247, 182, 210, 255],
	[66, 188, 102, 255],
	[219, 219, 141, 255],
	[140, 57, 197, 255],
	[202, 185, 52, 255],
	[51, 176, 203, 255],
	[200, 54, 131, 255],
	[92, 193, 61, 255],
	[78, 71, 183, 255],
	[172, 114, 82, 255],
	[255, 127, 14, 255],
	[91, 163, 138, 255],
	[153, 98, 156, 255],
	[140, 153, 101, 255],
	[158, 218, 229, 255],
	[100, 125, 154, 255],
	[178, 127, 135, 255],
	[146, 111, 194, 255],
	[44, 160, 44, 255],
	[112, 128, 144, 255],
	[96, 207, 209, 255],
	[227, 119, 194, 255],
	[213, 92, 176, 255],
	[94, 106, 211, 255],
	[82, 84, 163, 255],
	[100, 85, 144, 255]
];

/**
 * FDI tooth numbers for labels 1..32 (FDI_TOOTH_NUMBER_CLASSES[label-1]).
 * Label 0 = gingiva; labels 33..38 are unknown/other (no FDI).
 */
export const FDI_TOOTH_NUMBER_CLASSES: readonly string[] = [
	'18', '17', '16', '15', '14', '13', '12', '11',
	'21', '22', '23', '24', '25', '26', '27', '28',
	'38', '37', '36', '35', '34', '33', '32', '31',
	'41', '42', '43', '44', '45', '46', '47', '48'
];

/** Map "r,g,b" → label index, built once from IOS_COLOR_LEGEND (exact match). */
const RGB_TO_LABEL: Map<string, number> = (() => {
	const m = new Map<string, number>();
	for (let label = 0; label < IOS_COLOR_LEGEND.length; label++) {
		const [r, g, b] = IOS_COLOR_LEGEND[label];
		m.set(`${r},${g},${b}`, label);
	}
	return m;
})();

/**
 * FDI tooth number for a label, or null. Label 0 = gingiva → null. Labels
 * 1..32 → FDI_TOOTH_NUMBER_CLASSES[label-1]. Labels 33..38 (other) and -1
 * (unmatched) → null.
 */
export function labelToFdi(label: number): string | null {
	if (label >= 1 && label <= 32) return FDI_TOOTH_NUMBER_CLASSES[label - 1];
	return null;
}

// ---------------------------------------------------------------------------
// GLB parsing
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian u32
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

interface GlbAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType?: number;
	count?: number;
	type?: string;
}
interface GlbBufferView {
	buffer?: number;
	byteOffset?: number;
	byteLength?: number;
}
interface GlbJson {
	accessors?: GlbAccessor[];
	bufferViews?: GlbBufferView[];
	meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number }[] }[];
}

// glTF componentType codes.
const CT_U8 = 5121;
const CT_U16 = 5123;
const CT_U32 = 5125;
const CT_F32 = 5126;

/** Split a GLB into its JSON object and BIN chunk (Uint8Array view). */
function splitGlb(glb: Uint8Array): { json: GlbJson; bin: Uint8Array } {
	if (glb.byteLength < 12) throw new Error('GLB too short for header');
	const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a GLB (missing 'glTF' magic)");
	const total = dv.getUint32(8, true);

	let json: GlbJson | null = null;
	let bin: Uint8Array | null = null;
	let off = 12;
	const end = Math.min(total, glb.byteLength);
	while (off + 8 <= end) {
		const chunkLen = dv.getUint32(off, true);
		const chunkType = dv.getUint32(off + 4, true);
		const dataStart = off + 8;
		const dataEnd = dataStart + chunkLen;
		if (dataEnd > glb.byteLength) throw new Error('GLB chunk exceeds buffer length');
		const data = glb.subarray(dataStart, dataEnd);
		if (chunkType === CHUNK_JSON) {
			json = JSON.parse(new TextDecoder().decode(data)) as GlbJson;
		} else if (chunkType === CHUNK_BIN) {
			bin = data;
		}
		off = dataEnd;
	}
	if (!json) throw new Error('GLB missing JSON chunk');
	if (!bin) throw new Error('GLB missing BIN chunk');
	return { json, bin };
}

/** Read the byte range a bufferView covers, relative to the BIN chunk. */
function viewBytes(bin: Uint8Array, bufferViews: GlbBufferView[], idx: number): Uint8Array {
	const bv = bufferViews[idx];
	if (!bv) throw new Error(`bufferView ${idx} missing`);
	const start = bv.byteOffset ?? 0;
	const len = bv.byteLength ?? 0;
	if (start + len > bin.byteLength) throw new Error('bufferView exceeds BIN chunk');
	return bin.subarray(start, start + len);
}

/**
 * Pure, network-free decode: parse a GLB whose meshes[0].primitives[0] carries
 * a COLOR_0 (VEC4 uint8) attribute and return per-vertex label indices (exact
 * RGB→label; unmatched colors decode to -1). Sanity-checks vertexCount against
 * the POSITION accessor when present.
 */
export function decodeIosGlb(glb: Uint8Array): { perVertexLabel: Int16Array; vertexCount: number } {
	const { json, bin } = splitGlb(glb);
	const accessors = json.accessors ?? [];
	const bufferViews = json.bufferViews ?? [];
	const prim = json.meshes?.[0]?.primitives?.[0];
	const attrs = prim?.attributes;
	if (!attrs || attrs.COLOR_0 == null) {
		throw new Error('GLB has no meshes[0].primitives[0].attributes.COLOR_0');
	}

	const colorAcc = accessors[attrs.COLOR_0];
	if (!colorAcc || colorAcc.bufferView == null) throw new Error('COLOR_0 accessor missing/invalid');
	if (colorAcc.type !== 'VEC4') throw new Error(`COLOR_0 type ${colorAcc.type}, expected VEC4`);
	const count = colorAcc.count ?? 0;

	// Sanity check against POSITION vertex count.
	if (attrs.POSITION != null) {
		const posAcc = accessors[attrs.POSITION];
		if (posAcc?.count != null && posAcc.count !== count) {
			throw new Error(`COLOR_0 count ${count} != POSITION count ${posAcc.count}`);
		}
	}

	const colorBytes = viewBytes(bin, bufferViews, colorAcc.bufferView);
	const accOff = colorAcc.byteOffset ?? 0;
	// COLOR_0 is VEC4 uint8 (4 bytes/vertex), tightly packed within its view.
	const needed = accOff + count * 4;
	if (needed > colorBytes.byteLength) {
		throw new Error(`COLOR_0 data underflow: need ${needed}, have ${colorBytes.byteLength}`);
	}

	const perVertexLabel = new Int16Array(count);
	for (let i = 0; i < count; i++) {
		const o = accOff + i * 4;
		const r = colorBytes[o];
		const g = colorBytes[o + 1];
		const b = colorBytes[o + 2];
		const label = RGB_TO_LABEL.get(`${r},${g},${b}`);
		perVertexLabel[i] = label === undefined ? -1 : label;
	}
	return { perVertexLabel, vertexCount: count };
}

/** Read a tightly-packed VEC3 float32 accessor (e.g. POSITION) as a Float32Array. */
function readVec3Float(
	bin: Uint8Array,
	bufferViews: GlbBufferView[],
	accessors: GlbAccessor[],
	idx: number
): Float32Array {
	const acc = accessors[idx];
	if (!acc || acc.bufferView == null) throw new Error(`accessor ${idx} missing`);
	if (acc.type !== 'VEC3' || acc.componentType !== CT_F32) {
		throw new Error(`accessor ${idx}: expected VEC3 float`);
	}
	const count = acc.count ?? 0;
	const bytes = viewBytes(bin, bufferViews, acc.bufferView);
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const off = acc.byteOffset ?? 0;
	const out = new Float32Array(count * 3);
	for (let i = 0; i < count * 3; i++) out[i] = dv.getFloat32(off + i * 4, true);
	return out;
}

/** Read a SCALAR index accessor (u8/u16/u32) as a Uint32Array. */
function readIndex(
	bin: Uint8Array,
	bufferViews: GlbBufferView[],
	accessors: GlbAccessor[],
	idx: number
): Uint32Array {
	const acc = accessors[idx];
	if (!acc || acc.bufferView == null) throw new Error(`index accessor ${idx} missing`);
	const count = acc.count ?? 0;
	const bytes = viewBytes(bin, bufferViews, acc.bufferView);
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const off = acc.byteOffset ?? 0;
	const out = new Uint32Array(count);
	if (acc.componentType === CT_U32) for (let i = 0; i < count; i++) out[i] = dv.getUint32(off + i * 4, true);
	else if (acc.componentType === CT_U16) for (let i = 0; i < count; i++) out[i] = dv.getUint16(off + i * 2, true);
	else if (acc.componentType === CT_U8) for (let i = 0; i < count; i++) out[i] = bytes[off + i];
	else throw new Error(`index componentType ${acc.componentType} unsupported`);
	return out;
}

/**
 * Decode the GLB into geometry + per-vertex labels. The model preserves the
 * (possibly re-welded) topology, so returning its POSITION/indices lets the
 * client rebuild the coloured mesh faithfully instead of mapping labels back
 * onto the sent buffers.
 */
export function decodeIosGlbGeometry(glb: Uint8Array): {
	positions: Float32Array;
	index?: Uint32Array;
	perVertexLabel: Int16Array;
	vertexCount: number;
} {
	const { json, bin } = splitGlb(glb);
	const accessors = json.accessors ?? [];
	const bufferViews = json.bufferViews ?? [];
	const prim = json.meshes?.[0]?.primitives?.[0];
	const attrs = prim?.attributes;
	if (!attrs || attrs.POSITION == null) throw new Error('GLB has no POSITION attribute');
	const { perVertexLabel, vertexCount } = decodeIosGlb(glb);
	const positions = readVec3Float(bin, bufferViews, accessors, attrs.POSITION);
	const index = prim?.indices != null ? readIndex(bin, bufferViews, accessors, prim.indices) : undefined;
	return { positions, index, perVertexLabel, vertexCount };
}

// ---------------------------------------------------------------------------
// Vendor inference
// ---------------------------------------------------------------------------

function vendorBase(): string {
	return (process.env.CDX_AISEG_URL ?? 'https://pbapi.becertain.ai').replace(/\/$/, '');
}

export interface IosSegResult {
	/** Per-vertex label index (0=gingiva, 1..32=tooth, 33..38=other, -1=unmatched). */
	perVertexLabel: Int16Array;
	/**
	 * Per-vertex FDI string (or null). Only populated when vertexCount is small
	 * enough to be cheap; null for large meshes (use presentFdis + perVertexLabel).
	 */
	perVertexFdi: (string | null)[] | null;
	vertexCount: number;
	/** Distinct labels present (sorted, excludes -1 unmatched). */
	presentLabels: number[];
	/** Distinct FDI numbers present (sorted). */
	presentFdis: string[];
	/** Number of vertices labelled gingiva (label 0). */
	gingivaCount: number;
	/** Segmented mesh vertex positions (xyz, tightly packed) — only when includeGeometry. */
	positions?: Float32Array;
	/** Triangle index into positions — only when includeGeometry and the GLB is indexed. */
	index?: Uint32Array;
}

/** Threshold above which per-vertex FDI strings are NOT materialised (memory). */
const PER_VERTEX_FDI_MAX = 20000;

/**
 * Run vendor IOS tooth segmentation on a scan mesh. Authenticates (unless a
 * token is supplied), posts the mesh, parses the returned GLB (or unzips a 'PK'
 * zip and takes the .glb entry), and decodes COLOR_0 into per-vertex labels +
 * a small summary.
 */
export async function runIosSeg(
	meshBytes: ArrayBuffer | Uint8Array,
	filename: string,
	opts?: { token?: string; includeGeometry?: boolean }
): Promise<IosSegResult> {
	const bytes = meshBytes instanceof Uint8Array ? meshBytes : new Uint8Array(meshBytes);
	const token = opts?.token ?? (await authenticate());
	const base = vendorBase();

	const form = new FormData();
	form.set('input_file', new Blob([bytes as Uint8Array<ArrayBuffer>]), filename);

	const res = await fetch(`${base}/api/ai/ios_seg_inference`, {
		method: 'POST',
		headers: { Authorization: token },
		body: form
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(
			`Vendor IOS inference failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`
		);
	}

	let glb = new Uint8Array(await res.arrayBuffer());
	// Rarely the vendor wraps the GLB in a zip ('PK' magic) — unzip and take .glb.
	if (glb.length >= 2 && glb[0] === 0x50 && glb[1] === 0x4b) {
		const files = unzipSync(glb);
		const glbName = Object.keys(files).find((n) => n.toLowerCase().endsWith('.glb'));
		if (!glbName) {
			throw new Error(`Vendor zip missing .glb entry (entries: ${Object.keys(files).join(', ')})`);
		}
		glb = files[glbName];
	}

	if (opts?.includeGeometry) {
		const g = decodeIosGlbGeometry(glb);
		const result = summarize(g.perVertexLabel, g.vertexCount);
		result.positions = g.positions;
		result.index = g.index;
		return result;
	}
	const { perVertexLabel, vertexCount } = decodeIosGlb(glb);
	return summarize(perVertexLabel, vertexCount);
}

/** Derive the summary fields from per-vertex labels. */
function summarize(perVertexLabel: Int16Array, vertexCount: number): IosSegResult {
	const present = new Set<number>();
	let gingivaCount = 0;
	for (let i = 0; i < perVertexLabel.length; i++) {
		const l = perVertexLabel[i];
		if (l === 0) gingivaCount++;
		if (l >= 0) present.add(l);
	}
	const presentLabels = [...present].sort((a, b) => a - b);
	const presentFdis = presentLabels
		.map(labelToFdi)
		.filter((f): f is string => f != null)
		.sort((a, b) => Number(a) - Number(b));

	let perVertexFdi: (string | null)[] | null = null;
	if (vertexCount <= PER_VERTEX_FDI_MAX) {
		perVertexFdi = new Array(vertexCount);
		for (let i = 0; i < vertexCount; i++) perVertexFdi[i] = labelToFdi(perVertexLabel[i]);
	}

	return { perVertexLabel, perVertexFdi, vertexCount, presentLabels, presentFdis, gingivaCount };
}
