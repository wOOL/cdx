// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Tagging / assignment" station, interactive: click a tooth on the
// segmented scan to select it. Uses BVH per-triangle picking + the node's
// region tags to resolve the FDI number, and remembers it for downstream
// stations (margin, …). Follows the engine's temporary-event-handler pattern
// (install handler → await an AsyncController → restore), as in Selection.

import {
    AsyncController,
    command,
    IApplication,
    ICommand,
    IEventHandler,
    IView,
    Logger,
    MeshNode,
    PubSub,
    XYZ,
} from "chili-core";
import { CMD_SELECT, t } from "../keys";
import { findScanMeshNode } from "../mesh/nodes";
import { fdiAtHit, pickPointOnMesh } from "../mesh/picking";
import { setSelectedFdi } from "../segStore";

/** One-shot handler: the next left click picks a tooth, then completes. */
class PickToothHandler implements IEventHandler {
    isEnabled = true;

    constructor(
        private readonly node: MeshNode,
        private readonly controller: AsyncController,
        private readonly onPick: (fdi: number, point: XYZ) => void,
    ) {}

    pointerMove(): void {}

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        const hit = pickPointOnMesh(view, this.node, event.offsetX, event.offsetY);
        if (hit) this.onPick(fdiAtHit(this.node, hit), hit.point);
        this.controller.success();
    }

    pointerUp(): void {}

    keyDown(_view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") this.controller.cancel();
    }

    dispose(): void {}
}

@command({
    key: CMD_SELECT,
    icon: "icon-act",
})
export class DentalSelectToothCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const node = findScanMeshNode(document.rootNode);
        if (!node) {
            PubSub.default.pub("showToast", t("toast.dental.noscan"));
            return;
        }

        const controller = new AsyncController();
        const previous = document.visual.eventHandler;
        const handler = new PickToothHandler(node, controller, (fdi) => {
            setSelectedFdi(fdi);
            if (fdi) PubSub.default.pub("showToast", t("toast.dental.selected"), String(fdi));
            else PubSub.default.pub("showToast", t("toast.dental.selectedgingiva"));
            Logger.info(`[dental] selected FDI ${fdi}`);
        });

        document.visual.eventHandler = handler;
        PubSub.default.pub("statusBarTip", t("prompt.dental.clicktooth"));
        try {
            await new Promise<void>((resolve, reject) => {
                controller.onCompleted(() => resolve());
                controller.onCancelled(() => reject());
            });
        } catch {
            // cancelled — fall through to cleanup
        } finally {
            PubSub.default.pub("clearStatusBarTip");
            document.visual.eventHandler = previous;
        }
    }
}
