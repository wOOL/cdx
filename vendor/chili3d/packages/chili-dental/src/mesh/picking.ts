// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// Per-triangle mesh picking. Chili3D's snap/selection pipeline resolves BREP
// sub-shapes only — it never hits a MeshNode's triangles — so the dental layer
// does its own accelerated raycast: a BVH (three-mesh-bvh) is built from the
// node's own position/index buffers and intersected with the world ray from a
// screen click (view.rayAt). The hit triangle is mapped to an FDI tooth number
// via the node's segmentation region tags. Assumes the node is untransformed
// (true for imported scans and generated design bodies).

import { IView, MeshNode, XYZ } from "chili-core";
import { BufferAttribute, BufferGeometry, DoubleSide, Ray as ThreeRay, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { labelToFdi } from "../fdiArch";
import { getNodeRegions } from "../segStore";

const bvhCache = new WeakMap<MeshNode, MeshBVH>();

/** Lazily build (and cache) a BVH over a MeshNode's triangle buffers. */
function bvhFor(node: MeshNode): MeshBVH | undefined {
    if (!node.mesh.position) return undefined;
    let bvh = bvhCache.get(node);
    if (!bvh) {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(node.mesh.position, 3));
        if (node.mesh.index) geometry.setIndex(new BufferAttribute(node.mesh.index, 1));
        bvh = new MeshBVH(geometry);
        bvhCache.set(node, bvh);
    }
    return bvh;
}

export interface MeshHit {
    point: XYZ;
    triangleIndex: number;
    a: number;
    b: number;
    c: number;
}

/** Raycast a screen click (mx,my) against a MeshNode via its BVH. */
export function pickPointOnMesh(view: IView, node: MeshNode, mx: number, my: number): MeshHit | undefined {
    const bvh = bvhFor(node);
    if (!bvh) return undefined;
    const ray = view.rayAt(mx, my);
    const tr = new ThreeRay(
        new Vector3(ray.location.x, ray.location.y, ray.location.z),
        new Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize(),
    );
    const hit = bvh.raycastFirst(tr, DoubleSide);
    if (!hit || !hit.face) return undefined;
    return {
        point: new XYZ(hit.point.x, hit.point.y, hit.point.z),
        triangleIndex: hit.faceIndex ?? -1,
        a: hit.face.a,
        b: hit.face.b,
        c: hit.face.c,
    };
}

/** Drop the cached BVH for a node (call if its geometry is replaced). */
export function invalidatePickCache(node: MeshNode): void {
    bvhCache.delete(node);
}

export interface NodeHit extends MeshHit {
    node: MeshNode;
    distance: number;
}

/** Raycast a click against several MeshNodes; return the nearest hit (or none). */
export function pickAnyMesh(view: IView, nodes: MeshNode[], mx: number, my: number): NodeHit | undefined {
    const ray = view.rayAt(mx, my);
    const tr = new ThreeRay(
        new Vector3(ray.location.x, ray.location.y, ray.location.z),
        new Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize(),
    );
    let best: NodeHit | undefined;
    for (const node of nodes) {
        const bvh = bvhFor(node);
        if (!bvh) continue;
        const hit = bvh.raycastFirst(tr, DoubleSide);
        if (hit && hit.face && (best === undefined || hit.distance < best.distance)) {
            best = {
                node,
                point: new XYZ(hit.point.x, hit.point.y, hit.point.z),
                triangleIndex: hit.faceIndex ?? -1,
                a: hit.face.a,
                b: hit.face.b,
                c: hit.face.c,
                distance: hit.distance,
            };
        }
    }
    return best;
}

/** FDI tooth number at a hit triangle, from the node's segmentation region tags. */
export function fdiAtHit(node: MeshNode, hit: MeshHit): number {
    const labels = getNodeRegions(node);
    if (!labels) return 0;
    const counts = new Map<number, number>();
    for (const v of [hit.a, hit.b, hit.c]) {
        const fdi = labelToFdi(labels[v] ?? 0);
        if (fdi) counts.set(fdi, (counts.get(fdi) ?? 0) + 1);
    }
    let best = 0;
    let bestN = 0;
    for (const [fdi, n] of counts) {
        if (n > bestN) {
            best = fdi;
            bestN = n;
        }
    }
    return best;
}
