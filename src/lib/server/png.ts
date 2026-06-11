import { zlibSync } from 'fflate';

/**
 * Minimal PNG encoder for 8-bit grayscale images (color type 0, all rows
 * filter 0, zlib via fflate). Enough for import-preview thumbnails.
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** Encode a width×height 8-bit grayscale buffer (row-major) as a PNG. */
export function grayPng(width: number, height: number, gray: Uint8Array): Uint8Array {
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // color type: grayscale
	// scanlines, each prefixed with filter byte 0
	const raw = new Uint8Array((width + 1) * height);
	for (let y = 0; y < height; y++) {
		raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
	}
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlibSync(raw, { level: 6 })),
		chunk('IEND', new Uint8Array(0))
	];
	const png = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let off = 0;
	for (const p of parts) {
		png.set(p, off);
		off += p.length;
	}
	return png;
}
