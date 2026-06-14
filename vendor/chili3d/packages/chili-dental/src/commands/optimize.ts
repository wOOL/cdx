// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Mesh optimization" station (IFU 5.2/5.3): clean the imported scan —
// remove disconnected artifacts (keep the largest part) and repair holes —
// before tagging/design. Reuses the host server-side mesh editor
// (/api/cad/mesh-edit) so the heavy geometry runs off the render thread.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_OPTIMIZE, t } from "../keys";
import { findScanMeshNode } from "../mesh/nodes";
import { computeVertexNormals } from "../mesh/meshIo";
import { invalidatePickCache } from "../mesh/picking";

function blobOf(a: ArrayBufferView): Blob {
    return new Blob([new Uint8Array(a.buffer, a.byteOffset, a.byteLength)]);
}

@command({
    key: CMD_OPTIMIZE,
    icon: "icon-act",
})
export class DentalOptimizeCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const scan = findScanMeshNode(document.rootNode);
        if (!scan || !scan.mesh.position) {
            PubSub.default.pub("showToast", t("toast.dental.noscan"));
            return;
        }

        PubSub.default.pub("showToast", t("toast.dental.optimizing"));
        try {
            const form = new FormData();
            form.append("positions", blobOf(scan.mesh.position));
            if (scan.mesh.index) form.append("index", blobOf(scan.mesh.index));
            form.append(
                "ops",
                JSON.stringify([
                    { op: "parts", action: "keepLargest" },
                    { op: "fillHoles", exceptLargest: true },
                ]),
            );
            const res = await fetch("/api/cad/mesh-edit", { method: "POST", body: form });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null;
                PubSub.default.pub("showToast", t("toast.dental.failed"), body?.message ?? `HTTP ${res.status}`);
                return;
            }
            const soup = new Float32Array(await res.arrayBuffer());
            const triangles = Number(res.headers.get("X-Triangles-After") ?? soup.length / 9);

            const cleaned = new Mesh();
            cleaned.meshType = "surface";
            cleaned.position = soup;
            cleaned.normal = computeVertexNormals(soup);

            Transaction.execute(document, "optimize mesh", () => {
                scan.mesh = cleaned;
            });
            invalidatePickCache(scan);
            document.visual.update();
            PubSub.default.pub("showToast", t("toast.dental.optimized"), String(triangles));
            Logger.info(`[dental] optimize mesh -> ${triangles} triangles`);
        } catch (err) {
            PubSub.default.pub("showToast", t("toast.dental.failed"), String(err));
            Logger.error(`[dental] optimize failed: ${String(err)}`);
        }
    }
}
