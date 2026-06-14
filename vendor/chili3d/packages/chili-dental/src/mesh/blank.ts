// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// Milling-blank (disc) outline geometry for the nesting station: a wireframe
// cylinder (top + bottom rim circles + vertical struts) drawn around the design
// so the blank boundary is visible without occluding the restoration.

type V3 = [number, number, number];

/**
 * Line-segment endpoints (flat xyz pairs) for a z-aligned cylinder outline.
 * @param center disc centre (world)
 * @param radius disc radius (mm)
 * @param halfHeight half the disc thickness (mm)
 * @param segments circle tessellation (struts every segments/8)
 */
export function cylinderOutline(center: V3, radius: number, halfHeight: number, segments = 96): Float32Array {
    const out: number[] = [];
    const ring = (z: number) => {
        for (let i = 0; i < segments; i++) {
            const a0 = (i / segments) * Math.PI * 2;
            const a1 = ((i + 1) / segments) * Math.PI * 2;
            out.push(
                center[0] + radius * Math.cos(a0), center[1] + radius * Math.sin(a0), z,
                center[0] + radius * Math.cos(a1), center[1] + radius * Math.sin(a1), z,
            );
        }
    };
    const top = center[2] + halfHeight;
    const bottom = center[2] - halfHeight;
    ring(top);
    ring(bottom);
    const struts = 8;
    for (let i = 0; i < struts; i++) {
        const a = (i / struts) * Math.PI * 2;
        const x = center[0] + radius * Math.cos(a);
        const y = center[1] + radius * Math.sin(a);
        out.push(x, y, bottom, x, y, top);
    }
    return new Float32Array(out);
}

/** Axis-aligned bounding box of a position buffer. */
export function bbox(positions: Float32Array): { min: V3; max: V3; center: V3; size: V3 } {
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    return {
        min: [minx, miny, minz],
        max: [maxx, maxy, maxz],
        center: [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2],
        size: [maxx - minx, maxy - miny, maxz - minz],
    };
}
