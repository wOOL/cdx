// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// Extract the surface of one segmentation region (a tooth) as a triangle soup,
// for offsetting into a coping / shell or for per-tooth design steps.

/** Soup of triangles whose 3 vertices all carry `toothLabel`. */
export function extractLabelSurface(
    positions: Float32Array,
    index: Uint32Array | undefined,
    labels: Int16Array,
    toothLabel: number,
): Float32Array {
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
    const out: number[] = [];
    for (let t = 0; t < triCount; t++) {
        const a = index ? index[t * 3] : t * 3;
        const b = index ? index[t * 3 + 1] : t * 3 + 1;
        const c = index ? index[t * 3 + 2] : t * 3 + 2;
        if (labels[a] === toothLabel && labels[b] === toothLabel && labels[c] === toothLabel) {
            for (const vi of [a, b, c]) {
                out.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
            }
        }
    }
    return new Float32Array(out);
}
