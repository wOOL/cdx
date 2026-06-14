// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// Curve-on-mesh helpers driven by the segmentation: the margin (emergence)
// line of a tooth is the boundary between that tooth's label region and the
// surrounding gingiva/teeth, traced directly on the scan surface
// (marching-squares on the per-vertex tooth/not-tooth field). The insertion
// axis is the occlusal direction (gingiva→teeth) through the tooth centroid.

type V3 = [number, number, number];

function vAt(p: Float32Array, i: number): V3 {
    return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
}
function mid(p: Float32Array, i: number, j: number): V3 {
    return [(p[i * 3] + p[j * 3]) / 2, (p[i * 3 + 1] + p[j * 3 + 1]) / 2, (p[i * 3 + 2] + p[j * 3 + 2]) / 2];
}

/**
 * Margin/emergence line of a tooth as flat line-segment endpoints (pairs of
 * xyz points). Each triangle straddling the tooth-label boundary contributes
 * one segment joining the midpoints of its two boundary-crossing edges, so the
 * result is a closed-ish loop riding the scanned surface.
 */
export function extractMarginSegments(
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
        const ta = labels[a] === toothLabel;
        const tb = labels[b] === toothLabel;
        const tc = labels[c] === toothLabel;
        const count = (ta ? 1 : 0) + (tb ? 1 : 0) + (tc ? 1 : 0);
        if (count === 0 || count === 3) continue; // not a boundary triangle
        const cross: V3[] = [];
        if (ta !== tb) cross.push(mid(positions, a, b));
        if (tb !== tc) cross.push(mid(positions, b, c));
        if (tc !== ta) cross.push(mid(positions, c, a));
        if (cross.length === 2) out.push(...cross[0], ...cross[1]);
    }
    return new Float32Array(out);
}

/** Tooth centroid + occlusal/insertion axis (unit, gingiva→teeth). */
export function toothCentroidAndAxis(
    positions: Float32Array,
    labels: Int16Array,
    toothLabel: number,
): { centroid: V3; axis: V3 } {
    let tx = 0, ty = 0, tz = 0, tn = 0; // this tooth
    let ax = 0, ay = 0, az = 0, an = 0; // all teeth
    let gx = 0, gy = 0, gz = 0, gn = 0; // gingiva
    for (let i = 0; i < labels.length; i++) {
        const L = labels[i];
        const [x, y, z] = vAt(positions, i);
        if (L === 0) { gx += x; gy += y; gz += z; gn++; continue; }
        ax += x; ay += y; az += z; an++;
        if (L === toothLabel) { tx += x; ty += y; tz += z; tn++; }
    }
    const centroid: V3 = tn ? [tx / tn, ty / tn, tz / tn] : [ax / an, ay / an, az / an];
    const teeth: V3 = [ax / (an || 1), ay / (an || 1), az / (an || 1)];
    const gingiva: V3 = [gx / (gn || 1), gy / (gn || 1), gz / (gn || 1)];
    let dx = teeth[0] - gingiva[0], dy = teeth[1] - gingiva[1], dz = teeth[2] - gingiva[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return { centroid, axis: [dx / l, dy / l, dz / l] };
}
