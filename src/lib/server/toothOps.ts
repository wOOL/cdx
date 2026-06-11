/**
 * AI tooth operations shared by the renumber / extract-tooth endpoints
 * (the desktop "AI assistant" follow-up tools shown in the tutorial videos):
 *
 *  - planRenumber: pure shift-planning for "change tooth numbering". Within
 *    one arch the FDI positions form a single sequence (upper 18..11,21..28,
 *    lower 48..41,31..38). Renumbering a tooth shifts the whole CONTIGUOUS
 *    run of existing teeth that extends from the clicked tooth in the move
 *    direction (the video: renumbering 24→23 while 23..17 exist shifts all
 *    of them by −1). A shift that would land on an existing tooth outside
 *    the moved run, or run off the arch, is rejected. A target number on the
 *    opposite arch relabels only the clicked tooth.
 *  - renameToothModel: keeps the vendor "AI — Tooth <fdi>" naming pattern in
 *    sync so classifyAiModel() still resolves the row after a renumber.
 *  - extractToothMesh: the three AI tooth-extraction modes on a scan, built
 *    on the Mesh Editor's combine/subtract op (no geometry code duplicated):
 *      'alveolus'  — full approximate CSG difference scan − tooth: triangles
 *                    of the scan inside the tooth are removed and the tooth's
 *                    triangles inside the scan are added inverted (the socket
 *                    walls).
 *      'cut'       — only the removal half of the subtract. The subtract op
 *                    emits the kept scan triangles first and the added wall
 *                    triangles last (an invariant asserted by
 *                    scripts/test-meshsubtract.ts), so the cut result is the
 *                    kept-prefix of the subtract output.
 *      'cut-close' — 'cut' followed by fillHoles with exceptLargest (the
 *                    Mesh Editor's "Close holes without largest" repair
 *                    default): the freshly cut openings are closed, the
 *                    scan's natural (largest) opening stays untouched.
 */

import { FDI_LOWER, FDI_UPPER } from '$lib/aiReviewMap';
import { applyMeshEdit, type MeshEditContext } from '$lib/server/meshEdit';

// ---------------------------------------------------------------------------
// Renumbering
// ---------------------------------------------------------------------------

export interface RenumberChange {
	oldFdi: number;
	newFdi: number;
}

export type RenumberPlan =
	| { ok: true; changes: RenumberChange[] }
	| { ok: false; status: 400 | 409; error: string };

/** Chart-order arch sequence containing `fdi`, or null for invalid numbers. */
function archSeq(fdi: number): readonly number[] | null {
	if (FDI_UPPER.includes(fdi)) return FDI_UPPER;
	if (FDI_LOWER.includes(fdi)) return FDI_LOWER;
	return null;
}

/**
 * Plan renumbering the AI tooth `oldFdi` to `newFdi` given the FDI numbers of
 * all existing AI tooth models of the case. Pure — the endpoint applies the
 * returned changes to the model rows, tests exercise this directly.
 */
export function planRenumber(
	existingFdis: Iterable<number>,
	oldFdi: number,
	newFdi: number
): RenumberPlan {
	const seq = archSeq(oldFdi);
	if (!seq) return { ok: false, status: 400, error: `${oldFdi} is not a valid FDI tooth number` };
	const targetSeq = archSeq(newFdi);
	if (!targetSeq) {
		return { ok: false, status: 400, error: `${newFdi} is not a valid FDI tooth number` };
	}
	if (newFdi === oldFdi) {
		return { ok: false, status: 400, error: `Tooth is already numbered ${oldFdi}` };
	}

	const existing = new Set(existingFdis);
	existing.add(oldFdi);

	// opposite arch: relabel only the clicked tooth (video behavior)
	if (targetSeq !== seq) {
		if (existing.has(newFdi)) {
			return { ok: false, status: 409, error: `Tooth ${newFdi} already exists` };
		}
		return { ok: true, changes: [{ oldFdi, newFdi }] };
	}

	const p0 = seq.indexOf(oldFdi);
	const delta = seq.indexOf(newFdi) - p0;
	const dir = delta > 0 ? 1 : -1;

	// contiguous run of existing teeth from the clicked one toward the collision direction
	const run: number[] = [p0];
	for (let p = p0 + dir; p >= 0 && p < seq.length && existing.has(seq[p]); p += dir) {
		run.push(p);
	}
	const moved = new Set(run.map((p) => seq[p]));

	const changes: RenumberChange[] = [];
	for (const p of run) {
		const target = p + delta;
		if (target < 0 || target >= seq.length) {
			return {
				ok: false,
				status: 409,
				error: `Cannot renumber: tooth ${seq[p]} would be shifted off the arch`
			};
		}
		const targetFdi = seq[target];
		if (existing.has(targetFdi) && !moved.has(targetFdi)) {
			return {
				ok: false,
				status: 409,
				error: `Cannot renumber: position ${targetFdi} is already occupied`
			};
		}
		changes.push({ oldFdi: seq[p], newFdi: targetFdi });
	}
	return { ok: true, changes };
}

/**
 * Model name after a renumber. The tooth number inside the existing name is
 * replaced in place ("AI — Tooth 24" → "AI — Tooth 23"); names without the
 * pattern fall back to the vendor naming so classifyAiModel() resolves the
 * row from the name alone (it parses /tooth\s*\(?\s*(\d{2})\)?/i).
 */
export function renameToothModel(name: string, newFdi: number): string {
	if (/tooth\s*\(?\s*\d{1,2}/i.test(name)) {
		return name.replace(/(tooth\s*\(?\s*)\d{1,2}/i, `$1${newFdi}`);
	}
	return `AI — Tooth ${newFdi}`;
}

// ---------------------------------------------------------------------------
// Tooth extraction
// ---------------------------------------------------------------------------

export type ToothExtractMode = 'cut' | 'cut-close' | 'alveolus';

export interface ToothExtractResult {
	positions: Float32Array;
	/** scan triangles dropped because their centroid lies inside the tooth */
	removedTriangles: number;
	/** alveolus: inverted socket-wall triangles; cut-close: hole-fan triangles */
	addedTriangles: number;
	/** cut-close only: openings closed (all but the largest) */
	holesFilled: number;
}

/** fillHoles cap used by the Mesh Editor's repair buttons ("close everything"). */
const FILL_MAX_EDGES = 100000;

/**
 * Extract the AI tooth `toothModelId` from the scan soup (scan-local mm).
 * `ctx` resolves the tooth model and carries the scan's stored transform —
 * the same MeshEditContext contract the Mesh Editor endpoint uses, so both
 * shells are combined where the planning views show them. Throws on
 * degenerate input (e.g. the subtraction would consume the whole scan).
 */
export function extractToothMesh(
	scanPositions: Float32Array,
	toothModelId: number,
	mode: ToothExtractMode,
	ctx: MeshEditContext
): ToothExtractResult {
	const sub = applyMeshEdit(
		scanPositions,
		{ op: 'combine', modelId: toothModelId, mode: 'subtract' },
		ctx
	);
	const removed = Number(sub.report.removedTriangles) || 0;
	const walls = Number(sub.report.addedTriangles) || 0;

	if (mode === 'alveolus') {
		return { positions: sub.positions, removedTriangles: removed, addedTriangles: walls, holesFilled: 0 };
	}

	// the subtract output is [kept scan triangles..., inverted wall triangles...]
	// (asserted by scripts/test-meshsubtract.ts) — 'cut' keeps only the prefix
	const cut = sub.positions.slice(0, scanPositions.length - removed * 9);
	if (cut.length < 9) throw new Error('Extraction would remove the whole scan');
	if (mode === 'cut') {
		return { positions: cut, removedTriangles: removed, addedTriangles: 0, holesFilled: 0 };
	}

	// cut-close: close the cut openings but keep the scan's natural (largest)
	// opening — the Mesh Editor's "Close holes without largest" convention
	const filled = applyMeshEdit(cut, {
		op: 'fillHoles',
		maxEdges: FILL_MAX_EDGES,
		exceptLargest: true
	});
	return {
		positions: filled.positions,
		removedTriangles: removed,
		addedTriangles: Math.max(0, (filled.positions.length - cut.length) / 9),
		holesFilled: Number(filled.report.holesFilled) || 0
	};
}
