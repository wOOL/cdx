// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.
//
// MODIFIED for embedding in coDiagnostiX Web (maintained fork):
// adds a same-origin postMessage bridge (setupCdxBridge) so the host
// application can load mesh files into the document and request an
// STL export of the design. This change is committed directly into the
// vendored fork (vendor/chili3d); it is no longer a separate patch.

import { AppBuilder } from "chili-builder";
import { IApplication, INode, INodeLinkedList, Logger, Mesh, MeshNode, Transaction, VisualNode } from "chili-core";
import { DentalModule } from "chili-dental";
import { Loading } from "./loading";

let loading = new Loading();
document.body.appendChild(loading);

/** Collect every VisualNode in the document tree (depth-first). */
function collectVisualNodes(root: INodeLinkedList | undefined): VisualNode[] {
    const out: VisualNode[] = [];
    const walk = (first: INode | undefined) => {
        for (let n = first; n !== undefined; n = n.nextSibling) {
            if (n instanceof VisualNode) out.push(n);
            const maybeList = n as Partial<INodeLinkedList>;
            if (maybeList.firstChild !== undefined) {
                walk(maybeList.firstChild);
            }
        }
    };
    walk(root?.firstChild);
    return out;
}

/**
 * Import a binary STL as a display MeshNode. OCCT's StlAPI_Reader (used by the
 * regular STL import) sews one face per triangle and hangs on large organic
 * meshes; anatomy from the host is reference geometry, so a render mesh is the
 * right representation and handles any triangle count instantly.
 */
async function importStlAsMeshNode(app: IApplication, bytes: ArrayBuffer, name: string): Promise<boolean> {
    const dv = new DataView(bytes);
    if (bytes.byteLength < 84) return false;
    const count = dv.getUint32(80, true);
    if (bytes.byteLength < 84 + count * 50) return false;

    const position = new Float32Array(count * 9);
    const normal = new Float32Array(count * 9);
    let o = 84;
    for (let t = 0; t < count; t++) {
        const nx = dv.getFloat32(o, true);
        const ny = dv.getFloat32(o + 4, true);
        const nz = dv.getFloat32(o + 8, true);
        o += 12;
        for (let v = 0; v < 3; v++) {
            const i = t * 9 + v * 3;
            position[i] = dv.getFloat32(o, true);
            position[i + 1] = dv.getFloat32(o + 4, true);
            position[i + 2] = dv.getFloat32(o + 8, true);
            normal[i] = nx;
            normal[i + 1] = ny;
            normal[i + 2] = nz;
            o += 12;
        }
        o += 2;
    }

    const mesh = Mesh.createSurface(count * 3, count * 3);
    mesh.position = position;
    mesh.normal = normal;
    mesh.uv = undefined;
    const index = new Uint32Array(count * 3);
    for (let i = 0; i < index.length; i++) index[i] = i;
    mesh.index = index;

    const document = app.activeView?.document ?? (await app.newDocument(name));
    await Transaction.executeAsync(document, "import mesh", async () => {
        document.addNode(new MeshNode(document, mesh, name));
    });
    document.visual.update();
    app.activeView?.cameraController.fitContent();
    return true;
}

/** Same-origin postMessage bridge for the embedding host application. */
function setupCdxBridge(app: IApplication) {
    if (window.parent === window) return;
    const origin = window.location.origin;

    window.addEventListener("message", async (e: MessageEvent) => {
        if (e.origin !== origin) return;
        const msg = e.data as { type?: string; url?: string };

        if (msg?.type === "cdx-load" && typeof msg.url === "string") {
            try {
                const fileName = decodeURIComponent(msg.url.substring(msg.url.lastIndexOf("/") + 1));
                if (fileName.toLowerCase().endsWith(".stl")) {
                    const response = await fetch(msg.url);
                    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
                    const ok = await importStlAsMeshNode(app, await response.arrayBuffer(), fileName);
                    if (!ok) throw new Error("not a parsable binary STL");
                } else {
                    // non-STL formats go through the regular import; it swallows
                    // errors internally, so verify a node was actually added.
                    const before = collectVisualNodes(app.activeView?.document?.rootNode).length;
                    await app.loadFileFromUrl(msg.url);
                    const after = collectVisualNodes(app.activeView?.document?.rootNode).length;
                    if (after <= before) throw new Error("no node was added (fetch or import failed)");
                }
                const nodes = collectVisualNodes(app.activeView?.document?.rootNode).length;
                window.parent.postMessage({ type: "cdx-loaded", url: msg.url, nodes }, origin);
            } catch (err) {
                window.parent.postMessage(
                    { type: "cdx-load-failed", url: msg.url, reason: String(err) },
                    origin,
                );
            }
        } else if (msg?.type === "cdx-export") {
            const doc = app.activeView?.document;
            const nodes = collectVisualNodes(doc?.rootNode);
            if (!doc || nodes.length === 0) {
                window.parent.postMessage({ type: "cdx-export-failed", reason: "empty document" }, origin);
                return;
            }
            const data = await app.dataExchange.export(".stl binary", nodes);
            if (!data) {
                window.parent.postMessage({ type: "cdx-export-failed", reason: "export failed" }, origin);
                return;
            }
            const bytes = await new Blob(data).arrayBuffer();
            window.parent.postMessage(
                { type: "cdx-design", name: doc.name, bytes, nodeCount: nodes.length },
                origin,
                [bytes],
            );
        }
    });

    window.parent.postMessage(
        { type: "cdx-cad-ready", exportFormats: app.dataExchange.exportFormats() },
        origin,
    );
}

async function handleApplicaionBuilt(app: IApplication) {
    document.body.removeChild(loading);

    setupCdxBridge(app);

    const params = new URLSearchParams(window.location.search);
    const url = params.get("url") ?? params.get("model");
    if (url) {
        Logger.info(`load file from url: ${url}`);

        await app.loadFileFromUrl(url);
    }
}

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .addAdditionalModules(new DentalModule())
    .useUI()
    .build()
    .then(handleApplicaionBuilt)
    .catch((err) => {
        Logger.error(err);
    });
