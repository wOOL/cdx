// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "coping" substructure (IFU 2.2 crowns & copings): shell the selected
// tooth's scanned surface into a thin solid coping via the server-side mesh
// offset (/api/cad/offset → voxel thicken). Demonstrates the robust offset
// primitive that the crown intrados, splints and models also build on.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_COPING, t } from "../keys";
import { getSegResult, getSelectedFdi } from "../segStore";
import { labelForFdi } from "../fdiArch";
import { extractLabelSurface } from "../mesh/subMesh";
import { computeVertexNormals } from "../mesh/meshIo";

function blobOf(a: ArrayBufferView): Blob {
    return new Blob([new Uint8Array(a.buffer, a.byteOffset, a.byteLength)]);
}

@command({
    key: CMD_COPING,
    icon: "icon-thickSolid",
})
export class DentalCopingCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const seg = getSegResult();
        if (!seg) {
            PubSub.default.pub("showToast", t("toast.dental.notagged"));
            return;
        }
        const fdi = getSelectedFdi();
        if (!fdi) {
            PubSub.default.pub("showToast", t("toast.dental.noselection"));
            return;
        }
        const surface = extractLabelSurface(seg.positions, seg.index, seg.labels, labelForFdi(fdi));
        if (surface.length < 9 * 50) {
            PubSub.default.pub("showToast", t("toast.dental.copingthin"), String(fdi));
            return;
        }

        PubSub.default.pub("showToast", t("toast.dental.copingworking"), String(fdi));
        try {
            const form = new FormData();
            form.append("positions", blobOf(surface));
            form.append("halfThickness", "0.35");
            form.append("voxel", "0.16");
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
            mesh.color = 0xc9a86a; // gold coping

            Transaction.execute(document, "generate coping", () => {
                document.addNode(new MeshNode(document, mesh, `Coping ${fdi}`));
            });
            document.visual.update();
            PubSub.default.pub("showToast", t("toast.dental.copingdone"), String(fdi));
            Logger.info(`[dental] coping FDI ${fdi}: ${triangles} triangles`);
        } catch (err) {
            PubSub.default.pub("showToast", t("toast.dental.failed"), String(err));
            Logger.error(`[dental] coping failed: ${String(err)}`);
        }
    }
}
