// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "smart match" (IFU 5.1/5.3): rigidly align a secondary scan (antagonist
// / re-scan / die) onto the primary arch by ICP (server-side registration).
// The recovered transform is baked into the secondary's vertices so downstream
// picking/design keep working in a single world frame.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_MATCH, t } from "../keys";
import { collectMeshNodes } from "../mesh/nodes";
import { computeVertexNormals } from "../mesh/meshIo";
import { invalidatePickCache } from "../mesh/picking";

function blobOf(a: ArrayBufferView): Blob {
    return new Blob([new Uint8Array(a.buffer, a.byteOffset, a.byteLength)]);
}

/** Apply a column-major 4x4 transform to every vertex of a soup/indexed buffer. */
function bake(positions: Float32Array, m: number[]): Float32Array {
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    return out;
}

@command({
    key: CMD_MATCH,
    icon: "icon-act",
})
export class DentalMatchScanCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const scans = collectMeshNodes(document.rootNode)
            .filter((n) => n.visible && n.mesh.meshType === "surface" && n.mesh.position)
            .sort((a, b) => b.mesh.position!.length - a.mesh.position!.length);
        if (scans.length < 2) {
            PubSub.default.pub("showToast", t("toast.dental.needtwo"));
            return;
        }
        const target = scans[0]; // primary (largest)
        const source = scans[1]; // secondary to move

        PubSub.default.pub("showToast", t("toast.dental.matching"));
        try {
            const form = new FormData();
            form.append("source", blobOf(source.mesh.position!));
            form.append("target", blobOf(target.mesh.position!));
            const res = await fetch("/api/cad/align", { method: "POST", body: form });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null;
                PubSub.default.pub("showToast", t("toast.dental.failed"), body?.message ?? `HTTP ${res.status}`);
                return;
            }
            const data = (await res.json()) as { transform: number[]; rms: number; iterations: number };

            const baked = new Float32Array(bake(source.mesh.position!, data.transform));
            const aligned = new Mesh();
            aligned.meshType = "surface";
            aligned.position = baked;
            aligned.normal = computeVertexNormals(baked, source.mesh.index);
            aligned.index = source.mesh.index;
            aligned.color = source.mesh.color;

            Transaction.execute(document, "match scan", () => {
                source.mesh = aligned;
            });
            invalidatePickCache(source);
            document.visual.update();
            PubSub.default.pub("showToast", t("toast.dental.matched"), data.rms.toFixed(3));
            Logger.info(`[dental] match scan: rms ${data.rms.toFixed(4)} mm, ${data.iterations} iters`);
        } catch (err) {
            PubSub.default.pub("showToast", t("toast.dental.failed"), String(err));
            Logger.error(`[dental] match failed: ${String(err)}`);
        }
    }
}
