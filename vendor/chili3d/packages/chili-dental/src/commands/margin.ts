// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Margin / emergence line" station. Traces the margin of the selected
// tooth directly on the scanned surface from the segmentation boundary
// (curve-on-mesh) and draws it as a line overlay. Select a tooth first
// (Select Tooth station).

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_MARGIN, t } from "../keys";
import { getSegResult, getSelectedFdi } from "../segStore";
import { labelForFdi } from "../fdiArch";
import { extractMarginSegments } from "../mesh/marginCurve";

@command({
    key: CMD_MARGIN,
    icon: "icon-circle",
})
export class DentalMarginCommand implements ICommand {
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
        const toothLabel = labelForFdi(fdi);
        const segments = extractMarginSegments(seg.positions, seg.index, seg.labels, toothLabel);
        if (segments.length === 0) {
            PubSub.default.pub("showToast", t("toast.dental.nomargin"), String(fdi));
            return;
        }

        const line = new Mesh();
        line.meshType = "linesegments";
        line.position = segments;
        line.color = 0x35ff7a; // emergence-line green

        Transaction.execute(document, "margin line", () => {
            document.addNode(new MeshNode(document, line, `Margin ${fdi}`));
        });
        document.visual.update();
        PubSub.default.pub("showToast", t("toast.dental.margindone"), String(fdi));
        Logger.info(`[dental] margin line FDI ${fdi}: ${segments.length / 6} segments`);
    }
}
