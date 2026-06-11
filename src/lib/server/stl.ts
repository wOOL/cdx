/**
 * Minimal STL (binary + ASCII) and PLY (ascii + binary_little_endian)
 * mesh IO. All meshes are triangle soups: a flat Float32Array of xyz
 * positions whose length is divisible by 9.
 */

const HEADER_BYTES = 80;
const TRI_BYTES = 50; // 12B normal + 3 * 12B vertices + 2B attribute

/**
 * Serialize a triangle soup to binary STL.
 * Face normals are computed from the vertex winding (right-hand rule),
 * zero for degenerate triangles. Attribute byte count is always 0.
 */
export function meshToStlBinary(positions: Float32Array, name = 'mesh'): Uint8Array {
	const triCount = Math.floor(positions.length / 9);
	const bytes = new Uint8Array(HEADER_BYTES + 4 + triCount * TRI_BYTES);
	const view = new DataView(bytes.buffer);

	// 80-byte header. Prefix so it never starts with "solid" (which would
	// look like ASCII STL to naive readers).
	const header = new TextEncoder().encode(`BINSTL ${name}`);
	bytes.set(header.subarray(0, HEADER_BYTES), 0);
	view.setUint32(HEADER_BYTES, triCount, true);

	let off = HEADER_BYTES + 4;
	for (let t = 0; t < triCount; t++) {
		const i = t * 9;
		const ax = positions[i];
		const ay = positions[i + 1];
		const az = positions[i + 2];
		const bx = positions[i + 3];
		const by = positions[i + 4];
		const bz = positions[i + 5];
		const cx = positions[i + 6];
		const cy = positions[i + 7];
		const cz = positions[i + 8];

		const ux = bx - ax;
		const uy = by - ay;
		const uz = bz - az;
		const vx = cx - ax;
		const vy = cy - ay;
		const vz = cz - az;
		let nx = uy * vz - uz * vy;
		let ny = uz * vx - ux * vz;
		let nz = ux * vy - uy * vx;
		const len = Math.hypot(nx, ny, nz);
		if (len > 1e-30) {
			nx /= len;
			ny /= len;
			nz /= len;
		} else {
			nx = 0;
			ny = 0;
			nz = 0;
		}

		view.setFloat32(off, nx, true);
		view.setFloat32(off + 4, ny, true);
		view.setFloat32(off + 8, nz, true);
		for (let v = 0; v < 9; v++) {
			view.setFloat32(off + 12 + v * 4, positions[i + v], true);
		}
		view.setUint16(off + 48, 0, true);
		off += TRI_BYTES;
	}
	return bytes;
}

function decodeAscii(bytes: Uint8Array): string {
	let s = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
	}
	return s;
}

function parseStlAscii(text: string): { positions: Float32Array } | null {
	const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
	const coords: number[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const x = Number(m[1]);
		const y = Number(m[2]);
		const z = Number(m[3]);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
		coords.push(x, y, z);
	}
	if (coords.length === 0 || coords.length % 9 !== 0) return null;
	return { positions: Float32Array.from(coords) };
}

function parseStlBinary(bytes: Uint8Array): { positions: Float32Array } | null {
	if (bytes.length < HEADER_BYTES + 4) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const triCount = view.getUint32(HEADER_BYTES, true);
	if (triCount === 0) return null;
	if (HEADER_BYTES + 4 + triCount * TRI_BYTES > bytes.length) return null;
	const positions = new Float32Array(triCount * 9);
	let off = HEADER_BYTES + 4;
	for (let t = 0; t < triCount; t++) {
		const o = t * 9;
		for (let v = 0; v < 9; v++) {
			positions[o + v] = view.getFloat32(off + 12 + v * 4, true);
		}
		off += TRI_BYTES;
	}
	return { positions };
}

/**
 * Parse an STL file (auto-detects ASCII vs binary).
 * Returns triangle soup positions, or null if the bytes are not an STL.
 */
export function parseStl(bytes: Uint8Array): { positions: Float32Array } | null {
	if (bytes.length < 15) return null;
	const head = decodeAscii(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
	if (head.toLowerCase().startsWith('solid')) {
		// Could still be a binary file whose header starts with "solid":
		// require an ASCII "facet" keyword to commit to ASCII parsing.
		const text = decodeAscii(bytes);
		if (/facet/i.test(text)) {
			const ascii = parseStlAscii(text);
			if (ascii) return ascii;
		}
	}
	return parseStlBinary(bytes);
}

type PlyScalarType =
	| 'char'
	| 'int8'
	| 'uchar'
	| 'uint8'
	| 'short'
	| 'int16'
	| 'ushort'
	| 'uint16'
	| 'int'
	| 'int32'
	| 'uint'
	| 'uint32'
	| 'float'
	| 'float32'
	| 'double'
	| 'float64';

const PLY_TYPE_SIZE: Record<string, number> = {
	char: 1,
	int8: 1,
	uchar: 1,
	uint8: 1,
	short: 2,
	int16: 2,
	ushort: 2,
	uint16: 2,
	int: 4,
	int32: 4,
	uint: 4,
	uint32: 4,
	float: 4,
	float32: 4,
	double: 8,
	float64: 8
};

interface PlyProperty {
	name: string;
	isList: boolean;
	countType?: PlyScalarType;
	valueType: PlyScalarType;
}

interface PlyElement {
	name: string;
	count: number;
	properties: PlyProperty[];
}

function readPlyScalar(view: DataView, off: number, type: PlyScalarType): number {
	switch (type) {
		case 'char':
		case 'int8':
			return view.getInt8(off);
		case 'uchar':
		case 'uint8':
			return view.getUint8(off);
		case 'short':
		case 'int16':
			return view.getInt16(off, true);
		case 'ushort':
		case 'uint16':
			return view.getUint16(off, true);
		case 'int':
		case 'int32':
			return view.getInt32(off, true);
		case 'uint':
		case 'uint32':
			return view.getUint32(off, true);
		case 'float':
		case 'float32':
			return view.getFloat32(off, true);
		case 'double':
		case 'float64':
			return view.getFloat64(off, true);
	}
}

/**
 * Parse a PLY file: ASCII or binary_little_endian, vertex element with
 * x/y/z float properties (other per-vertex properties are skipped), face
 * element with a vertex index list (fans triangulate quads and larger).
 * Returns triangle soup positions, or null if the bytes are not a PLY
 * this parser understands.
 */
export function parsePly(bytes: Uint8Array): { positions: Float32Array } | null {
	if (bytes.length < 16) return null;
	if (bytes[0] !== 0x70 || bytes[1] !== 0x6c || bytes[2] !== 0x79) return null; // 'ply'

	// The header is ASCII and ends with an "end_header" line.
	const probe = decodeAscii(bytes.subarray(0, Math.min(bytes.length, 65536)));
	const endTag = probe.indexOf('end_header');
	if (endTag < 0) return null;
	const endLine = probe.indexOf('\n', endTag);
	if (endLine < 0) return null;
	const dataStart = endLine + 1; // byte offset, header is single-byte chars

	const headerLines = probe
		.slice(0, endTag)
		.split('\n')
		.map((l) => l.replace(/\r$/, '').trim())
		.filter((l) => l.length > 0 && !l.startsWith('comment') && !l.startsWith('obj_info'));

	if (headerLines[0] !== 'ply') return null;

	let format: 'ascii' | 'binary_little_endian' | null = null;
	const elements: PlyElement[] = [];
	let current: PlyElement | null = null;

	for (let i = 1; i < headerLines.length; i++) {
		const tok = headerLines[i].split(/\s+/);
		if (tok[0] === 'format') {
			if (tok[1] === 'ascii') format = 'ascii';
			else if (tok[1] === 'binary_little_endian') format = 'binary_little_endian';
			else return null; // big endian etc. unsupported
		} else if (tok[0] === 'element') {
			const count = Number(tok[2]);
			if (!tok[1] || !Number.isInteger(count) || count < 0) return null;
			current = { name: tok[1], count, properties: [] };
			elements.push(current);
		} else if (tok[0] === 'property') {
			if (!current) return null;
			if (tok[1] === 'list') {
				if (!(tok[2] in PLY_TYPE_SIZE) || !(tok[3] in PLY_TYPE_SIZE) || !tok[4]) return null;
				current.properties.push({
					name: tok[4],
					isList: true,
					countType: tok[2] as PlyScalarType,
					valueType: tok[3] as PlyScalarType
				});
			} else {
				if (!(tok[1] in PLY_TYPE_SIZE) || !tok[2]) return null;
				current.properties.push({ name: tok[2], isList: false, valueType: tok[1] as PlyScalarType });
			}
		} else {
			return null; // unknown header line
		}
	}
	if (!format || elements.length === 0) return null;

	const vertElem = elements.find((e) => e.name === 'vertex');
	if (!vertElem) return null;
	const xi = vertElem.properties.findIndex((p) => p.name === 'x' && !p.isList);
	const yi = vertElem.properties.findIndex((p) => p.name === 'y' && !p.isList);
	const zi = vertElem.properties.findIndex((p) => p.name === 'z' && !p.isList);
	if (xi < 0 || yi < 0 || zi < 0) return null;

	const verts = new Float32Array(vertElem.count * 3);
	const faceIndices: number[][] = [];

	try {
		if (format === 'ascii') {
			const text = decodeAscii(bytes.subarray(dataStart));
			const tokens = text.split(/\s+/).filter((t) => t.length > 0);
			let ti = 0;
			const next = (): number => {
				if (ti >= tokens.length) throw new Error('eof');
				const n = Number(tokens[ti++]);
				if (!Number.isFinite(n)) throw new Error('nan');
				return n;
			};
			for (const elem of elements) {
				for (let item = 0; item < elem.count; item++) {
					for (let p = 0; p < elem.properties.length; p++) {
						const prop = elem.properties[p];
						if (prop.isList) {
							const n = next();
							const vals: number[] = [];
							for (let k = 0; k < n; k++) vals.push(next());
							if (
								elem.name === 'face' &&
								(prop.name === 'vertex_indices' || prop.name === 'vertex_index')
							) {
								faceIndices.push(vals);
							}
						} else {
							const v = next();
							if (elem === vertElem) {
								if (p === xi) verts[item * 3] = v;
								else if (p === yi) verts[item * 3 + 1] = v;
								else if (p === zi) verts[item * 3 + 2] = v;
							}
						}
					}
				}
			}
		} else {
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			let off = dataStart;
			for (const elem of elements) {
				for (let item = 0; item < elem.count; item++) {
					for (let p = 0; p < elem.properties.length; p++) {
						const prop = elem.properties[p];
						if (prop.isList) {
							const countType = prop.countType as PlyScalarType;
							const n = readPlyScalar(view, off, countType);
							off += PLY_TYPE_SIZE[countType];
							const valSize = PLY_TYPE_SIZE[prop.valueType];
							if (
								elem.name === 'face' &&
								(prop.name === 'vertex_indices' || prop.name === 'vertex_index')
							) {
								const vals: number[] = [];
								for (let k = 0; k < n; k++) {
									vals.push(readPlyScalar(view, off, prop.valueType));
									off += valSize;
								}
								faceIndices.push(vals);
							} else {
								off += n * valSize;
							}
						} else {
							if (elem === vertElem) {
								const v = readPlyScalar(view, off, prop.valueType);
								if (p === xi) verts[item * 3] = v;
								else if (p === yi) verts[item * 3 + 1] = v;
								else if (p === zi) verts[item * 3 + 2] = v;
							}
							off += PLY_TYPE_SIZE[prop.valueType];
						}
					}
				}
			}
		}
	} catch {
		return null;
	}

	// Expand indexed faces (fan triangulation) into a triangle soup.
	let triCount = 0;
	for (const f of faceIndices) {
		if (f.length >= 3) triCount += f.length - 2;
	}
	if (triCount === 0) return null;

	const positions = new Float32Array(triCount * 9);
	let o = 0;
	for (const f of faceIndices) {
		for (let k = 1; k + 1 < f.length; k++) {
			const tri = [f[0], f[k], f[k + 1]];
			for (const idx of tri) {
				if (!Number.isInteger(idx) || idx < 0 || idx * 3 + 2 >= verts.length) return null;
				positions[o++] = verts[idx * 3];
				positions[o++] = verts[idx * 3 + 1];
				positions[o++] = verts[idx * 3 + 2];
			}
		}
	}
	return { positions };
}
