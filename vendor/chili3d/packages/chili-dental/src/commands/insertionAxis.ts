// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Insertion axis" station. Shows the insertion/withdrawal axis of the
// selected tooth — the occlusal direction (gingiva→teeth) through the tooth
// centroid — as a line overlay. Select a tooth first.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_AXIS, t } from "../keys";
import { getSegResult, getSelectedFdi } from "../segStore";
import { labelForFdi } from "../fdiArch";
import { toothCentroidAndAxis } from "../mesh/marginCurve";

@command({
    key: CMD_AXIS,
    icon: "icon-line",
})
export class DentalInsertionAxisCommand implements ICommand {
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
        const { centroid, axis } = toothCentroidAndAxis(seg.positions, seg.labels, labelForFdi(fdi));

        // line from just below the cervical region to above the occlusal surface
        const below = 5;
        const above = 11;
        const p0 = [centroid[0] - axis[0] * below, centroid[1] - axis[1] * below, centroid[2] - axis[2] * below];
        const p1 = [centroid[0] + axis[0] * above, centroid[1] + axis[1] * above, centroid[2] + axis[2] * above];

        const line = new Mesh();
        line.meshType = "linesegments";
        line.position = new Float32Array([p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]]);
        line.color = 0xff3bd0; // insertion-axis magenta

        Transaction.execute(document, "insertion axis", () => {
            document.addNode(new MeshNode(document, line, `Insertion axis ${fdi}`));
        });
        document.visual.update();
        PubSub.default.pub("showToast", t("toast.dental.axisdone"), String(fdi));
        Logger.info(`[dental] insertion axis FDI ${fdi}`);
    }
}
