// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Bite splint" indication (IFU 2.2 / Bitesplint Design station): an
// occlusal appliance shelled over the teeth. Extracts the segmented teeth
// surface and thickens it into a solid splint via the server offset primitive.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_SPLINT, t } from "../keys";
import { getSegResult } from "../segStore";
import { extractTeethSurface } from "../mesh/subMesh";
import { computeVertexNormals } from "../mesh/meshIo";

function blobOf(a: ArrayBufferView): Blob {
    return new Blob([new Uint8Array(a.buffer, a.byteOffset, a.byteLength)]);
}

@command({
    key: CMD_SPLINT,
    icon: "icon-thickSolid",
})
export class DentalBiteSplintCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const seg = getSegResult();
        if (!seg) {
            PubSub.default.pub("showToast", t("toast.dental.notagged"));
            return;
        }
        const teeth = extractTeethSurface(seg.positions, seg.index, seg.labels);
        if (teeth.length < 9 * 200) {
            PubSub.default.pub("showToast", t("toast.dental.notagged"));
            return;
        }

        PubSub.default.pub("showToast", t("toast.dental.splintworking"));
        try {
            const form = new FormData();
            form.append("positions", blobOf(teeth));
            form.append("halfThickness", "0.8");
            form.append("voxel", "0.3");
            const res = await fetch("/api/cad/offset", { method: "POST", body: form });
            if (!res.ok) {
                const b = (await res.json().catch(() => null)) as { message?: string } | null;
                PubSub.default.pub("showToast", t("toast.dental.failed"), b?.message ?? `HTTP ${res.status}`);
                return;
            }
            const soup = new Float32Array(await res.arrayBuffer());
            const triangles = Number(res.headers.get("X-Triangles") ?? soup.length / 9);

            const mesh = new Mesh();
            mesh.meshType = "surface";
            mesh.position = soup;
            mesh.normal = computeVertexNormals(soup);
            mesh.color = 0x9fd3e6; // clear-appliance blue

            Transaction.execute(document, "bite splint", () => {
                document.addNode(new MeshNode(document, mesh, "Bite splint"));
            });
            document.visual.update();
            PubSub.default.pub("showToast", t("toast.dental.splintdone"), String(triangles));
            Logger.info(`[dental] bite splint: ${triangles} triangles`);
        } catch (err) {
            PubSub.default.pub("showToast", t("toast.dental.failed"), String(err));
            Logger.error(`[dental] bite splint failed: ${String(err)}`);
        }
    }
}
