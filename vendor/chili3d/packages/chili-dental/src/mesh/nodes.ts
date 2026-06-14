// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).

import { INode, INodeLinkedList, MeshNode } from "chili-core";

/** Depth-first collect every MeshNode under a root node. */
export function collectMeshNodes(root: INodeLinkedList | undefined): MeshNode[] {
    const out: MeshNode[] = [];
    const walk = (first: INode | undefined) => {
        for (let n = first; n !== undefined; n = n.nextSibling) {
            if (n instanceof MeshNode) out.push(n);
            const maybeList = n as Partial<INodeLinkedList>;
            if (maybeList.firstChild !== undefined) walk(maybeList.firstChild);
        }
    };
    walk(root?.firstChild);
    return out;
}

/** The most likely "scan" mesh: the visible surface MeshNode with the most vertices. */
export function findScanMeshNode(root: INodeLinkedList | undefined): MeshNode | undefined {
    return collectMeshNodes(root)
        .filter((n) => n.visible && n.mesh.meshType === "surface" && n.mesh.position)
        .sort((a, b) => (b.mesh.position!.length - a.mesh.position!.length))
        .at(0);
}
