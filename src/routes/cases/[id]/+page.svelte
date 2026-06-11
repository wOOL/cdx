<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import SliceView from '$lib/components/viewers/SliceView.svelte';
	import VolumeView from '$lib/components/viewers/VolumeView.svelte';
	import PanoView from '$lib/components/viewers/PanoView.svelte';
	import CrossView from '$lib/components/viewers/CrossView.svelte';
	import { PlanningState, WINDOW_PRESETS } from '$lib/client/planning.svelte';
	import AdjustGrayscale from '$lib/components/AdjustGrayscale.svelte';
	import { indexAtLength } from '$lib/curve';
	import type { ToolPointerEvent, ViewTransform } from '$lib/client/render2d';
	import {
		crossTool,
		drawAxialObjects,
		drawCrossOverlay,
		drawMeasurements,
		drawPanoOverlay,
		measureAxialTool,
		panoTool
	} from '$lib/client/planTools';
	import {
		FDI_LOWER,
		FDI_UPPER,
		IMPLANT_LIBRARY,
		SLEEVE_SYSTEMS,
		articleName,
		defaultSleeve,
		drillLength,
		implantColor
	} from '$lib/implantLibrary';
	import { composeMat4, icp, kabsch } from '$lib/registration';
	import { extractSurfacePoints } from '$lib/client/icpTargets';
	import type { Vec3 } from '$lib/geometry';

	let { data } = $props();

	const stages = [
		{ key: 'data', label: 'Data', icon: 'import' },
		{ key: 'align', label: 'Align', icon: 'rotate' },
		{ key: 'pano', label: 'Panoramic', icon: 'pano' },
		{ key: 'nerve', label: 'Nerve', icon: 'nerve' },
		{ key: 'implant', label: 'Implants', icon: 'implant' },
		{ key: 'sleeve', label: 'Sleeves', icon: 'volume' },
		{ key: 'guide', label: 'Guide', icon: 'guide' },
		{ key: 'report', label: 'Report', icon: 'report' }
	] as const;

	type StageKey = (typeof stages)[number]['key'];

	let hasVolume = $derived(data.datasets.length > 0);
	let stage = $state<StageKey>('data');
	let ps = $derived(
		data.datasets[0]
			? new PlanningState(
					data.datasets[0],
					data.plan,
					data.nerves,
					data.implants,
					data.models,
					data.measurements,
					data.settings
				)
			: null
	);

	// deep snapshot so canvas overlays redraw on any object change
	let objectsVersion = $derived(
		ps
			? JSON.stringify([
					ps.nerves,
					ps.implants,
					ps.selectedImplantId,
					ps.activeNerveId,
					ps.nerveEditMode,
					ps.warnings.length,
					ps.measurements,
					ps.pendingMeasure,
					ps.measureTool
				])
			: ''
	);

	// move off the data stage automatically once a volume exists
	$effect(() => {
		if (hasVolume && stage === 'data') stage = 'pano';
	});

	// stage-bound edit modes
	$effect(() => {
		if (stage !== 'pano' && ps) ps.curveEditMode = false;
		if (stage !== 'nerve' && ps) ps.nerveEditMode = false;
	});

	// EASY-mode-style progress: which stages have their artifact
	let stageDone = $derived<Record<StageKey, boolean>>({
		data: hasVolume,
		align: !!ps && ps.models.some((m) => m.kind === 'segmentation' || (m.kind === 'scan' && m.transform)),
		pano: !!ps && ps.curveControl.length >= 3,
		nerve: !!ps && ps.nerves.some((n) => n.points.length >= 2),
		implant: !!ps && ps.implants.length > 0,
		sleeve: !!ps && ps.implants.length > 0 && ps.implants.every((i) => i.sleeve),
		guide: !!ps && ps.models.some((m) => m.kind === 'guide'),
		report: !!data.plan.approved
	});

	let nextHint = $derived.by(() => {
		if (!hasVolume) return 'Import DICOM data to begin';
		if (!stageDone.pano) return 'Draw the panoramic curve (Panoramic stage)';
		if (!stageDone.nerve) return 'Mark the mandibular nerve (Nerve stage)';
		if (!stageDone.implant) return 'Place implants (Implants stage)';
		if (!stageDone.sleeve) return 'Assign sleeves (Sleeves stage)';
		if (!stageDone.guide) return 'Generate the surgical guide (Guide stage)';
		if (!stageDone.report) return 'Review and approve the plan, then print the report';
		return 'Plan complete';
	});

	// ---------- panoramic curve editing on the axial view ----------
	let dragPointIndex = -1;

	function curveOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps) return;
		const sx = ps.ds.spacing_x;
		const sy = ps.ds.spacing_y;
		const toCanvas = (mmx: number, mmy: number) => ({
			x: t.ox + (mmx / sx + 0.5) * t.scaleX,
			y: t.oy + (mmy / sy + 0.5) * t.scaleY
		});

		const c = ps.curve;
		if (c) {
			ctx.strokeStyle = 'rgba(69, 184, 224, 0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			c.points.forEach((p, i) => {
				const q = toCanvas(p.x, p.y);
				if (i === 0) ctx.moveTo(q.x, q.y);
				else ctx.lineTo(q.x, q.y);
			});
			ctx.stroke();

			// cross-section position marker on the curve
			const ci = indexAtLength(c, ps.crossU);
			const cp = c.points[ci];
			const cn = c.normals[ci];
			const q = toCanvas(cp.x, cp.y);
			const q2 = toCanvas(cp.x + cn.x * 6, cp.y + cn.y * 6);
			const q3 = toCanvas(cp.x - cn.x * 6, cp.y - cn.y * 6);
			ctx.strokeStyle = 'rgba(240, 138, 36, 0.95)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(q3.x, q3.y);
			ctx.lineTo(q2.x, q2.y);
			ctx.stroke();
			ctx.fillStyle = 'rgba(240, 138, 36, 0.95)';
			ctx.beginPath();
			ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		for (const p of ps.curveControl) {
			const q = toCanvas(p.x, p.y);
			ctx.fillStyle = ps.curveEditMode ? 'rgba(69, 184, 224, 1)' : 'rgba(69, 184, 224, 0.6)';
			ctx.beginPath();
			ctx.arc(q.x, q.y, ps.curveEditMode ? 4 : 3, 0, Math.PI * 2);
			ctx.fill();
			if (ps.curveEditMode) {
				ctx.strokeStyle = '#0b0d10';
				ctx.lineWidth = 1;
				ctx.stroke();
			}
		}
	}

	function curveTool(e: ToolPointerEvent): boolean {
		if (!ps || !ps.curveEditMode || ps.locked) return false;
		const mm = { x: e.px * ps.ds.spacing_x, y: e.py * ps.ds.spacing_y };
		if (e.type === 'down') {
			const idx = ps.curveControl.findIndex((p) => Math.hypot(p.x - mm.x, p.y - mm.y) < 2.5);
			if (idx >= 0) {
				dragPointIndex = idx;
			} else {
				ps.curveControl.push(mm);
				dragPointIndex = ps.curveControl.length - 1;
				ps.curveZ = ps.cursor.z;
			}
			ps.saveCurve();
			return true;
		}
		if (e.type === 'move' && dragPointIndex >= 0) {
			ps.curveControl[dragPointIndex] = mm;
			ps.saveCurve();
			return true;
		}
		if (e.type === 'up') {
			dragPointIndex = -1;
			return true;
		}
		return false;
	}

	function undoCurvePoint() {
		if (!ps) return;
		ps.curveControl.pop();
		ps.saveCurve();
	}
	function clearCurve() {
		if (!ps) return;
		if (ps.curveControl.length && !confirm('Clear the panoramic curve?')) return;
		ps.curveControl.length = 0;
		ps.saveCurve();
	}

	// ---------- combined overlays ----------
	function axialOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		curveOverlay(ctx, t);
		if (ps) {
			drawAxialObjects(ps, ctx, t);
			drawMeasurements(ps, ctx, t);
		}
	}

	function axialTool(e: ToolPointerEvent): boolean {
		if (!ps) return false;
		if (measureAxialTool(ps, e)) return true;
		return curveTool(e);
	}

	// ---------- nerve tools ----------
	async function addNerve(side: 'left' | 'right') {
		if (!ps) return;
		const existing = ps.nerves.length;
		await ps.addNerve(
			`N. alveolaris inf. ${side}`,
			existing % 2 === 0 ? '#e8d44d' : '#d4a24d'
		);
	}

	// ---------- implant tools ----------
	let implantDialog: HTMLDialogElement | undefined = $state();
	let newImplant = $state({
		tooth: '36',
		lineIndex: 0,
		diameter: IMPLANT_LIBRARY[0].diameters[3] ?? 4.1,
		length: IMPLANT_LIBRARY[0].lengths[2] ?? 10
	});

	function openImplantDialog() {
		if (!ps) return;
		implantDialog?.showModal();
	}

	async function confirmAddImplant() {
		if (!ps) return;
		const line = IMPLANT_LIBRARY[newImplant.lineIndex];
		const c = ps.curve;
		let head = {
			x: (ps.ds.cols * ps.ds.spacing_x) / 2,
			y: (ps.ds.rows * ps.ds.spacing_y) / 2,
			z: ps.cursor.z * ps.ds.spacing_z
		};
		if (c) {
			const i = indexAtLength(c, ps.crossU);
			head = { x: c.points[i].x, y: c.points[i].y, z: ps.cursor.z * ps.ds.spacing_z };
		}
		await ps.addImplant({
			tooth: newImplant.tooth,
			manufacturer: line.manufacturer,
			line: line.line,
			article: articleName(line, newImplant.diameter, newImplant.length),
			diameter: newImplant.diameter,
			length: newImplant.length,
			color: implantColor(ps.implants.length),
			head
		});
		implantDialog?.close();
	}

	function deleteSelectedImplant() {
		if (!ps?.selectedImplantId) return;
		const im = ps.implants.find((i) => i.id === ps?.selectedImplantId);
		if (im && confirm(`Remove implant ${im.tooth ? `at ${im.tooth}` : ''} (${im.article})?`)) {
			ps.deleteImplant(im.id);
		}
	}

	let selectedImplant = $derived(ps?.implants.find((i) => i.id === ps?.selectedImplantId) ?? null);

	// cross-section group (3 parallel slices like coDiagnostiX)
	let crossGroupMode = $state(false);
	let crossSpacing = $state(2);

	let grayscaleOpen = $state(false);

	// ---------- implant fine controls ----------
	function stepImplantDim(field: 'diameter' | 'length', dir: 1 | -1) {
		if (!ps || !selectedImplant || ps.locked) return;
		const line = IMPLANT_LIBRARY.find(
			(l) => l.manufacturer === selectedImplant?.manufacturer && l.line === selectedImplant?.line
		);
		if (!line) return;
		const list = field === 'diameter' ? line.diameters : line.lengths;
		const idx = list.indexOf(selectedImplant[field]);
		const next = list[(idx < 0 ? 0 : idx) + dir];
		if (next == null) return;
		selectedImplant[field] = next;
		selectedImplant.article = articleName(line, selectedImplant.diameter, selectedImplant.length);
		ps.saveImplant(selectedImplant.id);
	}

	function nudgeImplantDepth(deltaMM: number) {
		if (!ps || !selectedImplant || ps.locked) return;
		selectedImplant.x += selectedImplant.ax * deltaMM;
		selectedImplant.y += selectedImplant.ay * deltaMM;
		selectedImplant.z += selectedImplant.az * deltaMM;
		ps.saveImplant(selectedImplant.id);
	}

	function parallelizeImplant() {
		if (!ps || !selectedImplant || ps.locked) return;
		const other = ps.implants.find((i) => i.id !== selectedImplant?.id);
		if (!other) return;
		selectedImplant.ax = other.ax;
		selectedImplant.ay = other.ay;
		selectedImplant.az = other.az;
		ps.saveImplant(selectedImplant.id);
	}

	// bone density around the selected implant
	let densityInfo = $state<{ mean: number; min: number; max: number } | null>(null);
	let densityTimer: ReturnType<typeof setTimeout>;

	function boneClass(meanHU: number): string {
		if (meanHU > 1250) return 'D1';
		if (meanHU > 850) return 'D2';
		if (meanHU > 350) return 'D3';
		if (meanHU > 150) return 'D4';
		return 'D5';
	}

	$effect(() => {
		const im = selectedImplant;
		if (!ps || !im) {
			densityInfo = null;
			return;
		}
		const payload = {
			head: { x: im.x, y: im.y, z: im.z },
			axis: { x: im.ax, y: im.ay, z: im.az },
			length: im.length,
			radius: im.diameter / 2 + 1
		};
		clearTimeout(densityTimer);
		densityTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/datasets/${ps.ds.id}/density`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});
				if (res.ok) densityInfo = await res.json();
			} catch {
				densityInfo = null;
			}
		}, 300);
	});

	// ---------- hotkeys ----------
	function onKeydown(e: KeyboardEvent) {
		if (!ps) return;
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
			return;
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			ps.cursor.z = Math.max(
				0,
				Math.min(ps.ds.slices - 1, ps.cursor.z + (e.key === 'ArrowUp' ? 1 : -1))
			);
			e.preventDefault();
		} else if (e.key === 'PageUp' || e.key === 'PageDown') {
			ps.cursor.z = Math.max(
				0,
				Math.min(ps.ds.slices - 1, ps.cursor.z + (e.key === 'PageUp' ? 5 : -5))
			);
			e.preventDefault();
		} else if (e.key === 'Delete' && ps.selectedImplantId) {
			deleteSelectedImplant();
		} else if (e.key === 'Escape') {
			ps.curveEditMode = false;
			ps.nerveEditMode = false;
			ps.measureTool = 'none';
			ps.pendingMeasure.length = 0;
			ps.selectedImplantId = null;
		} else if (/^[1-7]$/.test(e.key) && hasVolume) {
			const idx = Number(e.key) - 1;
			const s = stages[idx];
			if (s && s.key !== 'report') stage = s.key;
		}
	}

	// ---------- plan management ----------
	let planMenuOpen = $state(false);

	async function duplicatePlanAction() {
		planMenuOpen = false;
		const name = prompt('Name for the new plan:', `${data.plan.name} (copy)`);
		if (!name) return;
		const res = await fetch(`/api/cases/${data.caseData.id}/plans`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, copyFrom: data.plan.id })
		});
		if (res.ok) {
			const { plan } = await res.json();
			await goto(`/cases/${data.caseData.id}?plan=${plan.id}`, { invalidateAll: true });
		}
	}

	async function renamePlanAction() {
		planMenuOpen = false;
		const name = prompt('Plan name:', data.plan.name);
		if (!name || name === data.plan.name) return;
		await fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		});
		await invalidateAll();
	}

	async function togglePlanFlag(flag: 'locked' | 'approved') {
		planMenuOpen = false;
		await fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ [flag]: flag === 'locked' ? !data.plan.locked : !data.plan.approved })
		});
		await invalidateAll();
	}

	async function deletePlanAction() {
		planMenuOpen = false;
		if (!confirm(`Delete plan "${data.plan.name}"?`)) return;
		const res = await fetch(`/api/plans/${data.plan.id}`, { method: 'DELETE' });
		if (res.ok) await goto(`/cases/${data.caseData.id}`, { invalidateAll: true });
	}

	// ---------- scan matching (align stage) ----------
	let alignVolView = $state<ReturnType<typeof VolumeView>>();
	let matching = $state<{
		modelId: number | null;
		mode: 'idle' | 'pick-scan' | 'pick-volume';
		pairs: { scan: Vec3; vol?: Vec3 }[];
		busy: string;
		lastRms: number | null;
	}>({ modelId: null, mode: 'idle', pairs: [], busy: '', lastRms: null });

	let scanModels = $derived(ps?.models.filter((m) => m.kind === 'scan') ?? []);
	let completePairs = $derived(matching.pairs.filter((p) => p.vol));

	function onScanMeshClick(e: { modelId: number; scanLocal: Vec3; volumeLocal: Vec3 }) {
		if (matching.mode !== 'pick-scan') return;
		if (matching.modelId == null) matching.modelId = e.modelId;
		if (e.modelId !== matching.modelId) return;
		matching.pairs.push({ scan: e.scanLocal });
		matching.mode = 'pick-volume';
	}

	let cursorBaseline = '';
	$effect(() => {
		if (!ps) return;
		const key = `${ps.cursor.x},${ps.cursor.y},${ps.cursor.z}`;
		if (matching.mode === 'pick-volume') {
			if (cursorBaseline === '') {
				cursorBaseline = key;
				return;
			}
			if (key !== cursorBaseline) {
				const pair = matching.pairs[matching.pairs.length - 1];
				if (pair && !pair.vol) pair.vol = ps.toMM(ps.cursor);
				matching.mode = 'idle';
				cursorBaseline = '';
			}
		} else {
			cursorBaseline = '';
		}
	});

	function computeAlignment() {
		if (!ps || matching.modelId == null || completePairs.length < 3) return;
		const m = ps.models.find((m) => m.id === matching.modelId);
		if (!m) return;
		m.transform = kabsch(
			completePairs.map((p) => p.scan),
			completePairs.map((p) => p.vol!)
		);
		ps.saveModel(m.id);
		matching.lastRms = null;
	}

	async function refineICP() {
		if (!ps || matching.modelId == null || !alignVolView) return;
		const m = ps.models.find((m) => m.id === matching.modelId);
		if (!m || !m.transform) return;
		matching.busy = 'Extracting bone surface…';
		try {
			const targets = await extractSurfacePoints(ps.ds, 300);
			const raw = alignVolView.getModelPositions(m.id);
			if (!raw || targets.length === 0) return;
			matching.busy = 'Running ICP…';
			await new Promise((r) => setTimeout(r, 30)); // let the UI paint
			const t = m.transform;
			const stride = Math.max(1, Math.floor(raw.length / 3 / 3000)) * 3;
			const source: Vec3[] = [];
			for (let i = 0; i < raw.length; i += stride) {
				// apply current transform (column-major mat4)
				const x = raw[i];
				const y = raw[i + 1];
				const z = raw[i + 2];
				source.push({
					x: t[0] * x + t[4] * y + t[8] * z + t[12],
					y: t[1] * x + t[5] * y + t[9] * z + t[13],
					z: t[2] * x + t[6] * y + t[10] * z + t[14]
				});
			}
			// coarse-to-fine: wide gate first, then tight gate to shed outlier pairs
			const coarse = icp(source, targets, { maxPairDistance: 6, maxIterations: 30 });
			const refined = source.map((p) => {
				const t1 = coarse.transform;
				return {
					x: t1[0] * p.x + t1[4] * p.y + t1[8] * p.z + t1[12],
					y: t1[1] * p.x + t1[5] * p.y + t1[9] * p.z + t1[13],
					z: t1[2] * p.x + t1[6] * p.y + t1[10] * p.z + t1[14]
				};
			});
			const fine = icp(refined, targets, { maxPairDistance: 1.2, maxIterations: 30 });
			const delta = composeMat4(fine.transform, coarse.transform);
			m.transform = composeMat4(delta, t);
			matching.lastRms = isFinite(fine.rms) ? fine.rms : coarse.rms;
			ps.saveModel(m.id);
		} finally {
			matching.busy = '';
		}
	}

	function resetMatching() {
		matching.pairs = [];
		matching.mode = 'idle';
		matching.lastRms = null;
	}

	// ---------- guide generation ----------
	let guideParams = $state({ offset: 0.15, thickness: 2.5, regionRadius: 9 });
	let guideInsertion = $state<'auto' | 'vertical'>('auto');
	let guideBusy = $state(false);
	let guideError = $state('');
	let guideBaseId = $state<number | null>(null);

	let guideBases = $derived(
		ps?.models.filter((m) => m.kind === 'scan' || m.kind === 'segmentation') ?? []
	);
	let guideModels = $derived(ps?.models.filter((m) => m.kind === 'guide') ?? []);

	async function generateGuideAction() {
		if (!ps) return;
		const baseId = guideBaseId ?? guideBases[0]?.id;
		if (!baseId) return;
		guideBusy = true;
		guideError = '';
		try {
			const res = await fetch(`/api/cases/${data.caseData.id}/guide`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					modelId: baseId,
					planId: ps.planId,
					params: guideParams,
					insertion: guideInsertion
				})
			});
			const bodyJson = await res.json().catch(() => null);
			if (!res.ok) throw new Error(bodyJson?.message ?? `Guide generation failed (${res.status})`);
			ps.models.push({
				id: bodyJson.model.id,
				name: bodyJson.model.name,
				kind: 'guide',
				color: bodyJson.model.color,
				opacity: bodyJson.model.opacity,
				visible: true,
				transform: null
			});
		} catch (e) {
			guideError = e instanceof Error ? e.message : 'Guide generation failed';
		} finally {
			guideBusy = false;
		}
	}

	// ---------- bone segmentation ----------
	let segThreshold = $state(300);
	let segBusy = $state(false);

	async function createBoneModel() {
		if (!ps) return;
		segBusy = true;
		try {
			const res = await fetch(`/api/datasets/${ps.ds.id}/segment`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ threshold: segThreshold })
			});
			if (res.ok) {
				const { model } = await res.json();
				ps.models.push({
					id: model.id,
					name: model.name,
					kind: model.kind,
					color: model.color,
					opacity: model.opacity,
					visible: true,
					transform: null
				});
			}
		} finally {
			segBusy = false;
		}
	}

	// ---------- DICOM upload ----------
	let uploading = $state(false);
	let uploadError = $state('');
	let dragOver = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	async function uploadFiles(files: FileList | File[]) {
		const list = Array.from(files);
		if (list.length === 0) return;
		uploading = true;
		uploadError = '';
		try {
			// route surface scans (.stl/.ply/.obj) to model import, the rest to DICOM
			const modelFiles = list.filter((f) => /\.(stl|ply|obj)$/i.test(f.name));
			const dicomFiles = list.filter((f) => !/\.(stl|ply|obj)$/i.test(f.name));

			for (const f of modelFiles) {
				if (ps) {
					const m = await ps.uploadModel(f, 'scan');
					if (!m) throw new Error(`Model import failed for ${f.name}`);
				} else {
					const form = new FormData();
					form.append('file', f);
					form.append('kind', 'scan');
					const res = await fetch(`/api/cases/${data.caseData.id}/models`, {
						method: 'POST',
						body: form
					});
					if (!res.ok) throw new Error(`Model import failed for ${f.name}`);
				}
			}

			if (dicomFiles.length) {
				const form = new FormData();
				for (const f of dicomFiles) form.append('files', f);
				const res = await fetch(`/api/cases/${data.caseData.id}/import`, {
					method: 'POST',
					body: form
				});
				if (!res.ok) {
					const body = await res.json().catch(() => null);
					throw new Error(body?.message ?? `Import failed (${res.status})`);
				}
			}
			await invalidateAll();
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Import failed';
		} finally {
			uploading = false;
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
	}
</script>

<svelte:head>
	<title>{data.patient.last_name}, {data.patient.first_name} — {data.caseData.title}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<header class="case-bar">
	<a class="btn ghost" href="/?sel={data.patient.id}" title="Back to patient database">
		<Icon name="back" size={18} />
	</a>
	<div class="case-id">
		<div class="case-patient">
			{data.patient.last_name}, {data.patient.first_name}
			<span class="faint">{data.patient.external_id ? `· ID ${data.patient.external_id}` : ''}</span>
		</div>
		<div class="case-title-row">
			<span class="muted">{data.caseData.title}</span>
			<span class="badge {data.caseData.status}">{data.caseData.status}</span>
		</div>
	</div>

	<nav class="stage-bar">
		{#each stages as s (s.key)}
			{#if s.key === 'report'}
				<a class="tool-btn" class:disabled={!hasVolume} href="/cases/{data.caseData.id}/report">
					{#if stageDone[s.key]}<span class="stage-check"><Icon name="check" size={10} /></span>{/if}
					<Icon name={s.icon} size={20} />
					<span>{s.label}</span>
				</a>
			{:else}
				<button
					class="tool-btn"
					class:active={stage === s.key}
					disabled={s.key !== 'data' && !hasVolume}
					onclick={() => (stage = s.key)}
				>
					{#if stageDone[s.key]}<span class="stage-check"><Icon name="check" size={10} /></span>{/if}
					<Icon name={s.icon} size={20} />
					<span>{s.label}</span>
				</button>
			{/if}
		{/each}
	</nav>

	<div class="spacer"></div>
	<a
		class="btn ghost"
		href="/api/cases/{data.caseData.id}/export"
		title="Export case archive (zip)"
	>
		<Icon name="export" size={16} />
	</a>
	{#if ps?.locked}
		<span class="badge planning" title="This plan is locked — editing disabled">🔒 locked</span>
	{/if}
	{#if data.plan.approved}
		<span class="badge finalized">approved</span>
	{/if}
	<div class="plan-menu-wrap">
		<button class="plan-chip" onclick={() => (planMenuOpen = !planMenuOpen)} title="Plans">
			{data.plan.name} <Icon name="chevron-down" size={12} />
		</button>
		{#if planMenuOpen}
			<div class="plan-menu panel">
				{#each data.plans as p (p.id)}
					<a
						class="plan-menu-item"
						class:active={p.id === data.plan.id}
						href="/cases/{data.caseData.id}?plan={p.id}"
						onclick={() => (planMenuOpen = false)}
					>
						<span>{p.name}</span>
						<span class="faint">
							{p.is_master ? 'master' : ''}{p.locked ? ' 🔒' : ''}{p.approved ? ' ✓' : ''}
						</span>
					</a>
				{/each}
				<div class="plan-menu-sep"></div>
				<button class="plan-menu-item" onclick={duplicatePlanAction}>Duplicate this plan</button>
				<button class="plan-menu-item" onclick={renamePlanAction}>Rename…</button>
				<button class="plan-menu-item" onclick={() => togglePlanFlag('locked')}>
					{data.plan.locked ? 'Unlock plan' : 'Lock plan'}
				</button>
				<button class="plan-menu-item" onclick={() => togglePlanFlag('approved')}>
					{data.plan.approved ? 'Revoke approval' : 'Approve plan'}
				</button>
				{#if !data.plan.is_master}
					<button class="plan-menu-item danger-item" onclick={deletePlanAction}>Delete plan</button>
				{/if}
			</div>
		{/if}
	</div>
</header>

<div class="workspace">
	<aside class="object-tree panel">
		<div class="panel-header">Objects</div>
		<div class="tree">
			<div class="tree-group">
				<div class="tree-group-label">Volume data</div>
				{#each data.datasets as d (d.id)}
					<div class="tree-item">
						<Icon name="volume" size={14} />
						<span title={d.series_description}>{d.modality || 'CT'} {d.cols}×{d.rows}×{d.slices}</span>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Models</div>
				{#each ps?.models ?? [] as m (m.id)}
					<div class="tree-item">
						<span class="dot" style="background:{m.color}"></span>
						<span class="tree-item-label" title={m.kind}>{m.name}</span>
						<button
							class="tree-eye"
							title="Toggle visibility"
							onclick={() => {
								m.visible = !m.visible;
								ps?.saveModel(m.id);
							}}
						>
							<Icon name={m.visible ? 'eye' : 'eye-off'} size={13} />
						</button>
						<button
							class="tree-eye"
							title="Delete model"
							onclick={() => confirm(`Delete model "${m.name}"?`) && ps?.deleteModel(m.id)}
						>
							<Icon name="trash" size={13} />
						</button>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Implants</div>
				{#each ps?.implants ?? [] as im (im.id)}
					<div
						class="tree-item tree-clickable"
						class:tree-selected={ps?.selectedImplantId === im.id}
						role="button"
						tabindex="0"
						onclick={() => ps && (ps.selectedImplantId = im.id)}
						onkeydown={(e) => e.key === 'Enter' && ps && (ps.selectedImplantId = im.id)}
					>
						<span class="dot" style="background:{im.color}"></span>
						<span class="tree-item-label"
							>{im.tooth ? `${im.tooth} — ` : ''}⌀{im.diameter}×{im.length}</span
						>
						<button
							class="tree-eye"
							title="Toggle visibility"
							onclick={(e) => {
								e.stopPropagation();
								im.visible = !im.visible;
								ps?.saveImplant(im.id);
							}}
						>
							<Icon name={im.visible ? 'eye' : 'eye-off'} size={13} />
						</button>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Nerves</div>
				{#each ps?.nerves ?? [] as n (n.id)}
					<div class="tree-item">
						<span class="dot" style="background:{n.color}"></span>
						<span class="tree-item-label">{n.name}</span>
						<button
							class="tree-eye"
							title="Toggle visibility"
							onclick={() => {
								n.visible = !n.visible;
								ps?.saveNerve(n.id);
							}}
						>
							<Icon name={n.visible ? 'eye' : 'eye-off'} size={13} />
						</button>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">Measurements</div>
				{#each ps?.measurements ?? [] as m (m.id)}
					<div class="tree-item">
						<Icon name={m.type === 'angle' ? 'angle' : 'ruler'} size={14} />
						<span class="tree-item-label">{m.label || m.type}</span>
						<button class="tree-eye" title="Delete" onclick={() => ps?.deleteMeasurement(m.id)}>
							<Icon name="trash" size={13} />
						</button>
					</div>
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
		</div>

		{#if ps}
			<div class="view-controls">
				<div class="panel-header">View</div>
				<div class="view-controls-body">
					<label for="wl-preset">Window preset</label>
					<select
						id="wl-preset"
						onchange={(e) => {
							const p = WINDOW_PRESETS.find((p) => p.name === e.currentTarget.value);
							if (p && ps) {
								ps.wc = p.wc;
								ps.ww = p.ww;
							}
						}}
					>
						{#each WINDOW_PRESETS as p (p.name)}
							<option value={p.name} selected={p.wc === ps.wc && p.ww === ps.ww}>{p.name}</option>
						{/each}
					</select>
					<button class="btn" onclick={() => (grayscaleOpen = true)}>Adjust grayscale…</button>
					<label class="checkbox-row">
						<input type="checkbox" bind:checked={ps.crosshairVisible} />
						<span>Crosshair</span>
					</label>
					<label for="measure-tools">Measure (axial view)</label>
					<div class="measure-row" id="measure-tools">
						<button
							class="btn"
							class:primary={ps.measureTool === 'distance'}
							title="Distance: click two points"
							onclick={() => {
								if (!ps) return;
								ps.pendingMeasure.length = 0;
								ps.measureTool = ps.measureTool === 'distance' ? 'none' : 'distance';
							}}
						>
							<Icon name="ruler" size={14} />
						</button>
						<button
							class="btn"
							class:primary={ps.measureTool === 'angle'}
							title="Angle: click three points"
							onclick={() => {
								if (!ps) return;
								ps.pendingMeasure.length = 0;
								ps.measureTool = ps.measureTool === 'angle' ? 'none' : 'angle';
							}}
						>
							<Icon name="angle" size={14} />
						</button>
						<button
							class="btn"
							class:primary={ps.measureTool === 'density'}
							title="Density: click one point (HU)"
							onclick={() => {
								if (!ps) return;
								ps.pendingMeasure.length = 0;
								ps.measureTool = ps.measureTool === 'density' ? 'none' : 'density';
							}}
						>
							HU
						</button>
					</div>
				</div>
			</div>
		{/if}
	</aside>

	<main class="view-area">
		{#if stage === 'data' || !ps}
			<div class="data-stage">
				<div
					class="dropzone panel"
					class:drag-over={dragOver}
					role="button"
					tabindex="0"
					ondragover={(e) => {
						e.preventDefault();
						dragOver = true;
					}}
					ondragleave={() => (dragOver = false)}
					ondrop={onDrop}
					onclick={() => fileInput?.click()}
					onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
				>
					{#if uploading}
						<div class="spinner"></div>
						<h3>Importing DICOM…</h3>
						<p class="muted">Parsing slices and building the volume</p>
					{:else}
						<Icon name="import" size={44} />
						<h3>Import data</h3>
						<p class="muted">
							Drop DICOM files (.dcm / .zip) or model scans (.stl / .ply) here, or click to browse.<br />
							CT / CBCT with uncompressed transfer syntax; surface scans as STL or PLY.
						</p>
					{/if}
					<input
						type="file"
						multiple
						accept=".dcm,.zip,.stl,.ply,.obj,application/zip,application/dicom"
						bind:this={fileInput}
						onchange={(e) => e.currentTarget.files && uploadFiles(e.currentTarget.files)}
						hidden
					/>
				</div>
				{#if uploadError}
					<div class="upload-error"><Icon name="warning" size={16} /> {uploadError}</div>
				{/if}

				{#if data.datasets.length}
					<div class="dataset-list">
						{#each data.datasets as d (d.id)}
							<div class="dataset-card panel">
								<Icon name="volume" size={22} />
								<div>
									<div><strong>{d.series_description || d.description}</strong></div>
									<div class="faint">
										{d.modality} · {d.cols}×{d.rows}×{d.slices} ·
										{d.spacing_x.toFixed(2)}/{d.spacing_y.toFixed(2)}/{d.spacing_z.toFixed(2)} mm
										{d.patient_name ? ` · ${d.patient_name}` : ''}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="stage-tools">
				{#if stage === 'pano'}
					<button
						class="btn"
						class:primary={ps.curveEditMode}
						onclick={() => ps && (ps.curveEditMode = !ps.curveEditMode)}
					>
						<Icon name="edit" size={14} />
						{ps.curveEditMode ? 'Drawing curve — click along the arch' : 'Draw curve'}
					</button>
					<button class="btn" disabled={!ps.curveControl.length} onclick={undoCurvePoint}>
						Undo point
					</button>
					<button class="btn danger" disabled={!ps.curveControl.length} onclick={clearCurve}>
						Clear
					</button>
					<div class="tool-sep"></div>
					<label class="inline-label" for="pano-thickness">Slab</label>
					<input
						id="pano-thickness"
						type="range"
						min="0"
						max="8"
						step="0.5"
						bind:value={ps.panoThickness}
						style="width:90px"
					/>
					<span class="muted">{ps.panoThickness.toFixed(1)} mm</span>
				{:else if stage === 'align'}
					{#if scanModels.length}
						<span class="muted">Match scan:</span>
						{#if scanModels.length > 1}
							<select
								value={matching.modelId ?? scanModels[0]?.id}
								onchange={(e) => (matching.modelId = Number(e.currentTarget.value))}
							>
								{#each scanModels as m (m.id)}
									<option value={m.id}>{m.name}</option>
								{/each}
							</select>
						{/if}
						<button
							class="btn"
							class:primary={matching.mode !== 'idle'}
							onclick={() => {
								if (matching.modelId == null) matching.modelId = scanModels[0]?.id ?? null;
								matching.mode = 'pick-scan';
							}}
						>
							{matching.mode === 'pick-scan'
								? 'Click a point on the scan (3D view)…'
								: matching.mode === 'pick-volume'
									? 'Now click the same spot in a slice view…'
									: `Add point pair (${completePairs.length})`}
						</button>
						<button class="btn" disabled={!matching.pairs.length} onclick={() => matching.pairs.pop()}>
							Undo
						</button>
						<button class="btn" disabled={completePairs.length < 3} onclick={computeAlignment}>
							Align ({completePairs.length}/3)
						</button>
						<button
							class="btn"
							disabled={!ps.models.find((m) => m.id === matching.modelId)?.transform || !!matching.busy}
							onclick={refineICP}
						>
							{matching.busy || 'Refine fit (ICP)'}
						</button>
						<button class="btn" onclick={resetMatching}>Reset</button>
						{#if matching.lastRms != null}
							<span class="muted">fit RMS {matching.lastRms.toFixed(2)} mm</span>
						{/if}
						<div class="tool-sep"></div>
					{/if}
					<label class="inline-label" for="seg-th">Bone HU</label>
					<input id="seg-th" type="number" step="50" bind:value={segThreshold} style="width:70px" />
					<button class="btn" disabled={segBusy} onclick={createBoneModel}>
						<Icon name="volume" size={14} />
						{segBusy ? 'Segmenting…' : 'Create bone model'}
					</button>
				{:else if stage === 'nerve'}
					<button class="btn" onclick={() => addNerve('right')}>
						<Icon name="nerve" size={14} /> Add right nerve
					</button>
					<button class="btn" onclick={() => addNerve('left')}>
						<Icon name="nerve" size={14} /> Add left nerve
					</button>
					<div class="tool-sep"></div>
					{#each ps.nerves as n (n.id)}
						<div class="chip" class:chip-active={ps.activeNerveId === n.id && ps.nerveEditMode}>
							<span class="dot" style="background:{n.color}"></span>
							<button
								class="chip-label"
								title="Edit nerve points"
								onclick={() => {
									if (!ps) return;
									if (ps.activeNerveId === n.id) {
										ps.nerveEditMode = !ps.nerveEditMode;
									} else {
										ps.activeNerveId = n.id;
										ps.nerveEditMode = true;
									}
								}}>{n.name}</button
							>
							<input
								class="chip-num"
								type="number"
								min="1"
								max="5"
								step="0.5"
								value={n.diameter}
								title="Diameter (mm)"
								onchange={(e) => {
									n.diameter = Number(e.currentTarget.value) || 2;
									ps?.saveNerve(n.id);
								}}
							/>
							<button
								class="chip-x"
								title="Delete nerve"
								onclick={() => confirm(`Delete ${n.name}?`) && ps?.deleteNerve(n.id)}>×</button
							>
						</div>
					{/each}
					{#if ps.nerveEditMode}
						<span class="muted">Click in the panoramic or cross-section view to add nerve points</span>
					{/if}
				{:else if stage === 'implant'}
					<button class="btn primary" onclick={openImplantDialog}>
						<Icon name="implant" size={14} /> Add implant
					</button>
					{#if selectedImplant}
						<div class="tool-sep"></div>
						<span>
							<strong>{selectedImplant.tooth ? `Tooth ${selectedImplant.tooth} — ` : ''}</strong>
							{selectedImplant.manufacturer} {selectedImplant.article}
						</span>
						<span class="stepper">
							<button class="btn" title="Smaller diameter" onclick={() => stepImplantDim('diameter', -1)}>‹</button>
							⌀{selectedImplant.diameter.toFixed(1)}
							<button class="btn" title="Larger diameter" onclick={() => stepImplantDim('diameter', 1)}>›</button>
						</span>
						<span class="stepper">
							<button class="btn" title="Shorter" onclick={() => stepImplantDim('length', -1)}>‹</button>
							L{selectedImplant.length.toFixed(1)}
							<button class="btn" title="Longer" onclick={() => stepImplantDim('length', 1)}>›</button>
						</span>
						<button class="btn" title="Move 0.5 mm shallower (against axis)" onclick={() => nudgeImplantDepth(-0.5)}>
							▲ 0.5
						</button>
						<button class="btn" title="Move 0.5 mm deeper (along axis)" onclick={() => nudgeImplantDepth(0.5)}>
							▼ 0.5
						</button>
						{#if ps.implants.length > 1}
							<button class="btn" title="Align axis with the other implant" onclick={parallelizeImplant}>
								∥ Parallelize
							</button>
						{/if}
						{#if densityInfo}
							<span class="muted" title="Mean HU in a {(selectedImplant.diameter / 2 + 1).toFixed(1)} mm cylinder around the implant">
								bone {densityInfo.mean} HU ({boneClass(densityInfo.mean)})
							</span>
						{/if}
						<button class="btn danger" onclick={deleteSelectedImplant}>
							<Icon name="trash" size={14} /> Remove
						</button>
					{:else if ps.implants.length}
						<span class="muted">Click an implant in any view to select and drag it; handles tilt the axis</span>
					{/if}
				{:else if stage === 'sleeve'}
					{#if !ps.implants.length}
						<span class="muted">Place implants first — sleeves are assigned per implant.</span>
					{:else}
						<button
							class="btn"
							disabled={ps.implants.every((i) => i.sleeve)}
							onclick={() => {
								if (!ps) return;
								for (const im of ps.implants) {
									if (!im.sleeve) {
										im.sleeve = defaultSleeve();
										ps.saveImplant(im.id);
									}
								}
							}}
						>
							Assign sleeves to all
						</button>
						{#if selectedImplant}
							<div class="tool-sep"></div>
							<span><strong>{selectedImplant.tooth ? `Tooth ${selectedImplant.tooth}` : 'Implant'}</strong></span>
							<select
								value={selectedImplant.sleeve?.system ?? ''}
								onchange={(e) => {
									if (!selectedImplant || !ps) return;
									const sys = SLEEVE_SYSTEMS.find((s) => s.name === e.currentTarget.value);
									if (!sys) {
										selectedImplant.sleeve = null;
									} else {
										selectedImplant.sleeve = {
											system: sys.name,
											diameter: sys.diameters[0],
											height: sys.heights[0],
											offset: sys.offsets[Math.floor(sys.offsets.length / 2)]
										};
									}
									ps.saveImplant(selectedImplant.id);
								}}
							>
								<option value="">No sleeve</option>
								{#each SLEEVE_SYSTEMS as s (s.name)}
									<option value={s.name}>{s.name}</option>
								{/each}
							</select>
							{#if selectedImplant.sleeve}
								{@const sys = SLEEVE_SYSTEMS.find((s) => s.name === selectedImplant?.sleeve?.system)}
								<select
									value={selectedImplant.sleeve.diameter}
									title="Sleeve diameter"
									onchange={(e) => {
										if (selectedImplant?.sleeve && ps) {
											selectedImplant.sleeve.diameter = Number(e.currentTarget.value);
											ps.saveImplant(selectedImplant.id);
										}
									}}
								>
									{#each sys?.diameters ?? [] as d (d)}
										<option value={d}>⌀ {d.toFixed(1)}</option>
									{/each}
								</select>
								<select
									value={selectedImplant.sleeve.height}
									title="Sleeve height"
									onchange={(e) => {
										if (selectedImplant?.sleeve && ps) {
											selectedImplant.sleeve.height = Number(e.currentTarget.value);
											ps.saveImplant(selectedImplant.id);
										}
									}}
								>
									{#each sys?.heights ?? [] as h (h)}
										<option value={h}>H {h.toFixed(1)}</option>
									{/each}
								</select>
								<select
									value={selectedImplant.sleeve.offset}
									title="Offset (shoulder → sleeve bottom)"
									onchange={(e) => {
										if (selectedImplant?.sleeve && ps) {
											selectedImplant.sleeve.offset = Number(e.currentTarget.value);
											ps.saveImplant(selectedImplant.id);
										}
									}}
								>
									{#each sys?.offsets ?? [] as o (o)}
										<option value={o}>offset {o.toFixed(0)} mm</option>
									{/each}
								</select>
								<span class="muted">
									drill length {drillLength(selectedImplant.length, selectedImplant.sleeve).toFixed(1)} mm
								</span>
							{/if}
						{:else}
							<span class="muted">Select an implant in a view or the object tree.</span>
						{/if}
					{/if}
				{:else if stage === 'guide'}
					{#if !ps.implants.some((i) => i.sleeve)}
						<span class="muted">Assign sleeves to your implants first (Sleeves stage).</span>
					{:else if !guideBases.length}
						<span class="muted">
							Import a model scan or create a bone model (Align stage) to base the guide on.
						</span>
					{:else}
						<label class="inline-label" for="guide-base">Base</label>
						<select
							id="guide-base"
							value={guideBaseId ?? guideBases[0]?.id}
							onchange={(e) => (guideBaseId = Number(e.currentTarget.value))}
						>
							{#each guideBases as m (m.id)}
								<option value={m.id}>{m.name}</option>
							{/each}
						</select>
						<label class="inline-label" for="guide-off">Offset</label>
						<input
							id="guide-off"
							type="number"
							step="0.05"
							min="0"
							max="1"
							bind:value={guideParams.offset}
							style="width:64px"
						/>
						<label class="inline-label" for="guide-th">Thickness</label>
						<input
							id="guide-th"
							type="number"
							step="0.5"
							min="1"
							max="6"
							bind:value={guideParams.thickness}
							style="width:64px"
						/>
						<label class="inline-label" for="guide-r">Radius</label>
						<input
							id="guide-r"
							type="number"
							step="1"
							min="5"
							max="20"
							bind:value={guideParams.regionRadius}
							style="width:64px"
						/>
						<label class="inline-label" for="guide-ins">Insertion</label>
						<select id="guide-ins" bind:value={guideInsertion}>
							<option value="auto">Along implant axes</option>
							<option value="vertical">Vertical</option>
						</select>
						<button class="btn primary" disabled={guideBusy} onclick={generateGuideAction}>
							<Icon name="guide" size={14} />
							{guideBusy ? 'Generating…' : 'Generate guide'}
						</button>
						{#if guideError}<span class="warn-text">{guideError}</span>{/if}
						{#each guideModels as g (g.id)}
							<a class="btn" href="/api/models/{g.id}/file?download=1" title="Download STL">
								<Icon name="export" size={14} /> {g.name}.stl
							</a>
						{/each}
					{/if}
				{:else}
					<span class="muted">{stages.find((s) => s.key === stage)?.label} tools coming soon</span>
				{/if}
			</div>

			{#if stage === 'align'}
				<div class="view-grid grid-2x2">
					<div class="view panel">
						<VolumeView state={ps} bind:this={alignVolView} onMeshClick={onScanMeshClick} />
					</div>
					<div class="view panel"><SliceView state={ps} plane="axial" overlayDraw={curveOverlay} overlayDeps={[ps.curveControl, ps.crossU]} /></div>
					<div class="view panel"><SliceView state={ps} plane="coronal" /></div>
					<div class="view panel"><SliceView state={ps} plane="sagittal" /></div>
				</div>
			{:else if stage === 'pano'}
				<div class="view-grid grid-pano">
					<div class="view panel area-ax">
						<SliceView
							state={ps}
							plane="axial"
							overlayDraw={axialOverlay}
							onToolPointer={axialTool}
							overlayDeps={[ps.curveControl, ps.curveEditMode, ps.crossU, objectsVersion]}
						/>
					</div>
					<div class="view panel area-3d"><VolumeView state={ps} /></div>
					<div class="view panel area-pano"><PanoView state={ps} /></div>
				</div>
			{:else}
				<div class="view-grid grid-2x2">
					<div class="view panel"><VolumeView state={ps} /></div>
					<div class="view panel">
						<SliceView
							state={ps}
							plane="axial"
							overlayDraw={axialOverlay}
							onToolPointer={axialTool}
							overlayDeps={[ps.curveControl, ps.crossU, objectsVersion]}
						/>
					</div>
					<div class="view panel">
						<PanoView
							state={ps}
							overlayDraw={(ctx, t, info) => ps && drawPanoOverlay(ps, ctx, t, info)}
							onToolPointer={(e) => (ps ? panoTool(ps, e) : false)}
							overlayDeps={[objectsVersion]}
						/>
					</div>
					<div class="view panel">
						{#if crossGroupMode}
							<div class="cross-group">
								{#each [-crossSpacing, 0, crossSpacing] as off (off)}
									<div class="cross-group-cell">
										<CrossView
											state={ps}
											uOffset={off}
											compact={off !== 0}
											overlayDraw={(ctx, t, info, u, frame) =>
												ps && drawCrossOverlay(ps, ctx, t, info, u, frame ?? undefined)}
											onToolPointer={off === 0 ? (e) => (ps ? crossTool(ps, e) : false) : undefined}
											overlayDeps={[objectsVersion]}
										/>
									</div>
								{/each}
							</div>
						{:else}
							<CrossView
								state={ps}
								overlayDraw={(ctx, t, info, u, frame) =>
									ps && drawCrossOverlay(ps, ctx, t, info, u, frame ?? undefined)}
								onToolPointer={(e) => (ps ? crossTool(ps, e) : false)}
								overlayDeps={[objectsVersion]}
							/>
						{/if}
						<button
							class="group-toggle"
							title="Toggle 1 / 3 parallel sections"
							onclick={() => (crossGroupMode = !crossGroupMode)}
						>
							{crossGroupMode ? '1×' : '3×'}
						</button>
					</div>
				</div>
			{/if}
		{/if}
	</main>
</div>

{#if grayscaleOpen && ps}
	<AdjustGrayscale state={ps} onclose={() => (grayscaleOpen = false)} />
{/if}

<!-- add implant dialog -->
<dialog bind:this={implantDialog}>
	<div class="dialog-title">Add implant</div>
	<div class="dialog-body">
		<div>
			<label for="im-tooth">Tooth position (FDI)</label>
			<div class="fdi-grid">
				{#each [FDI_UPPER, FDI_LOWER] as row, ri (ri)}
					<div class="fdi-row">
						{#each row as tooth (tooth)}
							<button
								type="button"
								class="fdi-tooth"
								class:fdi-active={newImplant.tooth === String(tooth)}
								class:fdi-placed={ps?.implants.some((i) => i.tooth === String(tooth))}
								onclick={() => (newImplant.tooth = String(tooth))}
							>
								{tooth}
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</div>
		<div class="field-row">
			<div>
				<label for="im-line">Implant system</label>
				<select
					id="im-line"
					bind:value={newImplant.lineIndex}
					onchange={() => {
						const line = IMPLANT_LIBRARY[newImplant.lineIndex];
						if (!line.diameters.includes(newImplant.diameter))
							newImplant.diameter = line.diameters[Math.floor(line.diameters.length / 2)];
						if (!line.lengths.includes(newImplant.length))
							newImplant.length = line.lengths[Math.floor(line.lengths.length / 2)];
					}}
					style="width:100%"
				>
					{#each IMPLANT_LIBRARY as line, i (i)}
						<option value={i}>{line.manufacturer} — {line.line}</option>
					{/each}
				</select>
			</div>
		</div>
		<div class="field-row">
			<div>
				<label for="im-d">Diameter</label>
				<select id="im-d" bind:value={newImplant.diameter} style="width:100%">
					{#each IMPLANT_LIBRARY[newImplant.lineIndex].diameters as d (d)}
						<option value={d}>⌀ {d.toFixed(1)} mm</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="im-l">Length</label>
				<select id="im-l" bind:value={newImplant.length} style="width:100%">
					{#each IMPLANT_LIBRARY[newImplant.lineIndex].lengths as l (l)}
						<option value={l}>{l.toFixed(1)} mm</option>
					{/each}
				</select>
			</div>
		</div>
		<p class="faint">
			The implant is placed at the current cross-section position; drag it in the views to refine.
		</p>
	</div>
	<div class="dialog-actions">
		<button type="button" class="btn" onclick={() => implantDialog?.close()}>Cancel</button>
		<button type="button" class="btn primary" onclick={confirmAddImplant}>Place implant</button>
	</div>
</dialog>

<footer class="status-bar">
	<span class="faint">coDiagnostiX Web — planning workspace</span>
	<span class="hint-text"><Icon name="chevron" size={11} /> {nextHint}</span>
	{#if ps?.liveDistances}
		{@const ld = ps.liveDistances}
		{#if ld.nerve != null}
			<span class="dist-chip" class:dist-bad={ld.nerve < ps.nerveSafety}>
				nerve {ld.nerve.toFixed(1)} mm
			</span>
		{/if}
		{#if ld.implant != null}
			<span class="dist-chip" class:dist-bad={ld.implant < ps.implantSafety}>
				implant {ld.implant.toFixed(1)} mm
			</span>
		{/if}
	{/if}
	{#if ps && ps.warnings.length}
		<span class="warn-text">
			<Icon name="warning" size={13} />
			{ps.warnings.length} safety distance warning{ps.warnings.length === 1 ? '' : 's'}
		</span>
	{/if}
	<div class="spacer"></div>
	{#if ps}
		<span class="faint">
			cursor {ps.cursor.x}, {ps.cursor.y}, {ps.cursor.z}
			· {(ps.cursor.x * ps.ds.spacing_x).toFixed(1)}, {(ps.cursor.y * ps.ds.spacing_y).toFixed(1)}, {(
				ps.cursor.z * ps.ds.spacing_z
			).toFixed(1)} mm
		</span>
	{:else}
		<span class="faint">no data</span>
	{/if}
</footer>

<style>
	.case-bar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 12px;
		height: 64px;
		background: var(--bg-0);
		border-bottom: 1px solid var(--border-soft);
		flex: none;
	}
	.case-patient {
		font-weight: 600;
	}
	.case-title-row {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 12px;
	}
	.stage-bar {
		display: flex;
		gap: 2px;
		margin-left: 24px;
		border-left: 1px solid var(--border-soft);
		padding-left: 24px;
	}
	.spacer {
		flex: 1;
	}
	.plan-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 3px 12px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.plan-chip:hover {
		color: var(--text);
		border-color: var(--accent-dim);
	}
	.plan-menu-wrap {
		position: relative;
	}
	.plan-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		min-width: 220px;
		z-index: 30;
		box-shadow: var(--shadow);
		padding: 4px;
	}
	.plan-menu-item {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		text-align: left;
		padding: 6px 10px;
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--text);
	}
	.plan-menu-item:hover {
		background: var(--bg-3);
	}
	.plan-menu-item.active {
		background: var(--accent-dim);
	}
	.plan-menu-sep {
		height: 1px;
		background: var(--border-soft);
		margin: 4px 0;
	}
	.danger-item:hover {
		background: var(--red);
		color: #fff;
	}

	.workspace {
		flex: 1;
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 8px;
		padding: 8px;
		min-height: 0;
	}
	.object-tree {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.tree {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}
	.tree-group {
		margin-bottom: 10px;
	}
	.tree-group-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-faint);
		padding: 4px 6px;
	}
	.tree-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		border-radius: var(--radius);
		font-size: 12px;
	}
	.tree-item:hover {
		background: var(--bg-3);
	}
	.tree-empty {
		padding: 2px 8px;
		font-size: 11px;
		color: var(--text-faint);
		font-style: italic;
	}
	.tree-clickable {
		cursor: pointer;
	}
	.tree-selected {
		background: var(--accent-dim);
	}
	.tree-item-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tree-eye {
		color: var(--text-dim);
		display: flex;
	}
	.tree-eye:hover {
		color: var(--text);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
		display: inline-block;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 2px 8px;
		background: var(--bg-2);
	}
	.chip-active {
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.chip-label {
		font-size: 12px;
	}
	.chip-num {
		width: 44px;
		padding: 1px 4px;
		font-size: 11px;
	}
	.chip-x {
		color: var(--text-dim);
		font-size: 14px;
		padding: 0 2px;
	}
	.chip-x:hover {
		color: var(--red);
	}
	.fdi-grid {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fdi-row {
		display: flex;
		gap: 2px;
	}
	.fdi-tooth {
		flex: 1;
		padding: 4px 0;
		font-size: 11px;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: var(--bg-1);
		color: var(--text-dim);
		min-width: 26px;
	}
	.fdi-tooth:hover {
		border-color: var(--accent-dim);
		color: var(--text);
	}
	.fdi-active {
		background: var(--accent-dim);
		color: #fff;
		border-color: var(--accent);
	}
	.fdi-placed {
		color: var(--accent-2);
	}
	.warn-text {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--red);
	}
	.hint-text {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--accent-bright);
	}
	.dist-chip {
		padding: 0 8px;
		border-radius: 9px;
		border: 1px solid #2a6e3c;
		color: var(--green);
		font-size: 11px;
	}
	.dist-chip.dist-bad {
		border-color: var(--red);
		color: var(--red);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 12px;
	}
	.stepper .btn {
		padding: 2px 7px;
	}
	.cross-group {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 2px;
		width: 100%;
		height: 100%;
	}
	.cross-group-cell {
		position: relative;
		overflow: hidden;
		border-right: 1px solid var(--border-soft);
	}
	.group-toggle {
		position: absolute;
		bottom: 6px;
		right: 6px;
		z-index: 3;
		width: 26px;
		height: 20px;
		border-radius: 3px;
		border: 1px solid var(--border);
		background: var(--bg-2);
		color: var(--text-dim);
		font-size: 10px;
		opacity: 0.4;
	}
	.view:hover .group-toggle {
		opacity: 1;
	}
	.stage-bar .tool-btn {
		position: relative;
	}
	.stage-check {
		position: absolute;
		top: 3px;
		right: 6px;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--green);
		color: #fff;
		display: grid;
		place-items: center;
	}
	.tool-btn.disabled {
		opacity: 0.35;
		pointer-events: none;
	}
	.view-controls-body {
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.checkbox-row {
		display: flex;
		align-items: center;
		gap: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		color: var(--text);
		cursor: pointer;
	}
	.measure-row {
		display: flex;
		gap: 4px;
	}
	.measure-row .btn {
		padding: 4px 8px;
	}

	.view-area {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.stage-tools {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 2px;
		flex: none;
		min-height: 34px;
	}
	.tool-sep {
		width: 1px;
		height: 20px;
		background: var(--border);
		margin: 0 4px;
	}
	.inline-label {
		display: inline;
		margin: 0;
	}
	.data-stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: stretch;
		justify-content: center;
		max-width: 720px;
		margin: 0 auto;
	}
	.dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 48px 32px;
		text-align: center;
		color: var(--text-dim);
		cursor: pointer;
		border-style: dashed;
		border-width: 2px;
	}
	.dropzone:hover,
	.dropzone.drag-over {
		border-color: var(--accent);
		color: var(--text);
	}
	.upload-error {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--red);
		justify-content: center;
	}
	.dataset-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.dataset-card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
	}
	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--bg-3);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.view-grid {
		flex: 1;
		display: grid;
		gap: 8px;
		min-height: 0;
	}
	.grid-2x2 {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}
	.grid-pano {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 3fr 2fr;
		grid-template-areas:
			'ax v3d'
			'pano pano';
	}
	.area-ax {
		grid-area: ax;
	}
	.area-3d {
		grid-area: v3d;
	}
	.area-pano {
		grid-area: pano;
	}
	.view {
		position: relative;
		background: #000;
		overflow: hidden;
	}
	.view-label-3d {
		position: absolute;
		top: 6px;
		left: 8px;
		font-size: 11px;
		color: var(--accent-bright);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		z-index: 2;
	}
	.view-placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}

	.status-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 26px;
		padding: 0 12px;
		background: var(--bg-0);
		border-top: 1px solid var(--border-soft);
		font-size: 11px;
		flex: none;
	}
</style>
