// Part of the coDiagnostiX Web dental layer (AGPL-3.0, like Chili3D).
//
// DWOS "Anatomy" station (library/parametric proposition): detect the
// edentulous single-tooth gap from the segmentation, then place a library
// tooth there as the crown proposal. Orientation is derived from the scan
// itself — occlusal axis = gingiva→teeth, mesiodistal axis = neighbour→
// neighbour — so it needs no manual alignment. The proposal is a normal mesh
// node and can be exported as STL like any design.

import { command, IApplication, ICommand, Logger, Mesh, MeshNode, PubSub, Transaction } from "chili-core";
import { CMD_PROPOSE, t } from "../keys";
import { getSegResult } from "../segStore";
import { detectGap, labelToFdi } from "../fdiArch";
import { b64ToBytes, computeVertexNormals } from "../mesh/meshIo";

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaleV = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const normalize = (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

@command({
    key: CMD_PROPOSE,
    icon: "icon-circle",
})
export class DentalProposeCrownCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;
        const seg = getSegResult();
        if (!seg) {
            PubSub.default.pub("showToast", t("toast.dental.notagged"));
            return;
        }
        const gap = detectGap(seg.presentFdis);
        if (!gap) {
            PubSub.default.pub("showToast", t("toast.dental.nogap"));
            return;
        }

        // Centroids: gingiva, all teeth, and the two flanking neighbours.
        const pos = seg.positions;
        const lab = seg.labels;
        let gx = 0, gy = 0, gz = 0, gc = 0;
        let tx = 0, ty = 0, tz = 0, tc = 0;
        let lx = 0, ly = 0, lz = 0, lc = 0;
        let rx = 0, ry = 0, rz = 0, rc = 0;
        for (let i = 0; i < lab.length; i++) {
            const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
            const L = lab[i];
            if (L === 0) { gx += x; gy += y; gz += z; gc++; continue; }
            tx += x; ty += y; tz += z; tc++;
            const fdi = labelToFdi(L);
            if (fdi === gap.left) { lx += x; ly += y; lz += z; lc++; }
            else if (fdi === gap.right) { rx += x; ry += y; rz += z; rc++; }
        }
        if (!gc || !tc || !lc || !rc) {
            PubSub.default.pub("showToast", t("toast.dental.nogap"));
            return;
        }
        const gingiva: V3 = [gx / gc, gy / gc, gz / gc];
        const teeth: V3 = [tx / tc, ty / tc, tz / tc];
        const left: V3 = [lx / lc, ly / lc, lz / lc];
        const right: V3 = [rx / rc, ry / rc, rz / rc];
        const gapPos: V3 = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];

        // Local crown frame: z = occlusal (gingiva→teeth), x = mesiodistal.
        const zAxis = normalize(sub(teeth, gingiva));
        const mdRaw = sub(right, left);
        const xAxis = normalize(sub(mdRaw, scaleV(zAxis, dot(mdRaw, zAxis))));
        const yAxis = normalize(cross(zAxis, xAxis));

        PubSub.default.pub("showToast", t("toast.dental.proposing"), String(gap.target));
        try {
            const res = await fetch(`/api/cad/virtual-tooth?fdi=${gap.target}`);
            if (!res.ok) {
                const b = (await res.json().catch(() => null)) as { message?: string } | null;
                PubSub.default.pub("showToast", t("toast.dental.failed"), b?.message ?? `HTTP ${res.status}`);
                return;
            }
            const data = (await res.json()) as {
                positionsB64: string;
                heightMM: number;
                scale: number;
                vertexCount: number;
            };
            const local = new Float32Array(b64ToBytes(data.positionsB64).buffer);
            const halfH = (data.heightMM * data.scale) / 2;
            const origin = sub(gapPos, scaleV(zAxis, halfH)); // centre the crown on the gap

            const world = new Float32Array(local.length);
            for (let i = 0; i < local.length; i += 3) {
                const a = local[i], b = local[i + 1], c = local[i + 2];
                world[i] = origin[0] + xAxis[0] * a + yAxis[0] * b + zAxis[0] * c;
                world[i + 1] = origin[1] + xAxis[1] * a + yAxis[1] * b + zAxis[1] * c;
                world[i + 2] = origin[2] + xAxis[2] * a + yAxis[2] * b + zAxis[2] * c;
            }

            const mesh = new Mesh();
            mesh.meshType = "surface";
            mesh.position = world;
            mesh.normal = computeVertexNormals(world);
            const ivory: number[] = new Array(world.length);
            for (let i = 0; i < world.length; i += 3) { ivory[i] = 0.93; ivory[i + 1] = 0.89; ivory[i + 2] = 0.78; }
            mesh.color = ivory;

            Transaction.execute(document, "propose crown", () => {
                document.addNode(new MeshNode(document, mesh, `Crown ${gap.target} (proposal)`));
            });
            document.visual.update();
            PubSub.default.pub("showToast", t("toast.dental.proposed"), String(gap.target));
            Logger.info(
                `[dental] proposed crown FDI ${gap.target} between ${gap.left}/${gap.right}, ${data.vertexCount} verts`,
            );
        } catch (err) {
            PubSub.default.pub("showToast", t("toast.dental.failed"), String(err));
            Logger.error(`[dental] propose crown failed: ${String(err)}`);
        }
    }
}
