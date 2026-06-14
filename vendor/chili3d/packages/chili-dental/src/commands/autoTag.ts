// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Assignment / tagging" station, automated: send the active surface scan
// to the vendor intraoral-scan tooth-segmentation model (server route
// /api/cad/ios-seg) and rebuild it as a per-tooth coloured mesh, with the
// detected FDI numbers and any edentulous gap reported to the user.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_AUTOTAG, t } from "../keys";
import { labelsToColorArray } from "../iosPalette";
import { b64ToBytes, buildBinaryStl, computeVertexNormals } from "../mesh/meshIo";
import { findScanMeshNode } from "../mesh/nodes";
import { setNodeRegions, setSegResult } from "../segStore";

interface IosSegResponse {
    vertexCount: number;
    presentFdis: string[];
    gingivaCount: number;
    labelsB64: string;
    positionsB64: string | null;
    indexB64: string | null;
}

@command({
    key: CMD_AUTOTAG,
    icon: "icon-act",
})
export class DentalAutoTagCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        const scan = findScanMeshNode(document.rootNode);
        if (!scan) {
            PubSub.default.pub("showToast", t("toast.dental.noscan"));
            return;
        }

        PubSub.default.pub("showToast", t("toast.dental.segmenting"));
        try {
            const stl = buildBinaryStl(scan.mesh.position!, scan.mesh.index);
            const form = new FormData();
            form.append("file", new Blob([stl]), "scan.stl");
            const res = await fetch("/api/cad/ios-seg", { method: "POST", body: form });
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null;
                PubSub.default.pub("showToast", t("toast.dental.failed"), body?.message ?? `HTTP ${res.status}`);
                return;
            }
            const data = (await res.json()) as IosSegResponse;
            if (!data.positionsB64) {
                PubSub.default.pub("showToast", t("toast.dental.failed"), "no geometry returned");
                return;
            }

            const positions = new Float32Array(b64ToBytes(data.positionsB64).buffer);
            const index = data.indexB64 ? new Uint32Array(b64ToBytes(data.indexB64).buffer) : undefined;
            const labels = new Int16Array(b64ToBytes(data.labelsB64).buffer);

            // hand the segmentation to downstream stations (crown proposal, …)
            setSegResult({ positions, index, labels, presentFdis: data.presentFdis.map(Number) });

            const tagged = new Mesh();
            tagged.meshType = "surface";
            tagged.position = positions;
            tagged.normal = computeVertexNormals(positions, index);
            tagged.index = index;
            tagged.color = labelsToColorArray(labels);

            let taggedNode: MeshNode | undefined;
            Transaction.execute(document, "auto-tag teeth", () => {
                taggedNode = new MeshNode(document, tagged, `${scan.name} — tagged`);
                document.addNode(taggedNode);
                scan.visible = false; // hide the un-tagged original
            });
            if (taggedNode) setNodeRegions(taggedNode, labels); // region tags for picking
            document.visual.update();
            application.activeView?.cameraController.fitContent();

            const fdis = data.presentFdis;
            PubSub.default.pub("showToast", t("toast.dental.tagged"), String(fdis.length), fdis.join(", ") || "—");
            Logger.info(
                `[dental] auto-tag: ${fdis.length} teeth [${fdis.join(",")}], ` +
                    `${data.vertexCount} verts, gingiva ${data.gingivaCount}`,
            );
        } catch (err) {
            PubSub.default.pub("showToast", t("toast.dental.failed"), String(err));
            Logger.error(`[dental] auto-tag failed: ${String(err)}`);
        }
    }
}
