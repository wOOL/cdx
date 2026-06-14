// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Nesting" station (IFU 5.1/5.2): position the finished restoration inside
// a milling blank/disc. This first version draws a standard disc (Ø98 × 16 mm)
// around the design and reports whether it fits; multi-part packing and sprues
// are a later deepening.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_NEST, t } from "../keys";
import { collectMeshNodes } from "../mesh/nodes";
import { bbox, cylinderOutline } from "../mesh/blank";

const DISC_RADIUS = 49; // Ø98 mm
const DISC_HALF_H = 8; // 16 mm thick

@command({
    key: CMD_NEST,
    icon: "icon-cylinder",
})
export class DentalNestCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const designs = collectMeshNodes(document.rootNode).filter(
            (n) => n.visible && n.mesh.meshType === "surface" && n.mesh.position && /crown/i.test(n.name),
        );
        if (designs.length === 0) {
            PubSub.default.pub("showToast", t("toast.dental.nodesign"));
            return;
        }

        const min: [number, number, number] = [Infinity, Infinity, Infinity];
        const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        for (const d of designs) {
            const b = bbox(d.mesh.position!);
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], b.min[k]);
                max[k] = Math.max(max[k], b.max[k]);
            }
        }
        const center: [number, number, number] = [
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2,
        ];
        const radialExtent = Math.hypot(max[0] - min[0], max[1] - min[1]) / 2;
        const heightExtent = max[2] - min[2];
        const fits = radialExtent < DISC_RADIUS && heightExtent < DISC_HALF_H * 2;

        const blank = new Mesh();
        blank.meshType = "linesegments";
        blank.position = cylinderOutline(center, DISC_RADIUS, DISC_HALF_H);
        blank.color = 0x66ccff;

        Transaction.execute(document, "nest in blank", () => {
            document.addNode(new MeshNode(document, blank, "Milling blank (Ø98×16)"));
        });
        document.visual.update();
        PubSub.default.pub("showToast", fits ? t("toast.dental.nested") : t("toast.dental.nestexceeds"));
        Logger.info(`[dental] nest: ${designs.length} unit(s), Ø98×16 blank, fits=${fits}`);
    }
}
