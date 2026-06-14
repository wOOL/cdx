// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// Small mesh helpers shared by the dental stations: serialise a MeshNode's
// geometry to binary STL (to send to a server-side geometry service), decode
// base64 typed arrays returned by those services, and compute vertex normals.

/** Build a binary STL (ArrayBuffer) from indexed/soup triangle positions. */
export function buildBinaryStl(position: Float32Array, index?: Uint32Array): ArrayBuffer {
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(position.length / 9);
    const buf = new ArrayBuffer(84 + triCount * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, triCount, true);
    let o = 84;
    for (let t = 0; t < triCount; t++) {
        const i0 = index ? index[t * 3] : t * 3;
        const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
        const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
        // Facet normal left zero; the consumer recomputes from the vertices.
        dv.setFloat32(o, 0, true); dv.setFloat32(o + 4, 0, true); dv.setFloat32(o + 8, 0, true);
        o += 12;
        for (const vi of [i0, i1, i2]) {
            dv.setFloat32(o, position[vi * 3], true);
            dv.setFloat32(o + 4, position[vi * 3 + 1], true);
            dv.setFloat32(o + 8, position[vi * 3 + 2], true);
            o += 12;
        }
        dv.setUint16(o, 0, true);
        o += 2;
    }
    return buf;
}

/** Decode a base64 string to a Uint8Array (browser). */
export function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Per-vertex smooth normals from triangle geometry. */
export function computeVertexNormals(position: Float32Array, index?: Uint32Array): Float32Array {
    const n = new Float32Array(position.length);
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(position.length / 9);
    for (let t = 0; t < triCount; t++) {
        const a = index ? index[t * 3] : t * 3;
        const b = index ? index[t * 3 + 1] : t * 3 + 1;
        const c = index ? index[t * 3 + 2] : t * 3 + 2;
        const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2];
        const ux = position[b * 3] - ax, uy = position[b * 3 + 1] - ay, uz = position[b * 3 + 2] - az;
        const vx = position[c * 3] - ax, vy = position[c * 3 + 1] - ay, vz = position[c * 3 + 2] - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const vi of [a, b, c]) {
            n[vi * 3] += nx; n[vi * 3 + 1] += ny; n[vi * 3 + 2] += nz;
        }
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
        n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return n;
}
