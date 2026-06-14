// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS shaping tools "Add material" / "Remove material" (IFU 5.1 CAD station):
// an interactive wax-knife brush. Each left click picks a point on a design
// surface (BVH) and applies a local smooth+offset there (server-side wax-knife
// via /api/cad/mesh-edit), rebuilding the node. Stays active for repeated dabs
// until Esc or right click. Long-run note: this is the manual shaping path; it
// composes with the automatic anatomy proposal.

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
    XYZ,
} from "chili-core";
import { CMD_ADDMAT, CMD_REMMAT, t } from "../keys";
import { collectMeshNodes } from "../mesh/nodes";
import { computeVertexNormals } from "../mesh/meshIo";
import { invalidatePickCache, pickAnyMesh } from "../mesh/picking";

const BRUSH_RADIUS_MM = 1.2;
const DESIGN_IVORY = 0xede0c2;

function blobOf(a: ArrayBufferView): Blob {
    return new Blob([new Uint8Array(a.buffer, a.byteOffset, a.byteLength)]);
}

/** Persistent brush handler — one wax-knife dab per left click. */
class SculptHandler implements IEventHandler {
    isEnabled = true;
    private busy = false;

    constructor(
        private readonly nodes: MeshNode[],
        private readonly mode: "add" | "flatten",
        private readonly controller: AsyncController,
        private readonly document: IDocument,
    ) {}

    pointerMove(): void {}
    pointerUp(): void {}
    keyDown(_view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") this.controller.cancel();
    }
    dispose(): void {}

    pointerDown(view: IView, event: PointerEvent): void {
        if (event.button === 2) {
            this.controller.cancel();
            return;
        }
        if (event.button !== 0 || this.busy) return;
        event.preventDefault();
        const hit = pickAnyMesh(view, this.nodes, event.offsetX, event.offsetY);
        if (!hit) return;
        this.busy = true;
        void this.dab(hit.node, hit.point).finally(() => {
            this.busy = false;
        });
    }

    private async dab(node: MeshNode, point: XYZ): Promise<void> {
        if (!node.mesh.position) return;
        const form = new FormData();
        form.append("positions", blobOf(node.mesh.position));
        if (node.mesh.index) form.append("index", blobOf(node.mesh.index));
        form.append(
            "ops",
            JSON.stringify([
                {
                    op: "smooth",
                    mode: this.mode,
                    center: { x: point.x, y: point.y, z: point.z },
                    radius: BRUSH_RADIUS_MM,
                    strength: "B",
                },
            ]),
        );
        const res = await fetch("/api/cad/mesh-edit", { method: "POST", body: form });
        if (!res.ok) return;
        const soup = new Float32Array(await res.arrayBuffer());

        const m = new Mesh();
        m.meshType = "surface";
        m.position = soup;
        m.normal = computeVertexNormals(soup);
        m.color = typeof node.mesh.color === "number" ? node.mesh.color : DESIGN_IVORY;

        Transaction.execute(this.document, "sculpt", () => {
            node.mesh = m;
        });
        invalidatePickCache(node);
        this.document.visual.update();
    }
}

async function runSculpt(application: IApplication, mode: "add" | "flatten", promptKey: string): Promise<void> {
    const document = application.activeView?.document;
    if (!document) return;
    const nodes = collectMeshNodes(document.rootNode).filter(
        (n) => n.visible && n.mesh.meshType === "surface" && n.mesh.position,
    );
    if (nodes.length === 0) {
        PubSub.default.pub("showToast", t("toast.dental.noscan"));
        return;
    }
    const controller = new AsyncController();
    const previous = document.visual.eventHandler;
    document.visual.eventHandler = new SculptHandler(nodes, mode, controller, document);
    PubSub.default.pub("statusBarTip", t(promptKey));
    try {
        await new Promise<void>((resolve, reject) => {
            controller.onCompleted(() => resolve());
            controller.onCancelled(() => reject());
        });
    } catch {
        // ended via Esc / right click
    } finally {
        PubSub.default.pub("clearStatusBarTip");
        document.visual.eventHandler = previous;
        Logger.info(`[dental] sculpt (${mode}) ended`);
    }
}

@command({ key: CMD_ADDMAT, icon: "icon-addBrush" })
export class DentalAddMaterialCommand implements ICommand {
    execute(application: IApplication): Promise<void> {
        return runSculpt(application, "add", "prompt.dental.addmat");
    }
}

@command({ key: CMD_REMMAT, icon: "icon-clearBrush" })
export class DentalRemoveMaterialCommand implements ICommand {
    execute(application: IApplication): Promise<void> {
        return runSculpt(application, "flatten", "prompt.dental.remmat");
    }
}
