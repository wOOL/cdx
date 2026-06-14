// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// Extract the surface of one segmentation region (a tooth) as a triangle soup,
// for offsetting into a coping / shell or for per-tooth design steps.

/** Soup of triangles whose 3 vertices all satisfy `keep(label)`. */
function extractWhere(
    positions: Float32Array,
    index: Uint32Array | undefined,
    labels: Int16Array,
    keep: (label: number) => boolean,
): Float32Array {
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
    const out: number[] = [];
    for (let t = 0; t < triCount; t++) {
        const a = index ? index[t * 3] : t * 3;
        const b = index ? index[t * 3 + 1] : t * 3 + 1;
        const c = index ? index[t * 3 + 2] : t * 3 + 2;
        if (keep(labels[a]) && keep(labels[b]) && keep(labels[c])) {
            for (const vi of [a, b, c]) {
                out.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
            }
        }
    }
    return new Float32Array(out);
}

/** Soup of one tooth's surface (all three vertices carry `toothLabel`). */
export function extractLabelSurface(
    positions: Float32Array,
    index: Uint32Array | undefined,
    labels: Int16Array,
    toothLabel: number,
): Float32Array {
    return extractWhere(positions, index, labels, (l) => l === toothLabel);
}

/** Soup of all teeth (any tooth label > 0), excluding gingiva (0)/unmatched (-1). */
export function extractTeethSurface(
    positions: Float32Array,
    index: Uint32Array | undefined,
    labels: Int16Array,
): Float32Array {
    return extractWhere(positions, index, labels, (l) => l > 0);
}
