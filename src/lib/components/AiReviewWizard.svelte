<script lang="ts">
	/**
	 * AI assistant review wizard (desktop coDiagnostiX "AI assistant" window,
	 * see cod_guide/video "How-to-Review-Import-Data-from-AI-Assistant-NAM"):
	 * a full-screen modal with a left-rail checklist of review steps and a
	 * bottom Back / Next / "Import reviewed data" bar.
	 *
	 * Steps (each only appears when its data exists — with nothing but meshes
	 * the wizard degrades to step 1, a 1:1 replacement of AiReviewDialog):
	 *  1. 3D objects     — WebGL render of all AI objects + FDI tooth chart
	 *                      (18→28 / 48→38) with per-object toggles.
	 *  2. Patient coordinate system — PCS proposal over slice views, adjustable
	 *                      angles, applied via POST /api/datasets/[id]/align.
	 *  3. Panoramic curve — draggable support points on the axial slice +
	 *                      live panoramic preview (POST /api/datasets/[id]/pano).
	 *  4. Nerve canal    — right/left canal sub-items, point-by-point review
	 *                      (Previous/Next/New point), draggable points,
	 *                      optional re-detect via POST nerve-detect.
	 *  5. Scan alignment — one sub-item per registered model scan: contour
	 *                      overlays on all three planes, fine-alignment nudges
	 *                      (FineAlignDialog) + reset + accept.
	 *
	 * On "Import reviewed data" the wizard saves pano + nerves itself
	 * (POST /api/datasets/[id]/ai-review) and then hands the kept model ids to
	 * the case page exactly like the old dialog: onimport(modelIds) — the page
	 * deletes the unimported rows. If a PCS rotation was applied the page is
	 * reloaded afterwards (the volume was re-sliced), mirroring the planner's
	 * own PCS-apply behaviour.
	 */
	import { onMount } from 'svelte';
	import { SliceCache } from '$lib/client/sliceCache';
	import { loadModelPositions } from '$lib/client/meshContours';
	import { composeMat4, identityMat4 } from '$lib/registration';
	import { sampleCurve } from '$lib/curve';
	import {
		FDI_LOWER,
		FDI_UPPER,
		classifyAiModel,
		rotationMatrix,
		rotateAboutCenter,
		transpose3,
		type Vec3
	} from '$lib/aiReviewMap';
	import {
		meshBounds,
		planeContours,
		rigidFromEuler,
		sliceToBitmap,
		type DsGeom,
		type Plane,
		type ToothEntry,
		type ViewMap,
		type WizardMesh
	} from './aireview/overlay';
	import SliceOverlayCanvas from './aireview/SliceOverlayCanvas.svelte';
	import MeshCanvas from './aireview/MeshCanvas.svelte';
	import ToothChart from './aireview/ToothChart.svelte';
	import FineAlignDialog from './FineAlignDialog.svelte';

	let {
		datasetId,
		caseId,
		planId = undefined,
		models,
		onimport,
		onclose
	}: {
		datasetId: number;
		caseId: number;
		/** plan that receives pano curve + nerves; defaults to the case's master plan */
		planId?: number;
		models: { id: number; name: string; ok: boolean }[];
		onimport: (modelIds: number[]) => void | Promise<void>;
		onclose: () => void;
	} = $props();

	// ---------------------------------------------------------------- types
	interface BundleModel {
		id: number;
		name: string;
		kind: string;
		color: string;
		ok: boolean;
		ai: boolean;
		objectKind: string;
		fdi: number | null;
		side: 'left' | 'right' | null;
		arch: 'upper' | 'lower' | null;
		label: string;
		transform: number[] | null;
	}
	interface Bundle {
		dataset: {
			id: number;
			caseId: number;
			cols: number;
			rows: number;
			slices: number;
			spacing: { x: number; y: number; z: number };
			windowCenter: number;
			windowWidth: number;
		};
		plan: { id: number; locked: boolean };
		models: BundleModel[];
		canals: { modelId: number; side: 'left' | 'right'; points: Vec3[] }[];
		pano: { control: { x: number; y: number }[]; z: number } | null;
		scans: { id: number; name: string; color: string; transform: number[] }[];
	}
	interface PcsProposal {
		yaw: number;
		pitch: number;
		roll: number;
		curve: { x: number; y: number }[] | null;
		confidence: 'good' | 'low';
	}
	type StepKey = 'objects' | 'pcs' | 'pano' | 'nerve' | 'scan';

	// ---------------------------------------------------------------- state
	let bundle = $state<Bundle | null>(null);
	let loading = $state(true);
	let loadErr = $state('');
	let proposal = $state<PcsProposal | null>(null);
	let cache = $state(new SliceCache(datasetId));
	let stepIdx = $state(0);
	let visited = $state<Record<string, boolean>>({ objects: true });
	let excluded = $state<Record<number, boolean>>({});
	let meshPositions = $state<Record<number, Float32Array | null>>({});
	let resetTick = $state(0);
	let overlayTick = $state(0);
	let importing = $state(false);

	// tooth renumbering (objects step): the picker opened from the FDI chart
	let renumberFdi = $state<number | null>(null);
	let renumberTarget = $state(0);
	let renumberBusy = $state(false);
	let renumberErr = $state('');
	let renumberNote = $state('');

	// PCS
	let pcs = $state({ yaw: 0, pitch: 0, roll: 0 });
	let pcsApplied = $state(false);
	let pcsBusy = $state(false);

	// panoramic curve
	let panoControl = $state<{ x: number; y: number }[]>([]);
	let panoZ = $state(0);
	let panoControl0: { x: number; y: number }[] = [];
	let panoDragIdx = -1;
	let panoPreview = $state('');
	let panoPreviewBusy = false;

	// nerve canals
	let canals = $state<{ modelId: number; side: 'left' | 'right'; points: Vec3[]; active: number }[]>([]);
	/** pristine AI-proposed canal points (per canal, for one-click reset) */
	let canalProposed: Vec3[][] = [];
	let canalTab = $state(0);
	let nerveDragIdx = -1;
	let nerveNote = $state('');

	// scan alignment
	let scanTab = $state(0);
	let scanTransforms = $state<Record<number, number[]>>({});
	let scanOrig: Record<number, number[]> = {};
	let scanAccepted = $state<Record<number, boolean>>({});
	let scanSlices = $state({ axial: 0, coronal: 0, sagittal: 0 });
	let scanInitFor = -1;
	let fineAlignOpen = $state(false);

	// ---------------------------------------------------------------- derived
	const geom = $derived<DsGeom | null>(
		bundle
			? {
					cols: bundle.dataset.cols,
					rows: bundle.dataset.rows,
					slices: bundle.dataset.slices,
					sx: bundle.dataset.spacing.x,
					sy: bundle.dataset.spacing.y,
					sz: bundle.dataset.spacing.z,
					windowCenter: bundle.dataset.windowCenter,
					windowWidth: bundle.dataset.windowWidth
				}
			: null
	);

	const aiModels = $derived.by(() => {
		const meta = new Map((bundle?.models ?? []).map((m) => [m.id, m]));
		return models.map((m) => {
			const b = meta.get(m.id);
			if (b) {
				return {
					id: m.id,
					name: m.name,
					ok: m.ok && b.ok,
					color: b.color || '#cbbf9a',
					objectKind: b.objectKind,
					fdi: b.fdi,
					side: b.side,
					label: b.label,
					transform: b.transform
				};
			}
			const info = classifyAiModel(m.name);
			return {
				id: m.id,
				name: m.name,
				ok: m.ok,
				color: '#cbbf9a',
				objectKind: info.kind,
				fdi: info.fdi,
				side: info.side,
				label: info.label,
				transform: null as number[] | null
			};
		});
	});

	const selectedIds = $derived(aiModels.filter((m) => m.ok && !excluded[m.id]).map((m) => m.id));

	const teeth = $derived.by(() => {
		const rec: Record<number, ToothEntry | undefined> = {};
		for (const m of aiModels) {
			if (m.objectKind === 'tooth' && m.fdi != null) {
				rec[m.fdi] = { modelId: m.id, selected: m.ok && !excluded[m.id], ok: m.ok };
			}
		}
		return rec;
	});
	const nonTeeth = $derived(aiModels.filter((m) => m.objectKind !== 'tooth'));

	const wizardMeshes = $derived<WizardMesh[]>(
		aiModels
			.filter((m) => m.ok)
			.map((m) => ({
				id: m.id,
				positions: meshPositions[m.id] ?? null,
				color: m.color,
				visible: !excluded[m.id],
				transform: m.transform
			}))
	);

	const scans = $derived(bundle?.scans ?? []);
	const hasPcs = $derived((proposal?.confidence === 'good' || pcsApplied) && !!geom);
	const hasPano = $derived(panoControl.length >= 2 && !!geom);
	const hasNerve = $derived(canals.length > 0 && !!geom);

	const steps = $derived.by(() => {
		const list: { key: StepKey; title: string; sub: string }[] = [
			{ key: 'objects', title: '3D objects', sub: 'Review and import objects' }
		];
		if (hasPcs)
			list.push({
				key: 'pcs',
				title: 'Patient coordinate system',
				sub: pcsApplied ? 'Rotation applied' : 'Verify the proposed orientation'
			});
		if (hasPano) list.push({ key: 'pano', title: 'Panoramic curve', sub: 'Verify the detected curve' });
		if (hasNerve) list.push({ key: 'nerve', title: 'Nerve canal', sub: 'Check each canal point' });
		if (scans.length)
			list.push({ key: 'scan', title: 'Scan alignment', sub: 'Verify the scan registration' });
		return list;
	});
	const step = $derived(steps[Math.max(0, Math.min(stepIdx, steps.length - 1))]);
	const activeCanal = $derived(canals.length ? canals[Math.min(canalTab, canals.length - 1)] : null);
	const activeScan = $derived(scans.length ? scans[Math.min(scanTab, scans.length - 1)] : null);

	const CAPTIONS: Record<StepKey, string> = {
		objects: 'Please select and place all objects to import to your planning.',
		pcs: 'Verify the proposed patient coordinate system. Adjust the angles if necessary, then apply the rotation.',
		pano: 'Move the detected panoramic curve. Click and drag with the left mouse button to move the support points.',
		nerve: 'Click and drag to move the nerve canal points. Look at each point to check if the nerve canal is in the right position.',
		scan: 'Verify the alignment of the model scan with the X-ray data in all views — the alignment is critical for the accuracy of your surgical guide.'
	};

	// nerve views follow the active point
	const nerveAxIdx = $derived.by(() => {
		if (!geom || !activeCanal) return 0;
		const p = activeCanal.points[Math.min(activeCanal.active, activeCanal.points.length - 1)];
		return clampIdx(Math.round(p.z / geom.sz), geom.slices);
	});
	const nerveCorIdx = $derived.by(() => {
		if (!geom || !activeCanal) return 0;
		const p = activeCanal.points[Math.min(activeCanal.active, activeCanal.points.length - 1)];
		return clampIdx(Math.round(p.y / geom.sy), geom.rows);
	});

	// mark steps/sub-steps visited as they are shown
	$effect(() => {
		const k = step?.key;
		if (!k) return;
		visited[k] = true;
		if (k === 'nerve' && activeCanal) visited[`nerve:${activeCanal.side}`] = true;
		if (k === 'scan' && activeScan) visited[`scan:${activeScan.id}`] = true;
	});

	// scan step: lazy-load the scan mesh and center the views on it once
	$effect(() => {
		if (step?.key !== 'scan' || !geom) return;
		const sc = activeScan;
		if (!sc) return;
		if (!(sc.id in meshPositions)) {
			meshPositions[sc.id] = null;
			loadModelPositions(sc.id).then((p) => {
				meshPositions[sc.id] = p;
				overlayTick++;
			});
		}
		const pos = meshPositions[sc.id];
		if (pos && scanInitFor !== sc.id) {
			scanInitFor = sc.id;
			const b = meshBounds(pos, scanTransforms[sc.id] ?? null);
			scanSlices = {
				axial: clampIdx(Math.round(b.center[2] / geom.sz), geom.slices),
				coronal: clampIdx(Math.round(b.center[1] / geom.sy), geom.rows),
				sagittal: clampIdx(Math.round(b.center[0] / geom.sx), geom.cols)
			};
		}
	});

	// ---------------------------------------------------------------- helpers
	function clampIdx(i: number, n: number): number {
		return Math.max(0, Math.min(n - 1, i));
	}
	function volCenter(): Vec3 {
		const g = geom!;
		return {
			x: ((g.cols - 1) / 2) * g.sx,
			y: ((g.rows - 1) / 2) * g.sy,
			z: ((g.slices - 1) / 2) * g.sz
		};
	}
	function round1(v: number): number {
		return Math.round(v * 10) / 10;
	}

	// ---------------------------------------------------------------- init
	onMount(() => {
		void init();
	});

	async function init(): Promise<void> {
		void caseId; // contract parity with the case page mount; the bundle carries the case id
		try {
			const r = await fetch(
				`/api/datasets/${datasetId}/ai-review${planId ? `?planId=${planId}` : ''}`
			);
			if (r.ok) bundle = (await r.json()) as Bundle;
			else loadErr = `Review data unavailable (${r.status})`;
		} catch {
			loadErr = 'Review data unavailable';
		}
		if (bundle) {
			const inJob = new Set(models.map((m) => m.id));
			canals = bundle.canals
				.filter((c) => inJob.has(c.modelId))
				.map((c) => ({ ...c, points: c.points.map((p) => ({ ...p })), active: 0 }))
				.sort((a, b) => (a.side === b.side ? 0 : a.side === 'right' ? -1 : 1));
			canalProposed = canals.map((c) => c.points.map((p) => ({ ...p })));
			for (const s of bundle.scans) {
				scanTransforms[s.id] = s.transform.slice();
				scanOrig[s.id] = s.transform.slice();
			}
			panoZ = bundle.pano?.z ?? Math.floor(bundle.dataset.slices / 2);
			if (bundle.pano) panoControl = bundle.pano.control.map((p) => ({ ...p }));

			// PCS + panoramic-curve proposal (existing endpoint, read-only)
			try {
				const pr = await fetch(`/api/datasets/${datasetId}/pcs-propose`, { method: 'POST' });
				if (pr.ok) {
					const b = (await pr.json()) as PcsProposal;
					proposal = b;
					if (b.confidence === 'good') {
						pcs = { yaw: round1(b.yaw), pitch: round1(b.pitch), roll: round1(b.roll) };
						if (b.curve && b.curve.length >= 2) {
							// proposal curve lives in the POST-align frame — pull it back
							// into the current frame for display/dragging (it is re-rotated
							// forward if/when the user applies the rotation)
							const Rt = transpose3(rotationMatrix(b.yaw, b.pitch, b.roll));
							const c = volCenter();
							const zmm = panoZ * (geom?.sz ?? 1);
							panoControl = b.curve.map((p) => {
								const q = rotateAboutCenter(Rt, c, { x: p.x, y: p.y, z: zmm });
								return { x: q.x, y: q.y };
							});
						}
					}
				}
			} catch {
				proposal = null;
			}
			panoControl0 = panoControl.map((p) => ({ ...p }));

			// kick off AI mesh loads for the 3D objects step
			for (const m of models) {
				if (!m.ok) continue;
				meshPositions[m.id] = null;
				loadModelPositions(m.id).then((p) => {
					meshPositions[m.id] = p;
				});
			}
			void panoPreviewRefresh();
		}
		loading = false;
	}

	async function reloadBundle(): Promise<void> {
		try {
			const r = await fetch(
				`/api/datasets/${datasetId}/ai-review${planId ? `?planId=${planId}` : ''}`
			);
			if (!r.ok) return;
			bundle = (await r.json()) as Bundle;
			for (const s of bundle.scans) {
				scanTransforms[s.id] = s.transform.slice();
				scanOrig[s.id] = s.transform.slice();
			}
			scanInitFor = -1;
		} catch {
			// keep the previous bundle
		}
	}

	// ---------------------------------------------------------------- step 1: objects
	function toggleTooth(fdi: number): void {
		const t = teeth[fdi];
		if (!t) return;
		excluded[t.modelId] = !excluded[t.modelId];
	}
	function toggleModel(id: number): void {
		excluded[id] = !excluded[id];
	}

	// renumber a tooth (✎ button / right-click on the chart → number picker →
	// POST /api/models/[id]/renumber; same-arch targets shift the contiguous
	// run of neighbouring teeth server-side, opposite-arch relabels just one)
	function openRenumber(fdi: number): void {
		renumberFdi = fdi;
		renumberTarget = fdi;
		renumberErr = '';
		renumberNote = '';
	}

	async function applyRenumber(): Promise<void> {
		const fdi = renumberFdi;
		if (fdi == null || renumberBusy) return;
		const t = teeth[fdi];
		if (!t || renumberTarget === fdi) return;
		renumberBusy = true;
		renumberErr = '';
		try {
			const res = await fetch(`/api/models/${t.modelId}/renumber`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ newFdi: renumberTarget })
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				renumberErr = b?.message ?? `Renumbering failed (${res.status})`;
				return;
			}
			const changed = (b?.changes ?? []) as { modelId: number; oldFdi: number; newFdi: number }[];
			renumberNote =
				changed.length > 1
					? `Tooth ${fdi} renumbered to ${renumberTarget} — ${changed.length - 1} neighbouring ${changed.length === 2 ? 'tooth' : 'teeth'} shifted along.`
					: `Tooth ${fdi} renumbered to ${renumberTarget}.`;
			renumberFdi = null;
			await reloadBundle(); // chart re-derives the FDI positions from the fresh bundle
		} catch {
			renumberErr = 'Renumbering request failed';
		} finally {
			renumberBusy = false;
		}
	}
	const anySelected = $derived(selectedIds.length > 0);
	function deselectAll(): void {
		if (anySelected) for (const m of aiModels) excluded[m.id] = true;
		else for (const m of aiModels) excluded[m.id] = false;
	}

	// ---------------------------------------------------------------- step 2: PCS
	function pcsDraw(plane: Plane): (ctx: CanvasRenderingContext2D, view: ViewMap) => void {
		return (ctx, view) => {
			if (!geom) return;
			const c = volCenter();
			const angle =
				plane === 'axial' ? pcs.yaw : plane === 'coronal' ? pcs.pitch : pcs.roll;
			const a = (-angle * Math.PI) / 180;
			const cu = plane === 'sagittal' ? c.y : c.x;
			const cv = plane === 'axial' ? c.y : c.z;
			const L = Math.max(view.wMm, view.hMm);
			const dirs: [number, number, string, number[]][] = [
				[Math.sin(a), Math.cos(a), '#45b8e0', []],
				[Math.cos(a), -Math.sin(a), '#3aa757', [5, 4]]
			];
			for (const [du, dv, color, dash] of dirs) {
				const p1 = view.toCanvas(cu - du * L, cv - dv * L);
				const p2 = view.toCanvas(cu + du * L, cv + dv * L);
				ctx.strokeStyle = color;
				ctx.lineWidth = 1.4;
				ctx.setLineDash(dash);
				ctx.beginPath();
				ctx.moveTo(p1.x, p1.y);
				ctx.lineTo(p2.x, p2.y);
				ctx.stroke();
			}
			ctx.setLineDash([]);
		};
	}

	const pcsIdentity = $derived(
		Math.abs(pcs.yaw) < 0.05 && Math.abs(pcs.pitch) < 0.05 && Math.abs(pcs.roll) < 0.05
	);

	async function applyPcs(): Promise<void> {
		if (!geom || pcsBusy || pcsIdentity) return;
		pcsBusy = true;
		try {
			const res = await fetch(`/api/datasets/${datasetId}/align`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify($state.snapshot(pcs))
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				alert(b?.message ?? 'Alignment failed');
				return;
			}
			// co-rotate the wizard's unsaved overlay geometry exactly like /align
			// co-rotates persisted objects (p' = c + R·(p − c))
			const R = rotationMatrix(pcs.yaw, pcs.pitch, pcs.roll);
			const c = volCenter();
			const zmm = panoZ * geom.sz;
			let zSum = 0;
			panoControl = panoControl.map((p) => {
				const q = rotateAboutCenter(R, c, { x: p.x, y: p.y, z: zmm });
				zSum += q.z;
				return { x: q.x, y: q.y };
			});
			if (panoControl.length) {
				panoZ = clampIdx(Math.round(zSum / panoControl.length / geom.sz), geom.slices);
			}
			panoControl0 = panoControl.map((p) => ({ ...p }));
			for (const cn of canals) {
				cn.points = cn.points.map((p) => rotateAboutCenter(R, c, p));
			}
			pcsApplied = true;
			pcs = { yaw: 0, pitch: 0, roll: 0 };
			cache = new SliceCache(datasetId); // volume re-sliced server-side
			overlayTick++;
			await reloadBundle(); // model/scan transforms were co-rotated
			void panoPreviewRefresh();
		} finally {
			pcsBusy = false;
		}
	}

	// ---------------------------------------------------------------- step 3: pano
	function panoDraw(ctx: CanvasRenderingContext2D, view: ViewMap): void {
		if (panoControl.length < 2) return;
		const s = sampleCurve(
			panoControl.map((p) => ({ x: p.x, y: p.y })),
			1.0
		);
		if (s) {
			ctx.strokeStyle = '#45b8e0';
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			s.points.forEach((p, i) => {
				const q = view.toCanvas(p.x, p.y);
				if (i === 0) ctx.moveTo(q.x, q.y);
				else ctx.lineTo(q.x, q.y);
			});
			ctx.stroke();
		}
		panoControl.forEach((p, i) => {
			const q = view.toCanvas(p.x, p.y);
			ctx.beginPath();
			ctx.arc(q.x, q.y, i === panoDragIdx ? 6 : 4.5, 0, Math.PI * 2);
			ctx.fillStyle = '#f08a24';
			ctx.fill();
			ctx.strokeStyle = '#12151a';
			ctx.lineWidth = 1;
			ctx.stroke();
		});
	}

	function panoPointer(type: 'down' | 'move' | 'up', mm: { u: number; v: number }, view: ViewMap): void {
		if (type === 'down') {
			const rad = 10 / view.scale;
			let best = -1;
			let bestD = rad;
			panoControl.forEach((p, i) => {
				const d = Math.hypot(p.x - mm.u, p.y - mm.v);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			});
			panoDragIdx = best;
			overlayTick++;
		} else if (type === 'move' && panoDragIdx >= 0) {
			panoControl[panoDragIdx] = { x: mm.u, y: mm.v };
			overlayTick++;
		} else if (type === 'up') {
			if (panoDragIdx >= 0) void panoPreviewRefresh();
			panoDragIdx = -1;
			overlayTick++;
		}
	}

	async function panoPreviewRefresh(): Promise<void> {
		if (!geom || panoControl.length < 2 || panoPreviewBusy) return;
		panoPreviewBusy = true;
		try {
			const res = await fetch(`/api/datasets/${datasetId}/pano`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ control: $state.snapshot(panoControl), step: 0.7 })
			});
			if (!res.ok) return;
			const width = Number(res.headers.get('X-Width'));
			const height = Number(res.headers.get('X-Height'));
			const data = new Int16Array(await res.arrayBuffer());
			if (width > 0 && height > 0) {
				panoPreview = sliceToBitmap({ width, height, data }, geom).toDataURL();
			}
		} catch {
			// preview is best-effort
		} finally {
			panoPreviewBusy = false;
		}
	}

	function panoReset(): void {
		panoControl = panoControl0.map((p) => ({ ...p }));
		overlayTick++;
		void panoPreviewRefresh();
	}

	// ---------------------------------------------------------------- step 4: nerves
	function nerveDraw(plane: 'axial' | 'coronal'): (ctx: CanvasRenderingContext2D, view: ViewMap) => void {
		return (ctx, view) => {
			const cn = activeCanal;
			if (!cn || !geom) return;
			const sliceMm = plane === 'axial' ? nerveAxIdx * geom.sz : nerveCorIdx * geom.sy;
			const uv = (p: Vec3) => (plane === 'axial' ? { u: p.x, v: p.y } : { u: p.x, v: p.z });
			const off = (p: Vec3) => Math.abs((plane === 'axial' ? p.z : p.y) - sliceMm);

			ctx.strokeStyle = '#e8d44d';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			cn.points.forEach((p, i) => {
				const q = view.toCanvas(uv(p).u, uv(p).v);
				if (i === 0) ctx.moveTo(q.x, q.y);
				else ctx.lineTo(q.x, q.y);
			});
			ctx.stroke();

			cn.points.forEach((p, i) => {
				const q = view.toCanvas(uv(p).u, uv(p).v);
				const alpha = Math.max(0.3, 1 - off(p) / 6);
				ctx.globalAlpha = alpha;
				ctx.beginPath();
				ctx.arc(q.x, q.y, i === cn.active ? 6 : 4, 0, Math.PI * 2);
				ctx.fillStyle = i === cn.active ? '#f08a24' : '#e8d44d';
				ctx.fill();
				ctx.strokeStyle = '#12151a';
				ctx.lineWidth = 1;
				ctx.stroke();
				ctx.globalAlpha = 1;
			});
		};
	}

	function nervePointer(plane: 'axial' | 'coronal') {
		return (type: 'down' | 'move' | 'up', mm: { u: number; v: number }, view: ViewMap): void => {
			const cn = activeCanal;
			if (!cn) return;
			const uvOf = (p: Vec3) => (plane === 'axial' ? { u: p.x, v: p.y } : { u: p.x, v: p.z });
			if (type === 'down') {
				const rad = 10 / view.scale;
				let best = -1;
				let bestD = rad;
				cn.points.forEach((p, i) => {
					const d = Math.hypot(uvOf(p).u - mm.u, uvOf(p).v - mm.v);
					if (d < bestD) {
						bestD = d;
						best = i;
					}
				});
				nerveDragIdx = best;
				if (best >= 0) cn.active = best;
				overlayTick++;
			} else if (type === 'move' && nerveDragIdx >= 0) {
				const p = cn.points[nerveDragIdx];
				if (plane === 'axial') cn.points[nerveDragIdx] = { ...p, x: mm.u, y: mm.v };
				else cn.points[nerveDragIdx] = { ...p, x: mm.u, z: mm.v };
				overlayTick++;
			} else if (type === 'up') {
				nerveDragIdx = -1;
			}
		};
	}

	function nerveStep(dir: 1 | -1): void {
		const cn = activeCanal;
		if (!cn) return;
		cn.active = Math.max(0, Math.min(cn.points.length - 1, cn.active + dir));
		overlayTick++;
	}

	function nerveNewPoint(): void {
		const cn = activeCanal;
		if (!cn) return;
		const i = cn.active;
		const pts = cn.points;
		if (i < pts.length - 1) {
			const a = pts[i];
			const b = pts[i + 1];
			pts.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
		} else if (pts.length >= 2) {
			const a = pts[pts.length - 2];
			const b = pts[pts.length - 1];
			pts.push({ x: 2 * b.x - a.x, y: 2 * b.y - a.y, z: 2 * b.z - a.z });
		} else {
			pts.push({ ...pts[i], x: pts[i].x + 2 });
		}
		cn.active = Math.min(i + 1, pts.length - 1);
		overlayTick++;
	}

	function nerveDeletePoint(): void {
		const cn = activeCanal;
		if (!cn || cn.points.length <= 2) return;
		cn.points.splice(cn.active, 1);
		cn.active = Math.min(cn.active, cn.points.length - 1);
		overlayTick++;
	}

	async function nerveRedetect(): Promise<void> {
		const cn = activeCanal;
		if (!cn || cn.points.length < 2) return;
		nerveNote = 'Detecting…';
		try {
			const res = await fetch(`/api/datasets/${datasetId}/nerve-detect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					start: $state.snapshot(cn.points[0]),
					end: $state.snapshot(cn.points[cn.points.length - 1])
				})
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				nerveNote = b?.message ?? 'No path found between the end points';
				return;
			}
			cn.points = b.points;
			cn.active = 0;
			nerveNote = b.warning ?? '';
			overlayTick++;
		} catch {
			nerveNote = 'Detection request failed';
		}
	}

	// ---------------------------------------------------------------- step 5: scans
	// contour memo — avoids re-slicing the scan mesh on every overlay repaint
	const contourMemo = new Map<string, Float32Array>();
	function scanContours(id: number, plane: Plane, mm: number): Float32Array | null {
		const pos = meshPositions[id];
		if (!pos) return null;
		const t = scanTransforms[id] ?? null;
		const key = `${id}:${plane}:${mm.toFixed(2)}:${t ? t.map((v) => v.toFixed(2)).join(',') : 'id'}`;
		const hit = contourMemo.get(key);
		if (hit) return hit;
		const segs = planeContours(pos, t, plane, mm);
		contourMemo.set(key, segs);
		while (contourMemo.size > 64) {
			const oldest = contourMemo.keys().next().value as string;
			contourMemo.delete(oldest);
		}
		return segs;
	}

	function scanDraw(plane: Plane): (ctx: CanvasRenderingContext2D, view: ViewMap) => void {
		return (ctx, view) => {
			const sc = activeScan;
			if (!sc || !geom) return;
			const mm =
				plane === 'axial'
					? scanSlices.axial * geom.sz
					: plane === 'coronal'
						? scanSlices.coronal * geom.sy
						: scanSlices.sagittal * geom.sx;
			const segs = scanContours(sc.id, plane, mm);
			if (!segs || segs.length === 0) return;
			ctx.strokeStyle = '#f08a24';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < segs.length; i += 4) {
				const a = view.toCanvas(segs[i], segs[i + 1]);
				const b = view.toCanvas(segs[i + 2], segs[i + 3]);
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
			}
			ctx.stroke();
		};
	}

	function scanScroll(plane: Plane) {
		return (d: 1 | -1): void => {
			if (!geom) return;
			if (plane === 'axial') scanSlices.axial = clampIdx(scanSlices.axial + d, geom.slices);
			else if (plane === 'coronal') scanSlices.coronal = clampIdx(scanSlices.coronal + d, geom.rows);
			else scanSlices.sagittal = clampIdx(scanSlices.sagittal + d, geom.cols);
		};
	}

	async function patchScanTransform(id: number, next: number[]): Promise<void> {
		const res = await fetch(`/api/models/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ transform: next })
		});
		if (res.ok) {
			scanTransforms[id] = next;
			overlayTick++;
		} else {
			alert('Failed to update the scan transform');
		}
	}

	function applyNudge(
		delta: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number },
		frame: 'patient' | 'object'
	): void {
		const sc = activeScan;
		if (!sc) return;
		const pos = meshPositions[sc.id];
		if (!pos) return;
		const T = scanTransforms[sc.id] ?? identityMat4();
		const t = { x: delta.tx, y: delta.ty, z: delta.tz };
		let next: number[];
		if (frame === 'patient') {
			const b = meshBounds(pos, T);
			const N = rigidFromEuler(delta.rx, delta.ry, delta.rz, t, {
				x: b.center[0],
				y: b.center[1],
				z: b.center[2]
			});
			next = composeMat4(N, T);
		} else {
			const b = meshBounds(pos, null);
			const M = rigidFromEuler(delta.rx, delta.ry, delta.rz, t, {
				x: b.center[0],
				y: b.center[1],
				z: b.center[2]
			});
			next = composeMat4(T, M);
		}
		void patchScanTransform(sc.id, next);
	}

	function resetScanAlignment(): void {
		const sc = activeScan;
		if (!sc || !scanOrig[sc.id]) return;
		void patchScanTransform(sc.id, scanOrig[sc.id].slice());
	}

	// ---------------------------------------------------------------- import
	async function importReviewed(): Promise<void> {
		if (importing) return;
		importing = true;
		try {
			const payload: Record<string, unknown> = {};
			if (planId ?? bundle?.plan.id) payload.planId = planId ?? bundle!.plan.id;
			if (hasPano) {
				payload.pano = { control: $state.snapshot(panoControl), z: panoZ };
			}
			const nerves: Record<string, unknown> = {};
			for (const cn of canals) {
				if (cn.points.length >= 2) nerves[cn.side] = { points: $state.snapshot(cn.points) };
			}
			if (Object.keys(nerves).length) payload.nerves = nerves;

			if (payload.pano || payload.nerves) {
				const res = await fetch(`/api/datasets/${datasetId}/ai-review`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				if (!res.ok) {
					const b = await res.json().catch(() => null);
					alert(b?.message ?? 'Failed to apply the reviewed data');
					return;
				}
			}
			await Promise.resolve(onimport([...selectedIds]));
			if (pcsApplied) location.reload(); // volume was re-sliced by /align
		} finally {
			importing = false;
		}
	}

	function gotoStep(key: StepKey, tab?: number): void {
		const i = steps.findIndex((s) => s.key === key);
		if (i < 0) return;
		stepIdx = i;
		if (key === 'nerve' && tab !== undefined) canalTab = tab;
		if (key === 'scan' && tab !== undefined) scanTab = tab;
	}
</script>

<div class="aw-backdrop" role="presentation">
	<div class="aw-dialog panel">
		<div class="dialog-title aw-title">
			<span>AI assistant — review and import proposed data</span>
			<button class="btn ghost aw-close" onclick={onclose} title="Cancel review" aria-label="Close">✕</button>
		</div>

		<div class="aw-body">
			<aside class="aw-rail">
				{#each steps as s, i (s.key)}
					<button class="aw-step" class:current={i === stepIdx} onclick={() => (stepIdx = i)}>
						<span class="aw-check" class:done={visited[s.key]}>{visited[s.key] ? '✓' : ''}</span>
						<span class="aw-step-text">
							<span class="aw-step-title">{s.title}</span>
							<span class="aw-step-sub">{s.sub}</span>
						</span>
					</button>
					{#if s.key === 'nerve'}
						{#each canals as cn, t (cn.side)}
							<button
								class="aw-substep"
								class:current={i === stepIdx && t === canalTab}
								onclick={() => gotoStep('nerve', t)}
							>
								<span class="aw-check small" class:done={visited[`nerve:${cn.side}`]}>
									{visited[`nerve:${cn.side}`] ? '✓' : ''}
								</span>
								{cn.side === 'right' ? 'Right nerve canal' : 'Left nerve canal'}
							</button>
						{/each}
					{/if}
					{#if s.key === 'scan'}
						{#each scans as sc, t (sc.id)}
							<button
								class="aw-substep"
								class:current={i === stepIdx && t === scanTab}
								onclick={() => gotoStep('scan', t)}
								title={sc.name}
							>
								<span class="aw-check small" class:done={visited[`scan:${sc.id}`]}>
									{visited[`scan:${sc.id}`] ? '✓' : ''}
								</span>
								<span class="aw-substep-name">{sc.name}</span>
							</button>
						{/each}
					{/if}
				{/each}
			</aside>

			<section class="aw-main">
				{#if loading}
					<div class="aw-loading">Loading review data…</div>
				{:else}
					<p class="aw-caption">{CAPTIONS[step.key]}</p>

					{#if step.key === 'objects'}
						{#if geom}
							<MeshCanvas meshes={wizardMeshes} {resetTick} height={300} />
						{:else}
							<div class="aw-note">{loadErr || 'No 3D preview available.'}</div>
						{/if}
						<ToothChart {teeth} ontoggle={toggleTooth} />
						{#if nonTeeth.length}
							<div class="aw-pills">
								{#each nonTeeth as m (m.id)}
									<button
										class="aw-pill"
										class:on={m.ok && !excluded[m.id]}
										class:bad={!m.ok}
										disabled={!m.ok}
										onclick={() => toggleModel(m.id)}
										title={m.ok ? m.name : `${m.name} — empty / error`}
									>
										<span class="aw-dot" style="background:{m.color}"></span>
										{m.label}
										{#if !m.ok}<span class="aw-warn">⚠</span>{/if}
									</button>
								{/each}
							</div>
						{/if}
						<div class="aw-row">
							<button class="btn" onclick={deselectAll}>
								{anySelected ? 'Deselect all' : 'Select all'}
							</button>
							<button class="btn" onclick={() => resetTick++} disabled={!geom}>Reset view</button>
							<span class="muted">{selectedIds.length} of {aiModels.length} objects selected</span>
						</div>
					{:else if step.key === 'pcs' && geom}
						<div class="aw-grid3">
							<SliceOverlayCanvas
								{cache} {geom} plane="axial"
								index={Math.floor(geom.slices / 2)}
								version={overlayTick + pcs.yaw * 100}
								draw={pcsDraw('axial')} label="Axial — yaw" height={230}
							/>
							<SliceOverlayCanvas
								{cache} {geom} plane="coronal"
								index={Math.floor(geom.rows / 2)}
								version={overlayTick + pcs.pitch * 100}
								draw={pcsDraw('coronal')} label="Coronal — pitch" height={230}
							/>
							<SliceOverlayCanvas
								{cache} {geom} plane="sagittal"
								index={Math.floor(geom.cols / 2)}
								version={overlayTick + pcs.roll * 100}
								draw={pcsDraw('sagittal')} label="Sagittal — roll" height={230}
							/>
						</div>
						<div class="aw-row">
							<label class="aw-angle">Yaw <input type="number" min="-45" max="45" step="0.5" bind:value={pcs.yaw} />°</label>
							<label class="aw-angle">Pitch <input type="number" min="-45" max="45" step="0.5" bind:value={pcs.pitch} />°</label>
							<label class="aw-angle">Roll <input type="number" min="-45" max="45" step="0.5" bind:value={pcs.roll} />°</label>
							<button class="btn primary" onclick={applyPcs} disabled={pcsBusy || pcsIdentity}>
								{pcsBusy ? 'Applying…' : 'Apply rotation'}
							</button>
							{#if pcsApplied}<span class="aw-ok">✓ rotation applied to the dataset</span>{/if}
						</div>
						<div class="aw-note">
							Applying bakes the rotation into the volume (existing planning objects are co-rotated).
							The proposed axes are drawn over the middle slices: solid = mid-sagittal/vertical, dashed = occlusal.
						</div>
					{:else if step.key === 'pano' && geom}
						<SliceOverlayCanvas
							{cache} {geom} plane="axial" index={panoZ}
							version={overlayTick}
							draw={panoDraw} onpointer={panoPointer}
							onscroll={(d) => (panoZ = clampIdx(panoZ + d, geom.slices))}
							label="Axial — slice {panoZ}" height={330}
						/>
						<div class="aw-row">
							<label class="aw-slider">
								Slice
								<input type="range" min="0" max={geom.slices - 1} bind:value={panoZ} />
							</label>
							<button class="btn" onclick={panoReset}>Reset curve</button>
							<span class="muted">{panoControl.length} support points</span>
						</div>
						{#if panoPreview}
							<div class="aw-pano-strip">
								<img src={panoPreview} alt="Panoramic preview along the curve" />
							</div>
						{/if}
					{:else if step.key === 'nerve' && geom && activeCanal}
						<div class="aw-tabs">
							{#each canals as cn, t (cn.side)}
								<button class="aw-tab" class:active={t === canalTab} onclick={() => (canalTab = t)}>
									{cn.side === 'right' ? 'Right nerve canal' : 'Left nerve canal'}
								</button>
							{/each}
						</div>
						<div class="aw-grid2">
							<SliceOverlayCanvas
								{cache} {geom} plane="axial" index={nerveAxIdx}
								version={overlayTick}
								draw={nerveDraw('axial')} onpointer={nervePointer('axial')}
								label="Axial — slice {nerveAxIdx}" height={270}
							/>
							<SliceOverlayCanvas
								{cache} {geom} plane="coronal" index={nerveCorIdx}
								version={overlayTick}
								draw={nerveDraw('coronal')} onpointer={nervePointer('coronal')}
								label="Coronal — slice {nerveCorIdx}" height={270}
							/>
						</div>
						<div class="aw-row">
							<button class="btn" onclick={() => nerveStep(-1)} disabled={activeCanal.active <= 0}>
								◀ Previous point
							</button>
							<button
								class="btn"
								onclick={() => nerveStep(1)}
								disabled={activeCanal.active >= activeCanal.points.length - 1}
							>
								Next point ▶
							</button>
							<button class="btn" onclick={nerveNewPoint}>New point</button>
							<button class="btn" onclick={nerveDeletePoint} disabled={activeCanal.points.length <= 2}>
								Delete point
							</button>
							<button class="btn" onclick={nerveRedetect}>Re-detect path</button>
							<button
								class="btn"
								title="Revert this canal to the points originally proposed by the AI assistant"
								disabled={!canalProposed[canalTab]}
								onclick={() => {
									const orig = canalProposed[canalTab];
									if (!orig || !canals[canalTab]) return;
									canals[canalTab].points = orig.map((p) => ({ ...p }));
									canals[canalTab].active = 0;
									nerveNote = 'Reset to the AI proposal';
								}}
							>
								Reset
							</button>
							<span class="muted">
								point {activeCanal.active + 1} / {activeCanal.points.length}
							</span>
						</div>
						{#if nerveNote}<div class="aw-note">{nerveNote}</div>{/if}
					{:else if step.key === 'scan' && geom && activeScan}
						<div class="aw-tabs">
							{#each scans as sc, t (sc.id)}
								<button class="aw-tab" class:active={t === scanTab} onclick={() => (scanTab = t)} title={sc.name}>
									{sc.name}
								</button>
							{/each}
						</div>
						<div class="aw-grid3">
							<SliceOverlayCanvas
								{cache} {geom} plane="axial" index={scanSlices.axial}
								version={overlayTick}
								draw={scanDraw('axial')} onscroll={scanScroll('axial')}
								label="Axial — slice {scanSlices.axial}" height={230}
							/>
							<SliceOverlayCanvas
								{cache} {geom} plane="coronal" index={scanSlices.coronal}
								version={overlayTick}
								draw={scanDraw('coronal')} onscroll={scanScroll('coronal')}
								label="Coronal — slice {scanSlices.coronal}" height={230}
							/>
							<SliceOverlayCanvas
								{cache} {geom} plane="sagittal" index={scanSlices.sagittal}
								version={overlayTick}
								draw={scanDraw('sagittal')} onscroll={scanScroll('sagittal')}
								label="Sagittal — slice {scanSlices.sagittal}" height={230}
							/>
						</div>
						<div class="aw-row">
							<button class="btn" onclick={() => (fineAlignOpen = true)}>Fine alignment…</button>
							<button class="btn" onclick={resetScanAlignment}>Reset alignment</button>
							<button
								class="btn"
								class:primary={!scanAccepted[activeScan.id]}
								onclick={() => (scanAccepted[activeScan.id] = !scanAccepted[activeScan.id])}
							>
								{scanAccepted[activeScan.id] ? '✓ Alignment accepted' : 'Accept alignment'}
							</button>
							<span class="muted">scroll over a view to change its slice</span>
						</div>
						{#if !meshPositions[activeScan.id]}
							<div class="aw-note">Loading the scan mesh…</div>
						{/if}
					{/if}
				{/if}
			</section>
		</div>

		<div class="dialog-actions aw-actions">
			<span class="aw-status muted">
				{selectedIds.length} of {aiModels.length} objects selected
				{#if bundle?.plan.locked}· plan is locked — pano/nerves will not be saved{/if}
			</span>
			<button class="btn" onclick={onclose} disabled={importing}>Cancel</button>
			<button class="btn" onclick={() => (stepIdx = Math.max(0, stepIdx - 1))} disabled={stepIdx === 0 || importing}>
				Back
			</button>
			<button
				class="btn"
				onclick={() => (stepIdx = Math.min(steps.length - 1, stepIdx + 1))}
				disabled={stepIdx >= steps.length - 1 || importing}
			>
				Next
			</button>
			<button
				class="btn primary"
				onclick={importReviewed}
				disabled={selectedIds.length === 0 || importing || loading}
			>
				{importing ? 'Importing…' : 'Import reviewed data'}
			</button>
		</div>
	</div>
</div>

{#if fineAlignOpen && activeScan}
	<!-- FineAlignDialog floats at z-index 90; lift it above the wizard backdrop (100) -->
	<div class="aw-fine">
		<FineAlignDialog name={activeScan.name} onnudge={applyNudge} onclose={() => (fineAlignOpen = false)} />
	</div>
{/if}

<style>
	.aw-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.aw-dialog {
		width: min(1180px, 96vw);
		height: min(800px, 94vh);
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
	}
	.aw-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.aw-close {
		padding: 0 6px;
	}
	.aw-body {
		flex: 1;
		display: grid;
		grid-template-columns: 250px 1fr;
		min-height: 0;
	}
	.aw-rail {
		border-right: 1px solid var(--border-soft);
		background: var(--bg-1);
		padding: 10px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
	}
	.aw-step {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: var(--radius);
		text-align: left;
		color: var(--text);
	}
	.aw-step:hover,
	.aw-substep:hover {
		background: var(--bg-3);
	}
	.aw-step.current {
		background: var(--accent-dim);
	}
	.aw-step-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.aw-step-title {
		font-size: 13px;
		font-weight: 600;
	}
	.aw-step-sub {
		font-size: 11px;
		color: var(--text-dim);
	}
	.aw-check {
		flex: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1.5px solid var(--border);
		display: grid;
		place-items: center;
		font-size: 12px;
		color: transparent;
	}
	.aw-check.done {
		border-color: var(--green);
		color: var(--green);
	}
	.aw-check.small {
		width: 15px;
		height: 15px;
		font-size: 10px;
	}
	.aw-substep {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: 26px;
		padding: 5px 8px;
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--text-dim);
		text-align: left;
	}
	.aw-substep.current {
		background: var(--bg-3);
		color: var(--text);
	}
	.aw-substep-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 160px;
	}
	.aw-main {
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.aw-caption {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim);
	}
	.aw-loading {
		display: grid;
		place-items: center;
		flex: 1;
		color: var(--text-dim);
	}
	.aw-grid3 {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.aw-grid2 {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}
	.aw-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 12px;
	}
	.aw-angle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
		margin: 0;
		color: var(--text);
	}
	.aw-angle input {
		width: 64px;
		padding: 4px 6px;
	}
	.aw-slider {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
		margin: 0;
		color: var(--text);
		flex: 1;
	}
	.aw-slider input {
		flex: 1;
	}
	.aw-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.aw-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 12px;
		border: 1px solid var(--border-soft);
		background: var(--bg-1);
		color: var(--text-dim);
		font-size: 12px;
	}
	.aw-pill.on {
		border-color: var(--accent);
		color: var(--text);
		background: var(--bg-3);
	}
	.aw-pill.bad {
		opacity: 0.55;
		text-decoration: line-through;
	}
	.aw-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
	.aw-warn {
		color: #e0a04d;
		text-decoration: none;
	}
	.aw-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border-soft);
	}
	.aw-tab {
		padding: 6px 14px;
		font-size: 12px;
		color: var(--text-dim);
		border-bottom: 2px solid transparent;
	}
	.aw-tab.active {
		color: var(--accent-bright);
		border-bottom-color: var(--accent-bright);
	}
	.aw-note {
		font-size: 12px;
		opacity: 0.8;
		border-left: 3px solid var(--border-soft);
		padding-left: 10px;
	}
	.aw-ok {
		color: var(--green);
		font-size: 12px;
	}
	.aw-pano-strip {
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		background: #06080b;
		overflow-x: auto;
	}
	.aw-pano-strip img {
		display: block;
		height: 130px;
		image-rendering: auto;
	}
	.aw-actions {
		align-items: center;
	}
	.aw-fine {
		position: fixed;
		inset: 0;
		z-index: 110;
		pointer-events: none;
	}
	.aw-fine > :global(.fa-panel) {
		pointer-events: auto;
		z-index: 110;
	}
	.aw-status {
		margin-right: auto;
		font-size: 12px;
	}
</style>
