// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS interactive margin definition (IFU 5.1: "place green dots on the
// preparation line"). Click points along the margin on the scan surface (BVH
// picking); a live polyline previews the curve and closes into the emergence
// line on Esc / right click. Complements the automatic Margin Line station.

import {
    AsyncController,
    command,
    IApplication,
    ICommand,
    IDocument,
    IEventHandler,
    IView,
    Logger,
    Mesh,
    MeshNode,
    PubSub,
    Transaction,
} from "chili-core";
import { CMD_EDITMARGIN, t } from "../keys";
import { findScanMeshNode } from "../mesh/nodes";
import { pickPointOnMesh } from "../mesh/picking";

type V3 = [number, number, number];

class EditMarginHandler implements IEventHandler {
    isEnabled = true;
    private readonly points: V3[] = [];
    private node?: MeshNode;

    constructor(
        private readonly scan: MeshNode,
        private readonly controller: AsyncController,
        private readonly document: IDocument,
    ) {}

    pointerMove(): void {}
    pointerUp(): void {}
    keyDown(_view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") this.finish();
    }
    dispose(): void {}

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button === 2) {
            this.finish();
            return;
        }
        if (event.button !== 0) return;
        event.preventDefault();
        const hit = pickPointOnMesh(view, this.scan, event.offsetX, event.offsetY);
        if (!hit) return;
        this.points.push([hit.point.x, hit.point.y, hit.point.z]);
        this.render(false, 0xffcc33);
    }

    private polyline(closed: boolean): Float32Array {
        const segs: number[] = [];
        const n = this.points.length;
        const last = closed ? n : n - 1;
        for (let i = 0; i < last; i++) {
            const a = this.points[i];
            const b = this.points[(i + 1) % n];
            segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
        return new Float32Array(segs);
    }

    private render(closed: boolean, color: number): void {
        if (this.points.length < 2) return;
        const mesh = new Mesh();
        mesh.meshType = "linesegments";
        mesh.position = this.polyline(closed);
        mesh.color = color;
        Transaction.execute(this.document, "margin edit", () => {
            if (!this.node) {
                this.node = new MeshNode(this.document, mesh, "Margin (manual)");
                this.document.addNode(this.node);
            } else {
                this.node.mesh = mesh;
            }
        });
        this.document.visual.update();
    }

    private finish(): void {
        if (this.points.length >= 3) this.render(true, 0x35ff7a);
        Logger.info(`[dental] edit margin: ${this.points.length} points`);
        this.controller.success();
    }
}

@command({
    key: CMD_EDITMARGIN,
    icon: "icon-bezier",
})
export class DentalEditMarginCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const scan = findScanMeshNode(document.rootNode);
        if (!scan) {
            PubSub.default.pub("showToast", t("toast.dental.noscan"));
            return;
        }
        const controller = new AsyncController();
        const previous = document.visual.eventHandler;
        document.visual.eventHandler = new EditMarginHandler(scan, controller, document);
        PubSub.default.pub("statusBarTip", t("prompt.dental.editmargin"));
        try {
            await new Promise<void>((resolve, reject) => {
                controller.onCompleted(() => resolve());
                controller.onCancelled(() => reject());
            });
        } catch {
            // cancelled
        } finally {
            PubSub.default.pub("clearStatusBarTip");
            document.visual.eventHandler = previous;
        }
    }
}
