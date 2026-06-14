// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// In-memory hand-off of the latest tooth-segmentation result from the
// auto-tag station to downstream stations (crown proposal, margin, …) so they
// don't have to re-run inference. Single active case at a time.

import type { MeshNode } from "chili-core";

export interface SegResult {
    positions: Float32Array; // xyz per vertex (segmented mesh)
    index?: Uint32Array;
    labels: Int16Array; // IOS label per vertex (0=gingiva, 1..38)
    presentFdis: number[];
}

let current: SegResult | undefined;

export function setSegResult(r: SegResult): void {
    current = r;
}

export function getSegResult(): SegResult | undefined {
    return current;
}

// Per-node region tags: the segmentation label per vertex, keyed by the tagged
// MeshNode whose buffers they align with. Used by picking to resolve which
// tooth (FDI) a clicked triangle belongs to.
const nodeRegions = new WeakMap<MeshNode, Int16Array>();

export function setNodeRegions(node: MeshNode, labels: Int16Array): void {
    nodeRegions.set(node, labels);
}

export function getNodeRegions(node: MeshNode): Int16Array | undefined {
    return nodeRegions.get(node);
}

// The tooth the user last selected (via the Select Tooth station), shared with
// downstream stations (margin, …). 0 = none.
let selectedFdi = 0;

export function setSelectedFdi(fdi: number): void {
    selectedFdi = fdi;
}

export function getSelectedFdi(): number {
    return selectedFdi;
}
