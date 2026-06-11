<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import SliceView from '$lib/components/viewers/SliceView.svelte';
	import VolumeView from '$lib/components/viewers/VolumeView.svelte';
	import PanoView from '$lib/components/viewers/PanoView.svelte';
	import CrossView from '$lib/components/viewers/CrossView.svelte';
	import { PlanningState, WINDOW_PRESETS } from '$lib/client/planning.svelte';
	import AdjustGrayscale from '$lib/components/AdjustGrayscale.svelte';
	import PlanCompare from '$lib/components/PlanCompare.svelte';
	import MakeParallel from '$lib/components/MakeParallel.svelte';
	import DistancePopover from '$lib/components/DistancePopover.svelte';
	import ImportWizard from '$lib/components/ImportWizard.svelte';
	import ImplantPicker from '$lib/components/ImplantPicker.svelte';
	import GuideOptionsPanel from '$lib/components/GuideOptionsPanel.svelte';
	import FineAlignDialog from '$lib/components/FineAlignDialog.svelte';
	import GroupAbutmentDialog from '$lib/components/GroupAbutmentDialog.svelte';
	import AbutmentRotateDial from '$lib/components/AbutmentRotateDial.svelte';
	import AbutmentEditor from '$lib/components/AbutmentEditor.svelte';
	import VirtualToothPicker from '$lib/components/VirtualToothPicker.svelte';
	import HelpOverlay from '$lib/components/HelpOverlay.svelte';
	import PerioChart, { type PerioData } from '$lib/components/PerioChart.svelte';
	import TemplateMatchDialog from '$lib/components/TemplateMatchDialog.svelte';
	import VpeDialog from '$lib/components/VpeDialog.svelte';
	import AugmentWizard from '$lib/components/AugmentWizard.svelte';
	import AiReviewWizard from '$lib/components/AiReviewWizard.svelte';
	import ProstheticImportDialog from '$lib/components/ProstheticImportDialog.svelte';
	import AngleBetweenImplants from '$lib/components/AngleBetweenImplants.svelte';
	import AngleBetweenAbutments from '$lib/components/AngleBetweenAbutments.svelte';
	import { indexAtLength, toothArchU } from '$lib/curve';
	import { implantPlatform } from '$lib/vpeCatalog';
	import { guideFootprintOutline } from '$lib/guideFootprint';
	import type { ToolPointerEvent, ViewTransform } from '$lib/client/render2d';
	import { snapshotPrefs, toCanvas } from '$lib/client/render2d';
	import { areaCm2, gridOverlayDraw } from '$lib/client/segExtras';
	import {
		crossTool,
		drawAxialObjects,
		drawCrossOverlay,
		drawMeasurements,
		drawPanoOverlay,
		finishPolyline,
		measureAxialTool,
		measureEditTool,
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
		implantColor,
		toothLabel,
		ABUTMENT_PRESETS,
		abutmentLabel,
		type Notation,
		userAbutmentToSpec
	} from '$lib/implantLibrary';
	import { applyMat4, composeMat4, icp, identityMat4, kabsch } from '$lib/registration';
	import { extractSurfacePoints } from '$lib/client/icpTargets';
	import { axialContours, primeModel } from '$lib/client/meshContours';
	import {
		drawMaskOverlay,
		fetchMaskSlice,
		flushPaintOps,
		invalidateMaskSlice,
		paintLocal,
		peekMaskSlice,
		queuePaintOp
	} from '$lib/client/maskLayer';
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
	let notation = $derived((data.settings.notation === 'universal' ? 'universal' : 'fdi') as Notation);
	let easyMode = $derived(data.user?.work_mode === 'easy');

	// EASY: transient axial-position aid (upper-right) while scrolling slices
	let axialPopup = $state(false);
	let axialPopupTimer: ReturnType<typeof setTimeout> | null = null;
	let lastPopupZ = -1;
	$effect(() => {
		const z = ps?.cursor.z ?? -1;
		if (!easyMode || z < 0) return;
		if (lastPopupZ === -1) {
			lastPopupZ = z;
			return;
		}
		if (z === lastPopupZ) return;
		lastPopupZ = z;
		axialPopup = true;
		if (axialPopupTimer) clearTimeout(axialPopupTimer);
		axialPopupTimer = setTimeout(() => (axialPopup = false), 1200);
	});

	// EASY mode step tree (maps onto the same stages)
	const easySteps = [
		{
			title: '1. Prepare',
			subs: [
				{ key: 'data' as StageKey, label: 'Import data' },
				{ key: 'align' as StageKey, label: 'Align & segment' },
				{ key: 'pano' as StageKey, label: 'Panoramic curve' },
				{ key: 'nerve' as StageKey, label: 'Nerve canals' }
			]
		},
		{
			title: '2. Implants',
			subs: [
				{ key: 'implant' as StageKey, label: 'Place implants' },
				{ key: 'sleeve' as StageKey, label: 'Select sleeves' }
			]
		},
		{
			title: '3. Guide',
			subs: [{ key: 'guide' as StageKey, label: 'Surgical guide' }]
		}
	];
	const easyOrder: StageKey[] = ['data', 'align', 'pano', 'nerve', 'implant', 'sleeve', 'guide'];

	const EASY_HELP: Record<StageKey, string> = {
		data: 'Import the CBCT scan (.dcm files or .zip) and, if available, the intraoral model scan (.stl/.ply). The volume builds automatically after upload.',
		align:
			'Check the patient orientation in all views; use “Align patient axes” for corrections. Create a bone model with the threshold, and match the model scan: add ≥3 point pairs (click scan in 3D, then the same spot in a slice), Align, then Refine fit (ICP).',
		pano: 'Enable “Draw curve” and click 5–7 points along the middle of the dental arch on the axial view, posterior → posterior — or use “Guided markers” to be prompted through the five named anatomical points (incisal, canine/premolar, tooth 8). The panoramic view builds live; drag points to refine.',
		nerve:
			'Add the right/left nerve, then click along the canal in the panoramic view from the mental foramen backwards. Set point diameters where the canal widens. The safety system warns at < 2 mm clearance.',
		implant:
			'Add an implant per tooth position (double-click the axial view places it directly). Drag the body to move, drag the orange end handles to tilt. Watch the live distance chips in the status bar.',
		sleeve:
			'Assign a sleeve to every implant — choose system, diameter, height and offset. The drill length updates per the formula implant length + offset + sleeve height.',
		guide:
			'Pick the base model, set offset/wall thickness, choose the insertion direction, optionally place inspection windows, then Generate. Export requires plan approval (plan menu).',
		report: ''
	};
	let easyHelpOpen = $state(true);

	function easyStep(dir: 1 | -1) {
		const i = easyOrder.indexOf(stage);
		const next = easyOrder[Math.max(0, Math.min(easyOrder.length - 1, i + dir))];
		if (next !== 'data' && !hasVolume) return;
		stage = next;
	}
	let ps = $derived.by(() => {
		if (!data.datasets[0]) return null;
		const s = new PlanningState(
			data.datasets[0],
			data.plan,
			data.nerves,
			data.implants,
			data.models,
			data.measurements,
			data.settings
		);
		s.snapshotContext = {
			patient: `${data.patient.last_name}-${data.patient.first_name}`.replace(/^-|-$/g, ''),
			caseTitle: data.caseData.title
		};
		return s;
	});

	let modelsVersion = $derived(ps ? JSON.stringify(ps.models) : '');

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

	// move off the data stage automatically once — only on initial load,
	// so the user can still navigate back to the Data stage afterwards
	let autoAdvanced = false;
	$effect(() => {
		if (hasVolume && stage === 'data' && !autoAdvanced) {
			autoAdvanced = true;
			stage = 'pano';
		}
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

	// Guided anatomical markers (EASY flow of the original): prompted click order
	// incisal → canine/premolar R → canine/premolar L → tooth-8 R → tooth-8 L,
	// then reassembled into arch order (right-posterior → … → left-posterior).
	const PANO_GUIDED_MARKERS = [
		'Incisal point — between the central incisors',
		'Between canine and first premolar — patient right',
		'Between canine and first premolar — patient left',
		'Tooth-position 8 region — patient right',
		'Tooth-position 8 region — patient left'
	];
	const PANO_GUIDED_ARCH_ORDER = [3, 1, 0, 2, 4]; // click-order indices in arch order
	let panoGuidedStep = $state(-1); // -1 = off
	let panoGuidedPoints: { x: number; y: number }[] = [];

	function startGuidedCurve() {
		if (!ps) return;
		if (ps.curveControl.length && !confirm('Replace the existing panoramic curve?')) return;
		ps.markEdit();
		ps.curveControl.length = 0;
		ps.saveCurve();
		panoGuidedPoints = [];
		panoGuidedStep = 0;
		ps.curveEditMode = true;
	}

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
			ps.markEdit();
			if (panoGuidedStep >= 0) {
				// guided placement: every click is a new named marker, no drag-pick
				panoGuidedPoints.push(mm);
				ps.curveControl.push(mm);
				ps.curveZ = ps.cursor.z;
				if (panoGuidedPoints.length >= PANO_GUIDED_MARKERS.length) {
					ps.curveControl = PANO_GUIDED_ARCH_ORDER.map((i) => panoGuidedPoints[i]);
					panoGuidedStep = -1; // done — drag-refine stays available
				} else {
					panoGuidedStep = panoGuidedPoints.length;
				}
				ps.saveCurve();
				return true;
			}
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
		ps.markEdit();
		ps.curveControl.pop();
		if (panoGuidedStep > 0) {
			panoGuidedPoints.pop();
			panoGuidedStep = panoGuidedPoints.length;
		}
		ps.saveCurve();
	}
	function clearCurve() {
		if (!ps) return;
		if (ps.curveControl.length && !confirm('Clear the panoramic curve?')) return;
		ps.markEdit();
		ps.curveControl.length = 0;
		panoGuidedStep = -1;
		panoGuidedPoints = [];
		ps.saveCurve();
	}

	// ---------- combined overlays ----------
	let contourTick = $state(0);

	function drawScanContours(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps) return;
		const sx = ps.ds.spacing_x;
		const sy = ps.ds.spacing_y;
		const zmm = ps.cursor.z * ps.ds.spacing_z;
		for (const m of ps.models) {
			// scans, the generated drill guide and wax-ups all show as dashed
			// cross-section contours in the 2D views (like the original)
			if ((m.kind !== 'scan' && m.kind !== 'guide' && m.kind !== 'waxup') || !m.visible) continue;
			primeModel(m.id, () => contourTick++);
			const segs = axialContours(m.id, m.transform, zmm);
			if (!segs || segs.length === 0) continue;
			ctx.strokeStyle = m.color;
			ctx.setLineDash([5, 3]);
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < segs.length; i += 4) {
				ctx.moveTo(t.ox + (segs[i] / sx + 0.5) * t.scaleX, t.oy + (segs[i + 1] / sy + 0.5) * t.scaleY);
				ctx.lineTo(
					t.ox + (segs[i + 2] / sx + 0.5) * t.scaleX,
					t.oy + (segs[i + 3] / sy + 0.5) * t.scaleY
				);
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}
	}

	function axialOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		maskOverlay(ctx, t);
		curveOverlay(ctx, t);
		if (ps) {
			drawScanContours(ctx, t);
			drawAxialObjects(ps, ctx, t);
			drawMeasurements(ps, ctx, t);
			if (connectorPreview && stage === 'guide') drawConnectorPreview(ctx, t);
			if (footprintPreview && stage === 'guide') drawFootprintPreview(ctx, t);
		}
	}

	/** planned guide footprint outline ("Show cut profile") on the axial view */
	function drawFootprintPreview(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps || !ps.implants.length) return;
		const loops = guideFootprintOutline({
			implants: ps.implants.map((i) => ({ x: i.x, y: i.y })),
			regionRadius: guideParams.regionRadius,
			largeConnectors: Boolean(guideAdvanced.largeConnectors),
			supportRegions:
				(guideAdvanced.supportRegions as { x: number; y: number; radius: number }[]) ?? [],
			contactPolygons: (guideAdvanced.contactPolygons as { x: number; y: number }[][]) ?? []
		});
		const sx = ps.ds.spacing_x;
		const sy = ps.ds.spacing_y;
		ctx.strokeStyle = 'rgba(126, 200, 227, 0.9)';
		ctx.setLineDash([4, 3]);
		ctx.lineWidth = 1.5;
		for (const loop of loops) {
			if (loop.length < 2) continue;
			ctx.beginPath();
			loop.forEach((p, i) => {
				const x = t.ox + (p.x / sx + 0.5) * t.scaleX;
				const y = t.oy + (p.y / sy + 0.5) * t.scaleY;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			});
			ctx.closePath();
			ctx.stroke();
		}
		ctx.setLineDash([]);
	}

	/** dashed connector strips + contact-surface order between consecutive implants (guide stage) */
	function drawConnectorPreview(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps || ps.implants.length < 2) return;
		const pts = ps.implants
			.map((im) => ({ x: im.x / ps!.ds.spacing_x, y: im.y / ps!.ds.spacing_y }))
			.sort((a, b) => a.x - b.x);
		ctx.save();
		ctx.setLineDash([6, 4]);
		ctx.strokeStyle = '#f08a24';
		ctx.lineWidth = 2;
		ctx.beginPath();
		pts.forEach((p, i) => {
			const c = toCanvas(t, p.x, p.y);
			if (i === 0) ctx.moveTo(c.x, c.y);
			else ctx.lineTo(c.x, c.y);
		});
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillStyle = '#f08a24';
		ctx.font = 'bold 11px sans-serif';
		pts.forEach((p, i) => {
			const c = toCanvas(t, p.x, p.y);
			ctx.fillText(String(i + 1), c.x + 8, c.y - 8);
		});
		ctx.restore();
	}

	function axialTool(e: ToolPointerEvent): boolean {
		if (!ps) return false;
		if (measureAxialTool(ps, e)) return true;
		if (measureEditTool(ps, e)) return true;
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
	let implantDialogMode = $state<'add' | 'change'>('add');
	let newImplant = $state({
		tooth: '36',
		lineIndex: 0,
		diameter: IMPLANT_LIBRARY[0].diameters[3] ?? 4.1,
		length: IMPLANT_LIBRARY[0].lengths[2] ?? 10
	});

	/** explicit head position for the next added implant (set by double-click placement) */
	let pendingHead = $state<Vec3 | null>(null);

	function openImplantDialog() {
		if (!ps) return;
		implantDialogMode = 'add';
		pendingHead = null;
		newImplant.tooth = data.plan.jaw === 'maxilla' ? '26' : '36';
		implantDialog?.showModal();
	}

	/** double-click on the axial view places an implant at that point (implant stage) */
	function onAxialDblClick(px: number, py: number): boolean {
		if (!ps || stage !== 'implant' || ps.locked) return false;
		implantDialogMode = 'add';
		pendingHead = {
			x: px * ps.ds.spacing_x,
			y: py * ps.ds.spacing_y,
			z: ps.cursor.z * ps.ds.spacing_z
		};
		newImplant.tooth = data.plan.jaw === 'maxilla' ? '26' : '36';
		implantDialog?.showModal();
		return true;
	}

	function openChangeImplantDialog() {
		if (!ps || !selectedImplant) return;
		implantDialogMode = 'change';
		const idx = IMPLANT_LIBRARY.findIndex(
			(l) => l.manufacturer === selectedImplant?.manufacturer && l.line === selectedImplant?.line
		);
		newImplant = {
			tooth: selectedImplant.tooth || '36',
			lineIndex: idx >= 0 ? idx : 0,
			diameter: selectedImplant.diameter,
			length: selectedImplant.length
		};
		implantDialog?.showModal();
	}

	async function confirmAddImplant() {
		if (!ps) return;
		const line = IMPLANT_LIBRARY[newImplant.lineIndex];

		if (implantDialogMode === 'change' && selectedImplant) {
			selectedImplant.tooth = newImplant.tooth;
			selectedImplant.manufacturer = line.manufacturer;
			selectedImplant.line = line.line;
			selectedImplant.diameter = newImplant.diameter;
			selectedImplant.length = newImplant.length;
			selectedImplant.article = articleName(line, newImplant.diameter, newImplant.length);
			ps.saveImplant(selectedImplant.id);
			implantDialog?.close();
			if (selectedImplant.sleeve) {
				alert('Implant changed — re-check the sleeve selection and offset in the Sleeves stage.');
			}
			return;
		}

		const c = ps.curve;
		let head = pendingHead ?? {
			x: (ps.ds.cols * ps.ds.spacing_x) / 2,
			y: (ps.ds.rows * ps.ds.spacing_y) / 2,
			z: ps.cursor.z * ps.ds.spacing_z
		};
		if (!pendingHead && c) {
			// place at the chosen tooth's arch position along the curve (like the
			// original's tooth-driven proposal); fall back to the cross position
			const u = toothArchU(c, newImplant.tooth) ?? ps.crossU;
			const i = indexAtLength(c, u);
			// default depth: 1 cm below (mandible) / above (maxilla) the occlusal
			// plane when one is set, like the original; else the current slice
			let zmm = ps.cursor.z * ps.ds.spacing_z;
			if (occlusalZ != null) {
				zmm = data.plan.jaw === 'maxilla' ? occlusalZ + 10 : occlusalZ - 10;
				zmm = Math.max(0, Math.min((ps.ds.slices - 1) * ps.ds.spacing_z, zmm));
			}
			head = { x: c.points[i].x, y: c.points[i].y, z: zmm };
			ps.crossU = u; // jump the cross-section views to the new implant
		}
		pendingHead = null;
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
		if (im && confirm(`Remove implant ${im.tooth ? `at ${toothLabel(im.tooth, notation)}` : ''} (${im.article})?`)) {
			ps.deleteImplant(im.id);
		}
	}

	let selectedImplant = $derived(ps?.implants.find((i) => i.id === ps?.selectedImplantId) ?? null);
	/** sleeve systems recommended for the selected implant's manufacturer */
	const recSleeveSystems = $derived(
		selectedImplant
			? SLEEVE_SYSTEMS.filter((s) =>
					s.name.toLowerCase().includes(selectedImplant!.manufacturer.toLowerCase())
				)
			: []
	);

	// implants whose article no longer exists in the active catalog (catalog updates)
	let outdatedImplants = $derived(
		(ps?.implants ?? []).filter((im) => {
			const line = IMPLANT_LIBRARY.find(
				(l) => l.manufacturer === im.manufacturer && l.line === im.line
			);
			return !line || !line.diameters.includes(im.diameter) || !line.lengths.includes(im.length);
		})
	);

	// auto-recenter the cross-section on the selected implant
	let lastRecenteredId = -1;
	$effect(() => {
		const id = ps?.selectedImplantId;
		if (!ps || id == null || id === lastRecenteredId) return;
		lastRecenteredId = id;
		const im = ps.implants.find((i) => i.id === id);
		if (!im) return;
		const pc = ps.toPano({ x: im.x, y: im.y, z: im.z });
		if (pc) ps.crossU = pc.u;
	});

	// cross-section group (3 parallel slices like coDiagnostiX)
	let crossGroupMode = $state(false);
	let crossSpacing = $derived(Number(data.settings.cross_spacing_mm) > 0 ? Number(data.settings.cross_spacing_mm) : 2);

	// model appearance editor in the object tree
	let expandedModelId = $state<number | null>(null);
	let resegThreshold = $state<number | null>(null);
	let resegBusy = $state(false);

	// view maximize/restore (one cell fills the whole grid)
	let maximized = $state<string | null>(null);
	$effect(() => {
		void stage;
		maximized = null; // changing stages restores the layout
	});

	let grayscaleOpen = $state(false);
	let compareOpen = $state(false);

	// ---------- implant fine controls ----------
	function stepImplantDim(field: 'diameter' | 'length', dir: 1 | -1) {
		if (!ps || !selectedImplant || ps.locked) return;
		ps.markEdit();
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
		ps.markEdit();
		selectedImplant.x += selectedImplant.ax * deltaMM;
		selectedImplant.y += selectedImplant.ay * deltaMM;
		selectedImplant.z += selectedImplant.az * deltaMM;
		ps.saveImplant(selectedImplant.id);
	}

	let makeParallelOpen = $state(false);

	// bone density around the selected implant
	let densityInfo = $state<{
		mean: number;
		min: number;
		max: number;
		profile?: number[];
	} | null>(null);
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
		} else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
			e.preventDefault();
			zoomSig = { seq: zoomSig.seq + 1, f: 1.2 };
		} else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
			e.preventDefault();
			zoomSig = { seq: zoomSig.seq + 1, f: 1 / 1.2 };
		} else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
			e.preventDefault();
			zoomSig = { seq: zoomSig.seq + 1, f: 0 };
		} else if (e.key === 'F1') {
			e.preventDefault();
			helpOpen = !helpOpen;
		} else if (e.key === 'F8') {
			e.preventDefault();
			screenCopy();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			if (e.shiftKey) ps.redo();
			else ps.undo();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
			e.preventDefault();
			ps.redo();
		} else if (e.key === 'Escape') {
			if (maximized) {
				maximized = null;
				return;
			}
			ps.curveEditMode = false;
			ps.nerveEditMode = false;
			ps.measureTool = 'none';
			ps.pendingMeasure.length = 0;
			ps.selectedImplantId = null;
		} else if (/^[1-7]$/.test(e.key) && hasVolume) {
			const idx = Number(e.key) - 1;
			const s = stages[idx];
			if (s && s.key !== 'report') stage = s.key;
		} else if (e.key === '?' || ((e.ctrlKey || e.metaKey) && e.key === 'F1')) {
			e.preventDefault();
			hotkeysOpen = !hotkeysOpen;
		}
	}

	let zoomSig = $state({ seq: 0, f: 1 });
	let distancePopover = $state<'nerve' | 'implant' | null>(null);

	/** F8 screen copy: composite every visible view canvas into one snapshot */
	async function screenCopy() {
		if (!ps) return;
		const grid = document.querySelector('.view-grid');
		if (!grid) return;
		const gridBox = grid.getBoundingClientRect();
		const composite = document.createElement('canvas');
		composite.width = Math.round(gridBox.width);
		composite.height = Math.round(gridBox.height);
		const ctx = composite.getContext('2d')!;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, composite.width, composite.height);
		for (const c of grid.querySelectorAll('canvas')) {
			const box = (c as HTMLCanvasElement).getBoundingClientRect();
			if (box.width === 0 || box.height === 0) continue;
			ctx.drawImage(
				c as HTMLCanvasElement,
				box.left - gridBox.left,
				box.top - gridBox.top,
				box.width,
				box.height
			);
		}
		const { snapshotToLibrary } = await import('$lib/client/render2d');
		await snapshotToLibrary(composite, ps.snapshotName('screen'), ps.ds.case_id);
	}

	let hotkeysOpen = $state(false);
	const HOTKEYS: [string, string][] = [
		['↑ / ↓', 'Previous / next axial slice'],
		['PgUp / PgDn', '±5 axial slices'],
		['1 … 7', 'Switch workflow stage'],
		['Delete', 'Remove the selected implant'],
		['Esc', 'Cancel tool / deselect / restore view'],
		['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo plan edit'],
		['Mouse wheel', 'Scroll slices (views) / cross-section position (pano)'],
		['Ctrl + wheel', 'Zoom slice view'],
		['Left-drag', 'Crosshair / drag object (tool-dependent)'],
		['Right-drag', 'Window / level'],
		['Middle-drag', 'Pan view'],
		['Double-click view', 'Reset zoom & pan'],
		['Double-click axial (Implants stage)', 'Place implant at point'],
		['Shift + drag (scan alignment)', 'Rotate the scan'],
		['Alt + click 📷', 'Download snapshot instead of saving to library'],
		['? or Ctrl+F1', 'This hotkey list']
	];

	// ---------- plan management ----------
	let planMenuOpen = $state(false);
	let planImportInput: HTMLInputElement | undefined = $state();

	async function importPlanFile(file: File) {
		ps?.flushSaves();
		const form = new FormData();
		form.append('file', file);
		const res = await fetch(`/api/cases/${data.caseData.id}/import-plan`, {
			method: 'POST',
			body: form
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			alert(body?.message ?? 'Plan import failed');
			return;
		}
		await goto(`/cases/${data.caseData.id}?plan=${body.planId}`, { invalidateAll: true });
	}

	async function duplicatePlanAction() {
		planMenuOpen = false;
		ps?.flushSaves();
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
		ps?.flushSaves();
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
		ps?.flushSaves();
		await fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ [flag]: flag === 'locked' ? !data.plan.locked : !data.plan.approved })
		});
		await invalidateAll();
	}

	async function deletePlanAction() {
		planMenuOpen = false;
		ps?.flushSaves();
		if (!confirm(`Delete plan "${data.plan.name}"?`)) return;
		const res = await fetch(`/api/plans/${data.plan.id}`, { method: 'DELETE' });
		if (res.ok) await goto(`/cases/${data.caseData.id}`, { invalidateAll: true });
	}

	// ---------- scan matching (align stage) ----------
	let alignVolView = $state<ReturnType<typeof VolumeView>>();
	/** 3D view of the default (implant/sleeve/guide) grid — for view-derived insertion */
	let defaultVolView = $state<ReturnType<typeof VolumeView>>();
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
		lastScanClick = { modelId: e.modelId, scanLocal: e.scanLocal };
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

	let showFineAlign = $state(false);
	let showPackageImport = $state(false);
	let showGroupAbutments = $state(false);
	let showAbutmentEditor = $state(false);
	let showVirtualTeeth = $state(false);
	let showAbutmentDial = $state(false);
	let helpOpen = $state(false);
	let showPerio = $state(false);
	let showTemplateMatch = $state(false);
	let showVpe = $state(false);
	let perioData = $state<PerioData>(
		(() => {
			try {
				const st = data.plan.settings ? JSON.parse(data.plan.settings) : {};
				return st.perio && typeof st.perio === 'object' ? st.perio : {};
			} catch {
				return {};
			}
		})()
	);

	function savePerio(next: PerioData) {
		perioData = next;
		let st: Record<string, unknown> = {};
		try {
			st = data.plan.settings ? JSON.parse(data.plan.settings) : {};
		} catch {
			st = {};
		}
		st.perio = next;
		fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ settings: st })
		}).catch(() => {});
		showPerio = false;
	}
	let showAugment = $state(false);
	let aiBusy = $state(false);
	let aiReview = $state<{ id: number; name: string; ok: boolean }[] | null>(null);
	let lastScanClick = $state<{ modelId: number; scanLocal: Vec3 } | null>(null);
	let meshToolBusy = $state('');

	// AI-assistant job status chip (orange hourglass while running, green check
	// when results await review — click to open, like the original's icon)
	let aiJobId = $state<string | number | null>(null);
	let aiReady = $state<{ id: number; name: string; ok: boolean }[] | null>(null);
	const aiSeenKey = (jobId: unknown) => `cdx_aiseg_seen_${ps?.ds.id}_${jobId}`;

	async function pollAiJob(openWhenDone: boolean): Promise<void> {
		if (!ps) return;
		for (let i = 0; i < 240; i++) {
			const st = await (await fetch(`/api/datasets/${ps.ds.id}/ai-segment`)).json();
			aiJobId = st.jobId ?? aiJobId;
			if (st.status === 'done') {
				const models = (st.models ?? []).map((m: { id: number; name: string; ok: boolean }) => ({
					id: m.id,
					name: m.name,
					ok: m.ok
				}));
				if (openWhenDone) aiReview = models;
				else if (!localStorage.getItem(aiSeenKey(st.jobId))) aiReady = models;
				return;
			}
			if (st.status === 'error') {
				if (openWhenDone) alert(`AI segmentation failed: ${st.error ?? 'unknown error'}`);
				return;
			}
			if (st.status === 'idle') return;
			await new Promise((r) => setTimeout(r, 1500));
		}
		if (openWhenDone) alert('AI segmentation timed out');
	}

	async function runAiSegmentation() {
		if (!ps || aiBusy) return;
		aiBusy = true;
		try {
			await fetch(`/api/datasets/${ps.ds.id}/ai-segment`, { method: 'POST' });
			await new Promise((r) => setTimeout(r, 1500));
			await pollAiJob(true);
		} finally {
			aiBusy = false;
		}
	}

	let aiStatusChecked = false;
	$effect(() => {
		if (aiStatusChecked || !ps) return;
		aiStatusChecked = true;
		checkAiStatus();
	});

	// after a DICOM import: offer to provide the data to the AI assistant
	// right away (the original shows this popup after dataset creation)
	let offerAiAfterImport = $state(false);
	$effect(() => {
		if (!offerAiAfterImport || !ps || aiBusy) return;
		offerAiAfterImport = false;
		setTimeout(() => {
			if (
				confirm(
					'Provide the imported DICOM data to the AI assistant for automatic segmentation now?\n\nNote: the AI assistant is intended for CBCT scans — conventional (fan-beam) CT is not supported. You can keep planning while it processes.'
				)
			) {
				runAiSegmentation();
			}
		}, 400);
	});

	/** resume awareness of a job started in an earlier session/page load */
	async function checkAiStatus() {
		if (!ps) return;
		try {
			const st = await (await fetch(`/api/datasets/${ps.ds.id}/ai-segment`)).json();
			if (st.status === 'running') {
				aiBusy = true;
				try {
					await pollAiJob(false);
				} finally {
					aiBusy = false;
				}
			} else if (st.status === 'done' && !localStorage.getItem(aiSeenKey(st.jobId))) {
				aiJobId = st.jobId ?? null;
				aiReady = (st.models ?? []).map((m: { id: number; name: string; ok: boolean }) => ({
					id: m.id,
					name: m.name,
					ok: m.ok
				}));
			}
		} catch {
			// status probe is best-effort
		}
	}

	async function aiImport(keepIds: number[]) {
		const all = aiReview ?? [];
		for (const m of all) {
			if (!keepIds.includes(m.id)) {
				await fetch(`/api/models/${m.id}`, { method: 'DELETE' }).catch(() => {});
			}
		}
		aiReview = null;
		aiReady = null;
		if (aiJobId != null) {
			try {
				localStorage.setItem(aiSeenKey(aiJobId), '1');
			} catch {
				// quota/private mode — chip may reappear, harmless
			}
		}
		await invalidateAll();
	}

	async function meshEditOp(op: string) {
		if (!ps || matching.modelId == null) return;
		meshToolBusy = op;
		try {
			const body: Record<string, unknown> = { op };
			if (op === 'smooth' || op === 'remesh') {
				if (!lastScanClick || lastScanClick.modelId !== matching.modelId) {
					alert('Click a point on the scan in the 3D view first — the tool works locally around it.');
					return;
				}
				body.center = lastScanClick.scanLocal;
				body.radius = 5;
			}
			const res = await fetch(`/api/models/${matching.modelId}/edit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) alert(b?.message ?? 'Mesh edit failed');
			else await invalidateAll();
		} finally {
			meshToolBusy = '';
		}
	}

	async function repairModel(mode: 'repair' | 'detect') {
		if (matching.modelId == null) return;
		meshToolBusy = mode;
		try {
			const res = await fetch(`/api/models/${matching.modelId}/repair`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode })
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				alert(b?.message ?? 'Mesh operation failed');
				return;
			}
			if (mode === 'detect')
				alert(
					`Mesh check: ${b.issues.degenerate} degenerate, ${b.issues.duplicates} duplicate triangles, ${b.issues.openEdges} open edges.`
				);
			else {
				alert(
					`Repaired: removed ${b.report.removedDegenerate} degenerate + ${b.report.removedDuplicate} duplicate triangles, flipped ${b.report.flippedNormals} normals. Original kept as .orig.`
				);
				await invalidateAll();
			}
		} finally {
			meshToolBusy = '';
		}
	}

	let replaceInput: HTMLInputElement | undefined = $state();
	async function replaceModelFile(fl: FileList | null) {
		if (!fl?.length || matching.modelId == null) return;
		const form = new FormData();
		form.append('file', fl[0]);
		const res = await fetch(`/api/models/${matching.modelId}/replace`, { method: 'POST', body: form });
		const b = await res.json().catch(() => null);
		if (!res.ok) alert(b?.message ?? 'Replace failed');
		else await invalidateAll();
	}

	/** rotation about a unit axis through point c, as column-major Mat4 */
	function rotAboutMat4(axis: 'x' | 'y' | 'z', deg: number, c: Vec3): number[] {
		const r = (deg * Math.PI) / 180;
		const cs = Math.cos(r);
		const sn = Math.sin(r);
		let R: number[][];
		if (axis === 'x') R = [[1, 0, 0], [0, cs, -sn], [0, sn, cs]];
		else if (axis === 'y') R = [[cs, 0, sn], [0, 1, 0], [-sn, 0, cs]];
		else R = [[cs, -sn, 0], [sn, cs, 0], [0, 0, 1]];
		const t = {
			x: c.x - (R[0][0] * c.x + R[0][1] * c.y + R[0][2] * c.z),
			y: c.y - (R[1][0] * c.x + R[1][1] * c.y + R[1][2] * c.z),
			z: c.z - (R[2][0] * c.x + R[2][1] * c.y + R[2][2] * c.z)
		};
		// column-major
		return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t.x, t.y, t.z, 1];
	}

	function modelCentroidWorld(m: { id: number; transform: number[] | null }): Vec3 {
		const raw = alignVolView?.getModelPositions(m.id);
		if (!raw || raw.length < 9) return { x: 0, y: 0, z: 0 };
		let sx = 0;
		let sy = 0;
		let sz = 0;
		const stride = Math.max(3, Math.floor(raw.length / 3 / 500) * 3);
		let n = 0;
		for (let i = 0; i + 2 < raw.length; i += stride) {
			const pt = m.transform
				? applyMat4(m.transform, { x: raw[i], y: raw[i + 1], z: raw[i + 2] })
				: { x: raw[i], y: raw[i + 1], z: raw[i + 2] };
			sx += pt.x;
			sy += pt.y;
			sz += pt.z;
			n++;
		}
		return n ? { x: sx / n, y: sy / n, z: sz / n } : { x: 0, y: 0, z: 0 };
	}

	function fineNudge(
		delta: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number },
		frame: 'patient' | 'object'
	) {
		if (!ps || matching.modelId == null) return;
		const m = ps.models.find((x) => x.id === matching.modelId);
		if (!m) return;
		const T = m.transform ?? identityMat4();
		const c = modelCentroidWorld(m);
		let D: number[] | null = null;
		if (delta.tx || delta.ty || delta.tz) {
			D = identityMat4();
			if (frame === 'patient') {
				D[12] = delta.tx;
				D[13] = delta.ty;
				D[14] = delta.tz;
			} else {
				// object frame: translate along the model's current local axes (columns of T)
				D[12] = T[0] * delta.tx + T[4] * delta.ty + T[8] * delta.tz;
				D[13] = T[1] * delta.tx + T[5] * delta.ty + T[9] * delta.tz;
				D[14] = T[2] * delta.tx + T[6] * delta.ty + T[10] * delta.tz;
			}
		} else {
			const axis = delta.rx ? 'x' : delta.ry ? 'y' : 'z';
			const deg = delta.rx || delta.ry || delta.rz;
			if (frame === 'patient') {
				D = rotAboutMat4(axis, deg, c);
			} else {
				// object frame: rotate about the model's own axis direction through its centroid.
				// Approximate via patient-frame rotation about the transformed axis: for small
				// nudges use the local axis mapped to world.
				const col = axis === 'x' ? 0 : axis === 'y' ? 4 : 8;
				const ax = { x: T[col], y: T[col + 1], z: T[col + 2] };
				const len = Math.hypot(ax.x, ax.y, ax.z) || 1;
				// Rodrigues rotation matrix about arbitrary unit axis u through c
				const u = { x: ax.x / len, y: ax.y / len, z: ax.z / len };
				const r = (deg * Math.PI) / 180;
				const cs = Math.cos(r);
				const sn = Math.sin(r);
				const R = [
					[cs + u.x * u.x * (1 - cs), u.x * u.y * (1 - cs) - u.z * sn, u.x * u.z * (1 - cs) + u.y * sn],
					[u.y * u.x * (1 - cs) + u.z * sn, cs + u.y * u.y * (1 - cs), u.y * u.z * (1 - cs) - u.x * sn],
					[u.z * u.x * (1 - cs) - u.y * sn, u.z * u.y * (1 - cs) + u.x * sn, cs + u.z * u.z * (1 - cs)]
				];
				const t = {
					x: c.x - (R[0][0] * c.x + R[0][1] * c.y + R[0][2] * c.z),
					y: c.y - (R[1][0] * c.x + R[1][1] * c.y + R[1][2] * c.z),
					z: c.z - (R[2][0] * c.x + R[2][1] * c.y + R[2][2] * c.z)
				};
				D = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t.x, t.y, t.z, 1];
			}
		}
		if (!D) return;
		m.transform = composeMat4(D, T);
		ps.saveModel(m.id);
	}

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

	/** reuse the registration of an already-aligned scan (same situation scanned twice) */
	function copyAlignment() {
		if (!ps) return;
		const targetId = matching.modelId ?? scanModels[0]?.id ?? null;
		const target = ps.models.find((m) => m.id === targetId);
		if (!target) return;
		const sources = ps.models.filter(
			(m) => m.kind === 'scan' && m.id !== target.id && m.transform
		);
		if (!sources.length) return;
		const pick = prompt(
			`Copy alignment to "${target.name}" from which scan?\n${sources
				.map((s, i) => `${i + 1}. ${s.name}`)
				.join('\n')}\n\nEnter the number:`,
			'1'
		);
		const idx = Number(pick) - 1;
		if (!Number.isInteger(idx) || !sources[idx]) return;
		ps.markEdit();
		target.transform = [...sources[idx].transform!];
		ps.saveModel(target.id);
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

	// manual scan drag-alignment on the axial view (left-drag move, Shift+drag rotate)
	let scanDragMode = $state(false);
	let scanDragLast: { x: number; y: number } | null = null;

	function translationMat4(dx: number, dy: number, dz: number): number[] {
		return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];
	}
	function rotZAtMat4(ang: number, px: number, py: number): number[] {
		const c = Math.cos(ang);
		const s = Math.sin(ang);
		return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, px - c * px + s * py, py - s * px - c * py, 0, 1];
	}

	function scanAlignTool(e: ToolPointerEvent): boolean {
		if (!ps || !scanDragMode || ps.locked) return false;
		const modelId = matching.modelId ?? scanModels[0]?.id;
		const m = ps.models.find((m) => m.id === modelId);
		if (!m) return false;
		const mm = { x: e.px * ps.ds.spacing_x, y: e.py * ps.ds.spacing_y };
		if (e.type === 'down') {
			scanDragLast = mm;
			return true;
		}
		if (e.type === 'move' && scanDragLast) {
			const t = m.transform ?? translationMat4(0, 0, 0);
			let delta: number[];
			if (e.native.shiftKey) {
				delta = rotZAtMat4((mm.x - scanDragLast.x) * 0.02, mm.x, mm.y);
			} else {
				delta = translationMat4(mm.x - scanDragLast.x, mm.y - scanDragLast.y, 0);
			}
			m.transform = composeMat4(delta, t);
			scanDragLast = mm;
			ps.saveModel(m.id);
			return true;
		}
		if (e.type === 'up') {
			scanDragLast = null;
			return true;
		}
		return false;
	}

	// ---------- in-view PCS rotation (drag to rotate the patient axes) ----------
	let pcsDragMode = $state(false);
	let pcsDragStart: number | null = null;
	let pcsDragBase = 0;

	/**
	 * Drag around the view center adjusts the pending PCS angle visible in that
	 * plane. Effect of the /align args (verified empirically against
	 * rotateVolume): yaw = axial ↻, pitch = coronal ↻, roll = sagittal ↺ —
	 * `flip` makes every drag clockwise-positive on screen.
	 */
	function pcsRotTool(axis: 'yaw' | 'pitch' | 'roll', flip = false) {
		return (e: ToolPointerEvent): boolean => {
			if (!ps || !pcsDragMode || stage !== 'align') return false;
			// view center in slice px (axial: cols×rows, coronal: cols×slices, sagittal: rows×slices)
			const cx = (axis === 'roll' ? ps.ds.rows : ps.ds.cols) / 2;
			const cy = (axis === 'yaw' ? ps.ds.rows : ps.ds.slices) / 2;
			const a = (Math.atan2(e.py - cy, e.px - cx) * 180) / Math.PI; // clockwise+ (y down)
			if (e.type === 'down') {
				pcsDragStart = a;
				pcsDragBase = pcsAngles[axis];
				return true;
			}
			if (e.type === 'move' && pcsDragStart !== null) {
				let d = a - pcsDragStart;
				if (d > 180) d -= 360;
				else if (d < -180) d += 360;
				if (flip) d = -d;
				pcsAngles[axis] = Math.max(-45, Math.min(45, Math.round((pcsDragBase + d) * 2) / 2));
				return true;
			}
			if (e.type === 'up') {
				pcsDragStart = null;
				return true;
			}
			return false;
		};
	}
	const pcsRotYaw = pcsRotTool('yaw');
	const pcsRotCoronal = pcsRotTool('pitch'); // pitch arg rotates the coronal plane
	const pcsRotSagittal = pcsRotTool('roll', true); // roll arg: ↺ positive → flip

	function alignAxialTool(e: ToolPointerEvent): boolean {
		if (pcsRotYaw(e)) return true;
		if (segTool(e)) return true;
		if (scanAlignTool(e)) return true;
		return axialTool(e);
	}

	// ---------- guide generation ----------
	let guideParams = $state({ offset: 0.15, thickness: 2.5, regionRadius: 9 });
	let guideInsertion = $state<'auto' | 'vertical'>('auto');
	let guideWindows = $state<{ x: number; y: number; z: number; diameter: number }[]>(
		(() => {
			try {
				const s = data.plan.settings ? JSON.parse(data.plan.settings) : {};
				return Array.isArray(s.guideWindows) ? s.guideWindows : [];
			} catch {
				return [];
			}
		})()
	);
	let windowMode = $state(false);
	let windowDiameter = $state(5);

	// occlusal reference plane (z mm, volume-local) — persisted in plan settings;
	// drives the default implant depth (1 cm below/above per jaw, like the original)
	let occlusalZ = $state<number | null>(
		(() => {
			try {
				const s = data.plan.settings ? JSON.parse(data.plan.settings) : {};
				return typeof s.occlusalZ === 'number' ? s.occlusalZ : null;
			} catch {
				return null;
			}
		})()
	);

	function saveOcclusalZ() {
		let settings: Record<string, unknown> = {};
		try {
			settings = data.plan.settings ? JSON.parse(data.plan.settings) : {};
		} catch {
			settings = {};
		}
		settings.occlusalZ = occlusalZ;
		fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ settings })
		}).catch(() => {});
	}

	/** drawn on coronal/sagittal slice views: horizontal occlusal-plane line, draggable */
	function occlusalOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps || occlusalZ == null) return;
		const S = ps.ds.slices;
		const py = S - 1 - occlusalZ / ps.ds.spacing_z; // slice px (z flipped on these views)
		const cy = t.oy + (py + 0.5) * t.scaleY;
		ctx.strokeStyle = 'rgba(240, 200, 60, 0.85)';
		ctx.setLineDash([7, 4]);
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(0, cy);
		ctx.lineTo(ctx.canvas.clientWidth || ctx.canvas.width, cy);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillStyle = 'rgba(240, 200, 60, 0.95)';
		ctx.font = '10px Inter, sans-serif';
		ctx.fillText('occlusal', 6, cy - 4);
	}

	let occlusalDragging = false;

	/** near-line vertical drag on coronal/sagittal views moves the occlusal plane */
	function occlusalTool(e: ToolPointerEvent): boolean {
		if (!ps || occlusalZ == null || ps.locked) return false;
		const S = ps.ds.slices;
		const lineY = S - 1 - occlusalZ / ps.ds.spacing_z;
		if (e.type === 'down') {
			if (Math.abs(e.py - lineY) > 4) return false;
			occlusalDragging = true;
			return true;
		}
		if (e.type === 'move' && occlusalDragging) {
			const zmm = (S - 1 - e.py) * ps.ds.spacing_z;
			occlusalZ = Math.max(0, Math.min((S - 1) * ps.ds.spacing_z, zmm));
			return true;
		}
		if (e.type === 'up' && occlusalDragging) {
			occlusalDragging = false;
			saveOcclusalZ();
			return true;
		}
		return false;
	}

	function saveGuideWindows() {
		let settings: Record<string, unknown> = {};
		try {
			settings = data.plan.settings ? JSON.parse(data.plan.settings) : {};
		} catch {
			settings = {};
		}
		settings.guideWindows = guideWindows;
		fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ settings })
		}).catch(() => {});
	}

	function onGuideMeshClick(e: { modelId: number; scanLocal: Vec3; volumeLocal: Vec3 }) {
		if (stage === 'guide' && windowMode) {
			guideWindows.push({ ...e.volumeLocal, diameter: windowDiameter });
			saveGuideWindows();
			return;
		}
		onScanMeshClick(e);
	}
	let guideBusy = $state(false);
	let guideError = $state('');
	let guideBaseId = $state<number | null>(null);
	let guideAdvanced = $state<Record<string, unknown>>(
		(() => {
			try {
				const st = data.plan.settings ? JSON.parse(data.plan.settings) : {};
				return st.guideAdvanced && typeof st.guideAdvanced === 'object' ? st.guideAdvanced : {};
			} catch {
				return {};
			}
		})()
	);
	let guideWarnings = $state<string[]>([]);
	let guideRecipes = $state<{ key: string; name: string; description: string; params: Record<string, unknown> }[]>([]);
	let showGuideOptions = $state(false);
	let connectorPreview = $state(false);
	let footprintPreview = $state(false);
	// toolbar customization: hidden measure-tool keys, persisted
	let hiddenTools = $state<string[]>([]);
	let showToolbarAdjust = $state(false);
	const MEASURE_TOOLS = [
		{ key: 'distance', label: 'Distance' },
		{ key: 'angle', label: 'Angle' },
		{ key: 'density', label: 'Bone density (HU)' },
		{ key: 'polyline', label: 'Polyline length' },
		{ key: 'annotation', label: 'Text annotation' },
		{ key: 'auxline', label: 'Auxiliary line' }
	];
	$effect(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('cdx_toolbar_measure') ?? '[]');
			if (Array.isArray(saved)) hiddenTools = saved.filter((k) => typeof k === 'string');
		} catch {
			hiddenTools = [];
		}
	});
	function saveHiddenTools() {
		localStorage.setItem('cdx_toolbar_measure', JSON.stringify(hiddenTools));
	}
	let showProducerExport = $state(false);
	let producer = $state({ offsetAdj: 0, thicknessAdj: 0, printer: '' });
	let printerScales = $state<Record<string, number>>({});
	let producerBusy = $state(false);

	async function openProducerExport() {
		try {
			const r = await fetch('/api/sleeves?printers=1');
			printerScales = (await r.json()).printers ?? {};
		} catch {
			printerScales = {};
		}
		showProducerExport = true;
	}

	async function producerExport() {
		if (!ps) return;
		producerBusy = true;
		try {
			const baseId = guideBaseId ?? guideBases[0]?.id;
			const res = await fetch(`/api/cases/${data.caseData.id}/guide`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					modelId: baseId,
					planId: ps.planId,
					params: {
						...guideParams,
						...guideAdvanced,
						offset: guideParams.offset + producer.offsetAdj,
						thickness: guideParams.thickness + producer.thicknessAdj
					},
					insertion: guideInsertion,
					windows: guideWindows
				})
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				alert(b?.message ?? 'Export generation failed');
				return;
			}
			guideWarnings = b.warnings ?? [];
			await invalidateAll();
			showProducerExport = false;
			alert(
				`Production guide regenerated${producer.printer ? ` for printer "${producer.printer}" (calibration ×${printerScales[producer.printer] ?? 1})` : ''}. Approve the plan to enable the STL download.`
			);
		} finally {
			producerBusy = false;
		}
	}

	/** propose bone-reduction bars between consecutive implants at platform level (editable in Design options) */
	function proposeReductionBars() {
		if (!ps || ps.implants.length < 2) return;
		const pts = [...ps.implants].sort((a, b) => a.x - b.x);
		const bars: Record<string, number>[] = [];
		for (let i = 0; i < pts.length - 1; i++) {
			bars.push({
				x1: pts[i].x,
				y1: pts[i].y,
				x2: pts[i + 1].x,
				y2: pts[i + 1].y,
				width: 4,
				height: 3,
				zTop: (pts[i].z + pts[i + 1].z) / 2 + 1.5
			});
		}
		guideAdvanced = { ...guideAdvanced, reductionBars: bars };
		saveGuideAdvanced();
		guideWarnings = [];
		if (!showGuideOptions) openGuideOptions();
	}

	async function openGuideOptions() {
		if (!guideRecipes.length) {
			try {
				const res = await fetch(`/api/cases/${data.caseData.id}/guide`);
				guideRecipes = (await res.json()).recipes ?? [];
			} catch {
				guideRecipes = [];
			}
		}
		showGuideOptions = !showGuideOptions;
	}

	function saveGuideAdvanced() {
		let st: Record<string, unknown> = {};
		try {
			st = data.plan.settings ? JSON.parse(data.plan.settings) : {};
		} catch {
			st = {};
		}
		st.guideAdvanced = guideAdvanced;
		fetch(`/api/plans/${data.plan.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ settings: st })
		}).catch(() => {});
	}

	async function convertGuideToModel(g: { id: number }) {
		const res = await fetch(`/api/cases/${data.caseData.id}/guide`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ planId: ps?.planId, convertToModel: true })
		});
		const b = await res.json().catch(() => null);
		if (!res.ok) {
			alert(b?.message ?? 'Convert failed');
			return;
		}
		void g;
		await invalidateAll();
	}

	let guideBases = $derived(
		// scans, segmentations, and converted guides / augmentations ('other') — the latter
		// serve as bases for stacked-guide workflows
		ps?.models.filter((m) => m.kind === 'scan' || m.kind === 'segmentation' || m.kind === 'other') ?? []
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
					params: { ...guideParams, ...guideAdvanced },
					insertion: guideInsertion,
					windows: guideWindows
				})
			});
			const bodyJson = await res.json().catch(() => null);
			if (!res.ok) throw new Error(bodyJson?.message ?? `Guide generation failed (${res.status})`);
			guideWarnings = bodyJson.warnings ?? [];
			ps.models.push({
				id: bodyJson.model.id,
				name: bodyJson.model.name,
				kind: 'guide',
				color: bodyJson.model.color,
				opacity: bodyJson.model.opacity,
				visible: true,
				transform: null,
				threshold: segThreshold
			});
		} catch (e) {
			guideError = e instanceof Error ? e.message : 'Guide generation failed';
		} finally {
			guideBusy = false;
		}
	}

	// ---------- patient coordinate system alignment ----------
	let pcsDialog: HTMLDialogElement | undefined = $state();
	let pcsAngles = $state({ yaw: 0, pitch: 0, roll: 0 });
	const pcsPending = $derived(
		pcsAngles.yaw !== 0 || pcsAngles.pitch !== 0 || pcsAngles.roll !== 0
	);
	let pcsBusy = $state(false);
	let pcsCut = $state(false);
	let pcsProposing = $state(false);
	let proposedCurve: { x: number; y: number }[] | null = null;

	async function proposePcs() {
		if (!ps) return;
		pcsProposing = true;
		try {
			const res = await fetch(`/api/datasets/${ps.ds.id}/pcs-propose`, { method: 'POST' });
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				alert(b?.message ?? 'Proposal failed');
				return;
			}
			pcsAngles = { yaw: Math.round(b.yaw * 10) / 10, pitch: Math.round(b.pitch * 10) / 10, roll: Math.round(b.roll * 10) / 10 };
			proposedCurve = b.curve;
			if (b.confidence === 'low')
				alert('Low confidence: not enough bone mass for a reliable proposal — verify the angles before applying.');
		} finally {
			pcsProposing = false;
		}
	}

	async function applyPcs(reset = false) {
		if (!ps) return;
		ps.flushSaves();
		pcsBusy = true;
		try {
			const res = await fetch(`/api/datasets/${ps.ds.id}/align`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(reset ? { reset: true } : pcsAngles)
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				alert(body?.message ?? 'Alignment failed');
				return;
			}
			// adopt the auto-proposed panoramic curve (already in post-align coordinates,
			// so it must be written AFTER /align — which co-rotates the previous curve)
			if (!reset && proposedCurve && ps) {
				await fetch(`/api/plans/${ps.planId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						pan_curve: { control: proposedCurve, z: ps.cursor.z * ps.ds.spacing_z }
					})
				}).catch(() => {});
				proposedCurve = null;
			}
			pcsDialog?.close();
			pcsAngles = { yaw: 0, pitch: 0, roll: 0 };
			location.reload(); // volume replaced — full reload clears every cached slice/preview
		} finally {
			pcsBusy = false;
		}
	}

	// ---------- voxel mask editor (Scanview-style segmentation editing) ----------
	let segEdit = $state({
		active: false,
		tool: 'brush' as 'brush' | 'fill' | 'boundary' | 'area',
		mode: 'add' as 'add' | 'erase',
		brushMM: 2,
		rangeLo: 300,
		busy: '',
		grid: false,
		propagateN: 5,
		lodId: 0
	});
	let maskTick = $state(0);
	let segStats = $state<{ voxels: number; ml: number } | null>(null);
	let segUndoState = $state({ undo: 0, redo: 0 });
	let segBoundaries = $state<Record<string, { x: number; y: number }[][]>>({});
	let boundaryDraft = $state<{ x: number; y: number }[]>([]);
	let areaDraft = $state<{ x: number; y: number }[]>([]);
	let segLodPresets = $state<{ id: number; name: string; isDefault?: boolean }[]>([]);
	let segExtrasLoaded = false;
	$effect(() => {
		if (!segEdit.active || segExtrasLoaded || !ps) return;
		segExtrasLoaded = true;
		const dsId = ps.ds.id;
		fetch('/api/seg-lod')
			.then((r) => r.json())
			.then((b) => {
				segLodPresets = b.presets ?? [];
				const def = segLodPresets.find((x) => x.isDefault);
				if (def) segEdit.lodId = def.id;
			})
			.catch(() => {});
		fetch(`/api/datasets/${dsId}/mask/boundaries`)
			.then((r) => r.json())
			.then((b) => (segBoundaries = b.boundaries ?? b ?? {}))
			.catch(() => {});
		refreshSegStats();
	});

	async function refreshSegStats() {
		if (!ps) return;
		try {
			const r = await fetch(`/api/datasets/${ps.ds.id}/mask/stats`);
			if (r.ok) segStats = await r.json();
		} catch {
			segStats = null;
		}
	}

	async function segHistory(op: 'undo' | 'redo') {
		if (!ps) return;
		const res = await fetch(`/api/datasets/${ps.ds.id}/mask/${op}`, { method: 'POST' });
		if (!res.ok) return;
		const b = await res.json();
		segUndoState = { undo: b.undo ?? 0, redo: b.redo ?? 0 };
		for (const idx of b.slices ?? []) invalidateMaskSlice(ps.ds.id, idx);
		maskTick++;
		refreshSegStats();
	}

	async function segPropagate(dir: 1 | -1) {
		if (!ps) return;
		segEdit.busy = 'Propagating…';
		try {
			const from = ps.cursor.z;
			const to = Math.max(0, Math.min(ps.ds.slices - 1, from + dir * segEdit.propagateN));
			const res = await fetch(`/api/datasets/${ps.ds.id}/mask/propagate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from, to, lo: segEdit.rangeLo, hi: 32767 })
			});
			const b = await res.json().catch(() => null);
			if (!res.ok) {
				alert(b?.message ?? 'Propagation failed');
				return;
			}
			for (const r of b.slices ?? []) invalidateMaskSlice(ps.ds.id, r.index);
			maskTick++;
			refreshSegStats();
			if (b.warnings?.length)
				alert(`Check slice${b.warnings.length > 1 ? 's' : ''} ${b.warnings.join(', ')} — the segmented area changed by more than 40% there.`);
		} finally {
			segEdit.busy = '';
		}
	}

	async function saveBoundaryDraft() {
		if (!ps || boundaryDraft.length < 3) {
			boundaryDraft = [];
			return;
		}
		const key = String(ps.cursor.z);
		const next = { ...segBoundaries, [key]: [...(segBoundaries[key] ?? []), boundaryDraft.map((p) => ({ ...p }))] };
		const res = await fetch(`/api/datasets/${ps.ds.id}/mask/boundaries`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(next)
		});
		if (res.ok) segBoundaries = next;
		boundaryDraft = [];
		maskTick++;
	}

	async function clearSliceBoundaries() {
		if (!ps) return;
		const key = String(ps.cursor.z);
		const next = { ...segBoundaries };
		delete next[key];
		const res = await fetch(`/api/datasets/${ps.ds.id}/mask/boundaries`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(next)
		});
		if (res.ok) segBoundaries = next;
		maskTick++;
	}

	function finishAreaDraft() {
		if (!ps || areaDraft.length < 3) {
			areaDraft = [];
			return;
		}
		const area = areaCm2(areaDraft, ps.ds.spacing_x, ps.ds.spacing_y);
		const cx = areaDraft.reduce((a, p) => a + p.x, 0) / areaDraft.length;
		const cy = areaDraft.reduce((a, p) => a + p.y, 0) / areaDraft.length;
		ps.addMeasurement(
			'annotation',
			[{ x: cx * ps.ds.spacing_x, y: cy * ps.ds.spacing_y, z: ps.cursor.z * ps.ds.spacing_z }],
			area,
			`${area.toFixed(2)} cm²`
		);
		areaDraft = [];
		maskTick++;
	}

	async function maskInit() {
		if (!ps) return;
		segEdit.busy = 'Initializing…';
		try {
			await fetch(`/api/datasets/${ps.ds.id}/mask/init`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ threshold: segEdit.rangeLo })
			});
			invalidateMaskSlice(ps.ds.id);
			maskTick++;
			refreshSegStats();
		} finally {
			segEdit.busy = '';
		}
	}

	async function maskBuildModel() {
		if (!ps) return;
		segEdit.busy = 'Building model…';
		try {
			await flushPaintOps();
			const res = await fetch(`/api/datasets/${ps.ds.id}/mask/build-model`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Custom segmentation', ...(segEdit.lodId ? { lodId: segEdit.lodId } : {}) })
			});
			if (res.ok) {
				const { model } = await res.json();
				ps.models.push({
					id: model.id,
					name: model.name,
					kind: 'segmentation',
					color: model.color,
					opacity: model.opacity ?? 1,
					visible: true,
					transform: null,
					threshold: null
				});
			} else {
				const body = await res.json().catch(() => null);
				alert(body?.message ?? 'Model build failed');
			}
		} finally {
			segEdit.busy = '';
		}
	}

	function maskOverlay(ctx: CanvasRenderingContext2D, t: ViewTransform) {
		if (!ps || !segEdit.active) return;
		const slice = peekMaskSlice(ps.ds.id, ps.cursor.z);
		if (slice) {
			drawMaskOverlay(ctx, t, slice, ctx.canvas.width);
		} else {
			fetchMaskSlice(ps.ds.id, ps.cursor.z).then(() => maskTick++);
		}
		if (segEdit.grid) {
			gridOverlayDraw(ctx, ctx.canvas.width, ctx.canvas.height, 1 / (t.scaleX / ps.ds.spacing_x));
		}
		const polys = segBoundaries[String(ps.cursor.z)] ?? [];
		for (const poly of polys) drawSlicePoly(ctx, t, poly, '#e8d44d', true);
		if (boundaryDraft.length) drawSlicePoly(ctx, t, boundaryDraft, '#e8d44d', false);
		if (areaDraft.length) drawSlicePoly(ctx, t, areaDraft, '#45b8e0', false);
	}

	function drawSlicePoly(
		ctx: CanvasRenderingContext2D,
		t: ViewTransform,
		poly: { x: number; y: number }[],
		color: string,
		close: boolean
	) {
		if (poly.length < 2) {
			if (poly.length === 1) {
				const c = toCanvas(t, poly[0].x, poly[0].y);
				ctx.fillStyle = color;
				ctx.fillRect(c.x - 2, c.y - 2, 4, 4);
			}
			return;
		}
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		const p0 = toCanvas(t, poly[0].x, poly[0].y);
		ctx.moveTo(p0.x, p0.y);
		for (let i = 1; i < poly.length; i++) {
			const c = toCanvas(t, poly[i].x, poly[i].y);
			ctx.lineTo(c.x, c.y);
		}
		if (close) ctx.closePath();
		ctx.stroke();
	}

	function segTool(e: ToolPointerEvent): boolean {
		if (!ps || !segEdit.active || ps.locked) return false;
		const dsId = ps.ds.id;
		const index = ps.cursor.z;
		if (segEdit.tool === 'boundary') {
			if (e.type === 'down') {
				boundaryDraft.push({ x: e.px, y: e.py });
				maskTick++;
			}
			return true;
		}
		if (segEdit.tool === 'area') {
			if (e.type === 'down') {
				areaDraft.push({ x: e.px, y: e.py });
				maskTick++;
			}
			return true;
		}
		if (segEdit.tool === 'fill') {
			if (e.type === 'down') {
				segEdit.busy = 'Filling…';
				fetch(`/api/datasets/${dsId}/mask/fill`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						index,
						x: Math.round(e.px),
						y: Math.round(e.py),
						lo: segEdit.rangeLo,
						mode: segEdit.mode
					})
				})
					.then(() => {
						invalidateMaskSlice(dsId, index);
						maskTick++;
						refreshSegStats();
					})
					.finally(() => (segEdit.busy = ''));
			}
			return true;
		}
		// brush
		if (e.type === 'down' || e.type === 'move') {
			const r = Math.max(1, segEdit.brushMM / ps.ds.spacing_x);
			const value = segEdit.mode === 'add' ? 1 : 0;
			paintLocal(dsId, index, e.px, e.py, r, value);
			queuePaintOp(dsId, index, { x: e.px, y: e.py, r, mode: segEdit.mode });
			maskTick++;
			return true;
		}
		if (e.type === 'up') {
			flushPaintOps().then(() => refreshSegStats());
			return true;
		}
		return false;
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
					transform: null,
					threshold: null
				});
			}
		} finally {
			segBusy = false;
		}
	}

	// ---------- DICOM upload ----------
	let uploading = $state(false);
	let wizardFiles = $state<File[] | null>(null);
	type CustomSleeveSys = {
		id: number;
		name: string;
		segments: { height: number; upperDiameter: number; lowerDiameter: number; distanceToZeroLevel: number }[];
	};
	let customSleeves = $state<CustomSleeveSys[]>([]);
	let customSleevesLoaded = false;
	$effect(() => {
		if (stage !== 'sleeve' || customSleevesLoaded) return;
		customSleevesLoaded = true;
		fetch('/api/sleeves')
			.then((r) => r.json())
			.then((b) => (customSleeves = b.systems ?? []))
			.catch(() => {});
	});

	let showImplantPicker = $state(false);
	let pickerFavorites = $state<string[]>([]);

	async function openImplantPicker() {
		try {
			const res = await fetch('/api/favorites');
			pickerFavorites = (await res.json()).favorites ?? [];
		} catch {
			pickerFavorites = [];
		}
		showImplantPicker = true;
	}

	let nerveDetecting = $state(false);
	let showAngleDialog = $state(false);
	let showAbutmentAngles = $state(false);

	/** Review stepping: select the prev/next point of the nerve and center all views on it. */
	function stepNervePoint(n: { id: number; points: { x: number; y: number; z: number }[] }, dir: -1 | 1) {
		if (!ps?.lastNervePoint) return;
		const i = Math.max(0, Math.min(n.points.length - 1, ps.lastNervePoint.index + dir));
		ps.lastNervePoint = { nerveId: n.id, index: i };
		const pt = n.points[i];
		ps.cursor.z = Math.max(0, Math.min(ps.ds.slices - 1, Math.round(pt.z / ps.ds.spacing_z)));
		ps.cursor.x = Math.round(pt.x / ps.ds.spacing_x);
		ps.cursor.y = Math.round(pt.y / ps.ds.spacing_y);
	}

	async function autoDetectNerve(nerveId: number) {
		if (!ps) return;
		const n = ps.nerves.find((x) => x.id === nerveId);
		if (!n || n.points.length < 2) return;
		const nVia = n.points.length - 2;
		const msg =
			nVia > 0
				? `Detect the nerve canal from marker 1 to marker ${n.points.length}, routing through the ${nVia} intermediate marker${nVia === 1 ? '' : 's'}? The markers will be replaced by the detected path.`
				: 'Detect the nerve canal between the two placed markers? They will be replaced by the detected path.';
		if (!confirm(msg)) return;
		nerveDetecting = true;
		try {
			const res = await fetch(`/api/datasets/${ps.ds.id}/nerve-detect`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					start: n.points[0],
					end: n.points[n.points.length - 1],
					via: n.points.slice(1, -1).map((p) => ({ x: p.x, y: p.y, z: p.z }))
				})
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				alert(b?.message ?? 'No canal path found between the seed points');
				return;
			}
			const { points, warning } = await res.json();
			ps.markEdit();
			const d0 = n.points[0].d;
			n.points = points.map((pt: { x: number; y: number; z: number }) => ({ ...pt, d: d0 }));
			ps.saveNerve(n.id);
			if (warning) alert(warning);
		} finally {
			nerveDetecting = false;
		}
	}

	async function alignImplantsTo(ids: number[], axis: { x: number; y: number; z: number }) {
		if (!ps) return;
		ps.markEdit();
		for (const id of ids) {
			const im = ps.implants.find((i) => i.id === id);
			if (!im) continue;
			im.ax = axis.x;
			im.ay = axis.y;
			im.az = axis.z;
			await fetch(`/api/implants/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ax: axis.x, ay: axis.y, az: axis.z })
			});
		}
	}
	let advInput: HTMLInputElement | undefined = $state();
	let uploadError = $state('');
	let dragOver = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	async function uploadFiles(files: FileList | File[]) {
		const list = Array.from(files);
		if (list.length === 0) return;
		ps?.flushSaves();
		uploading = true;
		uploadError = '';
		try {
			// route surface scans (.stl/.ply/.obj) to model import, the rest to DICOM
			const modelFiles = list.filter((f) => /\.(stl|ply|obj)$/i.test(f.name));
			const dicomFiles = list.filter((f) => !/\.(stl|ply|obj)$/i.test(f.name));

			// advanced import mode: route DICOM files through the wizard instead
			if (dicomFiles.length && localStorage.getItem('cdx_advanced_import') === '1') {
				wizardFiles = dicomFiles;
				uploading = false;
				if (!modelFiles.length) return;
			}

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

			if (dicomFiles.length && !wizardFiles) {
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
				// verify patient identity: warn when the DICOM tags disagree with the record
				const { dataset } = await res.json().catch(() => ({ dataset: null }));
				const dicomName = String(dataset?.patient_name ?? '').replace('^', ', ').toLowerCase();
				const recordName = `${data.patient.last_name}, ${data.patient.first_name}`.toLowerCase();
				if (
					dicomName &&
					recordName.trim() !== ',' &&
					!dicomName.includes(data.patient.last_name.toLowerCase()) &&
					data.patient.last_name
				) {
					alert(
						`Verify patient data: the DICOM files report "${dataset.patient_name}" but this record is "${data.patient.last_name}, ${data.patient.first_name}". The record was NOT overwritten — make sure the data was imported into the correct patient.`
					);
				}
				offerAiAfterImport = true;
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

<input
	type="file"
	accept=".json,.cdxplan.json"
	hidden
	bind:this={planImportInput}
	onchange={(e) => e.currentTarget.files?.[0] && importPlanFile(e.currentTarget.files[0])}
/>

{#snippet maxBtn(key: string)}
	<button
		class="max-btn"
		title={maximized === key ? 'Restore (Esc)' : 'Maximize view'}
		onclick={() => (maximized = maximized === key ? null : key)}
	>
		{maximized === key ? '🗗' : '⛶'}
	</button>
{/snippet}

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

	<nav class="stage-bar" class:stage-bar-hidden={easyMode}>
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
	{#if ps}
		<button class="btn ghost" title="Undo (Ctrl+Z)" disabled={!ps.canUndo} onclick={() => ps?.undo()}>
			↶
		</button>
		<button class="btn ghost" title="Redo (Ctrl+Shift+Z)" disabled={!ps.canRedo} onclick={() => ps?.redo()}>
			↷
		</button>
	{/if}
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
	{#if data.plan.sent}
		<span class="badge new" title="This plan was sent to a contact and is write-protected">sent</span>
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
				<button
					class="plan-menu-item"
					onclick={async () => {
						planMenuOpen = false;
						await fetch(`/api/plans/${data.plan.id}`, {
							method: 'PATCH',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ jaw: data.plan.jaw === 'maxilla' ? 'mandible' : 'maxilla' })
						});
						await invalidateAll();
					}}
				>
					Jaw: {data.plan.jaw} → switch to {data.plan.jaw === 'maxilla' ? 'mandible' : 'maxilla'}
				</button>
				<button class="plan-menu-item" onclick={duplicatePlanAction}>Duplicate this plan</button>
				{#if data.plans.length > 1}
					<button
						class="plan-menu-item"
						onclick={() => {
							planMenuOpen = false;
							compareOpen = true;
						}}>Compare plans…</button
					>
				{/if}
				<button class="plan-menu-item" onclick={renamePlanAction}>Rename…</button>
				<button class="plan-menu-item" onclick={() => togglePlanFlag('locked')}>
					{data.plan.locked ? 'Unlock plan' : 'Lock plan'}
				</button>
				<button class="plan-menu-item" onclick={() => togglePlanFlag('approved')}>
					{data.plan.approved ? 'Revoke approval' : 'Approve plan'}
				</button>
				<button
					class="plan-menu-item"
					onclick={async () => {
						planMenuOpen = false;
						const res = await fetch(`/api/plans/${data.plan.id}/share`, { method: 'POST' });
						if (res.ok) {
							const { url } = await res.json();
							prompt('Read-only share link (copy with Ctrl+C):', url);
						}
					}}>Share read-only link…</button
				>
				<button
					class="plan-menu-item"
					onclick={async () => {
						planMenuOpen = false;
						const res = await fetch('/api/contacts');
						const { contacts } = res.ok ? await res.json() : { contacts: [] };
						if (!contacts?.length) {
							alert('No contacts yet — add one on the Contacts page first.');
							return;
						}
						const list = contacts
							.map((c: { id: number; name: string }, i: number) => `${i + 1}. ${c.name}`)
							.join('\n');
						const pick = prompt(`Send read-only plan to which contact?\n${list}\n\nEnter the number:`, '1');
						const idx = Number(pick) - 1;
						if (!Number.isInteger(idx) || !contacts[idx]) return;
						const comment = prompt('Comment for the recipient (optional):') ?? '';
						const send = await fetch(`/api/plans/${data.plan.id}/send`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ contactId: contacts[idx].id, comment })
						});
						if (send.ok) {
							alert('Plan sent — it is now write-protected. Track it in the Inbox.');
							await invalidateAll();
						} else {
							const b = await send.json().catch(() => null);
							alert(b?.message ?? 'Send failed');
						}
					}}>Send to contact…</button
				>
				<a
					class="plan-menu-item"
					href="/api/plans/{data.plan.id}/export"
					onclick={() => (planMenuOpen = false)}>Export plan (.cdxplan)</a
				>
				<button
					class="plan-menu-item"
					title="Export model scan and implant positions for processing in CAD/CAM systems (STL, implant or abutment level, optional scanbodies/analogs)"
					onclick={() => {
						planMenuOpen = false;
						showVpe = true;
					}}>Virtual Planning Export…</button
				>
				<button
					class="plan-menu-item"
					onclick={() => {
						planMenuOpen = false;
						planImportInput?.click();
					}}>Import plan…</button
				>
				{#if !data.plan.is_master}
					<button class="plan-menu-item danger-item" onclick={deletePlanAction}>Delete plan</button>
				{/if}
			</div>
		{/if}
	</div>
</header>

<div class="workspace">
	<aside class="object-tree panel">
		{#if easyMode}
			<div class="panel-header">Workflow</div>
			<div class="easy-rail">
				{#each easySteps as step (step.title)}
					<div class="easy-step">
						<div class="easy-step-title">{step.title}</div>
						{#each step.subs as sub (sub.key)}
							<button
								class="easy-sub"
								class:easy-current={stage === sub.key}
								disabled={sub.key !== 'data' && !hasVolume}
								onclick={() => (stage = sub.key)}
							>
								<span class="easy-check" class:easy-done={stageDone[sub.key]}>
									{#if stageDone[sub.key]}<Icon name="check" size={9} />{/if}
								</span>
								{sub.label}
							</button>
						{/each}
					</div>
				{/each}
				<div class="easy-step">
					<div class="easy-step-title">4. Finish</div>
					<a class="easy-sub" href="/cases/{data.caseData.id}/report">
						<span class="easy-check" class:easy-done={stageDone.report}>
							{#if stageDone.report}<Icon name="check" size={9} />{/if}
						</span>
						Protocol & report
					</a>
				</div>
				<div class="easy-nav">
					<button class="btn" disabled={easyOrder.indexOf(stage) <= 0} onclick={() => easyStep(-1)}>
						<Icon name="back" size={13} /> Back
					</button>
					<button
						class="btn primary"
						disabled={easyOrder.indexOf(stage) >= easyOrder.length - 1 || !hasVolume}
						onclick={() => easyStep(1)}
					>
						Next <Icon name="chevron" size={13} />
					</button>
				</div>
				{#if EASY_HELP[stage]}
					<div class="easy-help">
						<button class="easy-help-head" onclick={() => (easyHelpOpen = !easyHelpOpen)}>
							? Help — this step
							<Icon name={easyHelpOpen ? 'chevron-down' : 'chevron'} size={11} />
						</button>
						{#if easyHelpOpen}
							<p class="easy-help-body">{EASY_HELP[stage]}</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		<div class="panel-header">Objects</div>
		<div class="tree">
			<div class="tree-group">
				<div class="tree-group-label">Volume data</div>
				{#each data.datasets as d (d.id)}
					<div class="dataset-card panel">
						<Icon name="volume" size={22} />
						<div class="dataset-info">
							<div>
								<strong>{d.series_description || d.description}</strong>
								{#if d.locked}<span class="badge">locked</span>{/if}
								{#if d.status === 'ready'}
									<span class="status-ic ok" title="Processing finished — dataset ready">
										<Icon name="check" size={11} />
									</span>
								{:else if d.status === 'error'}
									<span class="status-ic err" title="Processing failed"><Icon name="warning" size={11} /></span>
								{:else}
									<span class="status-ic busy" title="Processing… ({d.status})">⏳</span>
								{/if}
							</div>
							<div class="faint">
								{d.modality} · {d.cols}×{d.rows}×{d.slices} ·
								{d.spacing_x.toFixed(2)}/{d.spacing_y.toFixed(2)}/{d.spacing_z.toFixed(2)} mm
								{d.patient_name ? ` · ${d.patient_name}` : ''}
							</div>
							{#if d.import_warnings}
								<div class="warn-text" title={d.import_warnings}>
									<Icon name="warning" size={11} /> imported with warnings: {d.import_warnings}
								</div>
							{/if}
						</div>
						<button
							class="btn ghost"
							title={d.locked
								? 'Unlock dataset (allow changes and deletion)'
								: 'Lock dataset against changes and deletion'}
							onclick={async () => {
								await fetch(`/api/datasets/${d.id}`, {
									method: 'PATCH',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ locked: !d.locked })
								});
								await invalidateAll();
							}}
						>
							{d.locked ? '🔒' : '🔓'}
						</button>
						<button
							class="btn ghost danger"
							title="Delete dataset (volume and preview files are removed)"
							disabled={!!d.locked}
							onclick={async () => {
								if (!confirm(`Delete dataset "${d.series_description || d.description}"?`)) return;
								const res = await fetch(`/api/datasets/${d.id}`, { method: 'DELETE' });
								if (!res.ok) {
									const b = await res.json().catch(() => null);
									alert(b?.message ?? 'Delete failed');
									return;
								}
								await invalidateAll();
							}}
						>
							<Icon name="trash" size={14} />
						</button>
					</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">
					Models
					{#if ps?.models.length}
						<button
							class="tree-eye group-eye"
							title="Toggle all models"
							onclick={() => {
								if (!ps) return;
								const show = !ps.models.every((m) => m.visible);
								for (const m of ps.models) {
									m.visible = show;
									ps.saveModel(m.id);
								}
							}}
						>
							<Icon name={ps.models.every((m) => m.visible) ? 'eye' : 'eye-off'} size={12} />
						</button>
					{/if}
				</div>
				{#each ps?.models ?? [] as m (m.id)}
					<div class="tree-item">
						<span class="dot" style="background:{m.color}"></span>
						<button
							class="tree-item-label tree-label-btn"
							title="{m.kind} — click for appearance options"
							onclick={() => {
								expandedModelId = expandedModelId === m.id ? null : m.id;
								resegThreshold = m.threshold ?? 300;
							}}
						>
							{m.name}
						</button>
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
					{#if expandedModelId === m.id}
						<div class="model-props">
							<label class="mp-row">
								<span>Color</span>
								<input
									type="color"
									value={m.color}
									onchange={(e) => {
										m.color = e.currentTarget.value;
										ps?.saveModel(m.id);
									}}
								/>
							</label>
							<label class="mp-row">
								<span>Opacity</span>
								<input
									type="range"
									min="0.1"
									max="1"
									step="0.05"
									value={m.opacity}
									oninput={(e) => {
										m.opacity = Number(e.currentTarget.value);
										ps?.saveModel(m.id);
									}}
								/>
							</label>
							<div class="mp-row">
								<button
									class="btn"
									onclick={() => {
										const name = prompt('Model name:', m.name);
										if (name) {
											m.name = name;
											ps?.saveModel(m.id);
										}
									}}>Rename</button
								>
								{#if m.kind === 'segmentation'}
									<input
										type="number"
										step="50"
										value={m.threshold ?? 300}
										title="Threshold (HU)"
										style="width:64px"
										onchange={(e) => (resegThreshold = Number(e.currentTarget.value))}
									/>
									<button
										class="btn"
										disabled={resegBusy}
										title="Regenerate the surface at this threshold"
										onclick={async () => {
											if (!ps) return;
											resegBusy = true;
											await ps.resegmentModel(m.id, resegThreshold ?? m.threshold ?? 300);
											resegBusy = false;
										}}
									>
										{resegBusy ? '…' : '↻ HU'}
									</button>
								{/if}
							</div>
						</div>
					{/if}
				{:else}
					<div class="tree-empty">none</div>
				{/each}
			</div>
			<div class="tree-group">
				<div class="tree-group-label">
					Implants
					{#if ps?.implants.length}
						<button
							class="tree-eye group-eye"
							title="Toggle all implants"
							onclick={() => {
								if (!ps) return;
								const show = !ps.implants.every((i) => i.visible);
								for (const i of ps.implants) {
									i.visible = show;
									ps.saveImplant(i.id);
								}
							}}
						>
							<Icon name={ps.implants.every((i) => i.visible) ? 'eye' : 'eye-off'} size={12} />
						</button>
					{/if}
				</div>
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
							>{im.tooth ? `${toothLabel(im.tooth, notation)} — ` : ''}⌀{im.diameter}×{im.length}</span
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
				<div class="tree-group-label">
					Nerves
					{#if ps?.nerves.length}
						<button
							class="tree-eye group-eye"
							title="Toggle all nerves"
							onclick={() => {
								if (!ps) return;
								const show = !ps.nerves.every((n) => n.visible);
								for (const n of ps.nerves) {
									n.visible = show;
									ps.saveNerve(n.id);
								}
							}}
						>
							<Icon name={ps.nerves.every((n) => n.visible) ? 'eye' : 'eye-off'} size={12} />
						</button>
					{/if}
				</div>
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
					<label class="checkbox-row">
						<input type="checkbox" bind:checked={ps.showImplantAxes} />
						<span>Implant axes</span>
					</label>
					<label class="checkbox-row">
						<input type="checkbox" bind:checked={ps.showCrestalPlanes} />
						<span>Crestal planes</span>
					</label>
					<label class="checkbox-row">
						<input type="checkbox" bind:checked={ps.showSelectionBox} />
						<span>Selection box</span>
					</label>
					{#if selectedImplant && densityInfo?.profile?.length}
						<label for="density-profile">Density along implant</label>
						<div class="density-panel" id="density-profile" title="Mean HU per depth level, head (top) → apex (bottom)">
							{#each densityInfo.profile as hu, i (i)}
								{@const frac = Math.max(0, Math.min(1, (hu + 100) / 1600))}
								<div class="density-row">
									<div
										class="density-bar"
										style="width:{(frac * 100).toFixed(0)}%; background:{hu > 1250
											? '#e8e8e8'
											: hu > 850
												? '#bcd4e6'
												: hu > 350
													? '#7fb8d4'
													: hu > 150
														? '#e0b864'
														: '#c97f5c'}"
									></div>
									<span class="density-val">{hu}</span>
								</div>
							{/each}
							<div class="density-foot muted">
								Ø {densityInfo.mean} HU · {boneClass(densityInfo.mean)} · head→apex
							</div>
							<div class="density-foot faint" title="CBCT grayscale values are not calibrated Hounsfield units">
								Note: CBCT HU values are approximate
							</div>
						</div>
					{/if}
					<label for="measure-tools">Measure (axial view)</label>
					<button
						class="btn perio-btn"
						title="Periodontal charting: bone-loss values in six directions per tooth (calculated planning aid)"
						onclick={() => (showPerio = true)}
					>
						Perio chart…
					</button>
					<div
						class="measure-row"
						id="measure-tools"
						role="toolbar"
						tabindex="-1"
						title="Right-click to adjust which tools are shown"
						oncontextmenu={(e) => {
							e.preventDefault();
							showToolbarAdjust = true;
						}}
					>
						<button
							class="btn"
							class:tool-hidden={hiddenTools.includes('distance')}
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
							class:tool-hidden={hiddenTools.includes('angle')}
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
							class:tool-hidden={hiddenTools.includes('density')}
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
						<button
							class="btn"
							class:tool-hidden={hiddenTools.includes('polyline')}
							class:primary={ps.measureTool === 'polyline'}
							title="Continuous distance: click points, then Finish"
							onclick={() => {
								if (!ps) return;
								if (ps.measureTool === 'polyline') {
									finishPolyline(ps);
								} else {
									ps.pendingMeasure.length = 0;
									ps.measureTool = 'polyline';
								}
							}}
						>
							{ps.measureTool === 'polyline' ? `✓ ${ps.pendingMeasure.length}` : '∿'}
						</button>
						<button
							class="btn"
							class:tool-hidden={hiddenTools.includes('annotation')}
							class:primary={ps.measureTool === 'annotation'}
							title="Annotation: click a point, then enter text"
							onclick={() => {
								if (!ps) return;
								ps.pendingMeasure.length = 0;
								ps.measureTool = ps.measureTool === 'annotation' ? 'none' : 'annotation';
							}}
						>
							T
						</button>
						<button
							class="btn"
							class:tool-hidden={hiddenTools.includes('auxline')}
							class:primary={ps.measureTool === 'auxline'}
							title="Auxiliary line: two points, no value"
							onclick={() => {
								if (!ps) return;
								ps.pendingMeasure.length = 0;
								ps.measureTool = ps.measureTool === 'auxline' ? 'none' : 'auxline';
							}}
						>
							⟍
						</button>
					</div>
				</div>
			</div>
		{/if}
	</aside>

	<main
		class="view-area"
		class:edit-cursor={!!ps && (ps.nerveEditMode || ps.curveEditMode || windowMode || segEdit.active || pcsDragMode)}
	>
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
				{#if data.datasets.length >= 2}
					<p class="muted" style="text-align:center">
						Two datasets on this case — if this is a dual-scan template pair, use
						<strong>Align stage → Match template…</strong> for automatic marker registration.
					</p>
				{/if}
				<div class="adv-row">
					<button class="btn" onclick={() => advInput?.click()}>
						<Icon name="settings" size={14} /> Advanced import… (slice selection, crop, gantry, histogram)
					</button>
					<button class="btn" onclick={() => (showPackageImport = true)}>
						<Icon name="import" size={14} /> Import order package…
					</button>
					<input
						type="file"
						multiple
						accept=".dcm,.zip,application/zip,application/dicom"
						hidden
						bind:this={advInput}
						onchange={(e) => {
							const fl = e.currentTarget.files;
							if (fl?.length) wizardFiles = Array.from(fl);
						}}
					/>
				</div>

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
						class:primary={ps.curveEditMode && panoGuidedStep < 0}
						onclick={() => {
							if (!ps) return;
							panoGuidedStep = -1;
							ps.curveEditMode = !ps.curveEditMode;
						}}
					>
						<Icon name="edit" size={14} />
						{ps.curveEditMode && panoGuidedStep < 0
							? 'Drawing curve — click along the arch'
							: 'Draw curve'}
					</button>
					<button
						class="btn"
						class:primary={panoGuidedStep >= 0}
						title="Place the five named anatomical markers one by one; the curve is assembled automatically"
						onclick={startGuidedCurve}
					>
						Guided markers
					</button>
					{#if panoGuidedStep >= 0}
						<span class="muted">
							Marker {panoGuidedStep + 1}/{PANO_GUIDED_MARKERS.length}:
							<strong>{PANO_GUIDED_MARKERS[panoGuidedStep]}</strong>
						</span>
					{/if}
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
						<button
							class="btn"
							disabled={!ps.models.some((m) => m.kind === 'scan' && m.id !== (matching.modelId ?? scanModels[0]?.id) && m.transform)}
							title="Copy the registration of an already-aligned scan of the same situation to this one"
							onclick={copyAlignment}
						>
							Copy alignment…
						</button>
						<button
							class="btn"
							class:primary={scanDragMode}
							title="Drag the scan on the axial view; hold Shift to rotate"
							onclick={() => (scanDragMode = !scanDragMode)}
						>
							{scanDragMode ? 'Dragging scan (Shift = rotate)' : 'Drag scan'}
						</button>
						<button
							class="btn"
							class:primary={showFineAlign}
							title="Fine alignment: nudge the scan by numeric steps (patient- or object-oriented)"
							onclick={() => {
								if (matching.modelId == null) matching.modelId = scanModels[0]?.id ?? null;
								showFineAlign = !showFineAlign;
							}}
						>
							Fine align…
						</button>
						<button class="btn" disabled={!!meshToolBusy} title="Remove degenerate/duplicate triangles, unify winding" onclick={() => repairModel('repair')}>
							{meshToolBusy === 'repair' ? '…' : 'Repair'}
						</button>
						<button class="btn" disabled={!!meshToolBusy} title="Check the mesh for issues" onclick={() => repairModel('detect')}>
							Check
						</button>
						<button class="btn" disabled={!!meshToolBusy} title="Smooth locally around the last clicked scan point" onclick={() => meshEditOp('smooth')}>
							Smooth
						</button>
						<button class="btn" disabled={!!meshToolBusy} title="Close small holes in the mesh" onclick={() => meshEditOp('fillHoles')}>
							Fill holes
						</button>
						<button class="btn" title="Replace the mesh file, keeping the alignment" onclick={() => replaceInput?.click()}>
							Replace…
						</button>
						<input type="file" accept=".stl,.ply" hidden bind:this={replaceInput} onchange={(e) => replaceModelFile(e.currentTarget.files)} />
						{#if matching.lastRms != null}
							<span class="muted">fit RMS {matching.lastRms.toFixed(2)} mm</span>
						{/if}
						<div class="tool-sep"></div>
					{/if}
					<button class="btn" onclick={() => pcsDialog?.showModal()}>
						<Icon name="rotate" size={14} /> Align patient axes…
					</button>
					<button
						class="btn"
						class:primary={pcsDragMode}
						title="Drag in a slice view to rotate the patient axes around that view's center (axial = yaw, sagittal = pitch, coronal = roll); the image previews the pending rotation live"
						onclick={() => (pcsDragMode = !pcsDragMode)}
					>
						{pcsDragMode ? 'Rotating in views — drag a slice' : 'Rotate in views'}
					</button>
					<button
						class="btn"
						class:primary={occlusalZ != null}
						title="Toggle the occlusal reference plane (set to the current axial slice; drag the yellow line in the coronal/sagittal views to adjust). New implants default to 10 mm below (mandible) / above (maxilla) this plane."
						onclick={() => {
							if (!ps) return;
							occlusalZ = occlusalZ == null ? ps.cursor.z * ps.ds.spacing_z : null;
							saveOcclusalZ();
						}}
					>
						{occlusalZ == null ? 'Occlusal plane' : `Occlusal ${occlusalZ.toFixed(1)} mm ×`}
					</button>
					{#if pcsPending}
						<span class="muted">
							yaw {pcsAngles.yaw.toFixed(1)}° · pitch {pcsAngles.pitch.toFixed(1)}° · roll {pcsAngles.roll.toFixed(1)}°
						</span>
						<button class="btn primary" disabled={pcsBusy} onclick={() => applyPcs()}>
							{pcsBusy ? 'Applying…' : 'Apply rotation'}
						</button>
						<button
							class="btn"
							title="Discard the pending (not yet applied) rotation"
							onclick={() => (pcsAngles = { yaw: 0, pitch: 0, roll: 0 })}
						>
							Discard
						</button>
					{/if}
					{#if data.datasets.length >= 2}
						<button
							class="btn"
							title="Dual-scan template protocol: detect the radiopaque markers in both scans and register them automatically"
							onclick={() => (showTemplateMatch = true)}
						>
							Match template…
						</button>
					{/if}
					<div class="tool-sep"></div>
					<button
						class="btn"
						class:primary={segEdit.active}
						title="Voxel segmentation editor: paint/fill on the axial view"
						onclick={() => (segEdit.active = !segEdit.active)}
					>
						<Icon name="edit" size={14} /> {segEdit.active ? 'Editing mask' : 'Edit segmentation'}
					</button>
					{#if segEdit.active}
						<button class="btn" disabled={!!segEdit.busy} title="Initialize the mask from a HU threshold" onclick={maskInit}>
							Init ≥
						</button>
						<input
							type="number"
							step="50"
							bind:value={segEdit.rangeLo}
							title="Threshold / fill range lower bound (HU)"
							style="width:64px"
						/>
						<select bind:value={segEdit.tool} title="Tool">
							<option value="brush">Brush</option>
							<option value="fill">Flood fill</option>
							<option value="boundary">Boundary polyline</option>
							<option value="area">Area (cm²)</option>
						</select>
						<select bind:value={segEdit.mode} title="Add or erase">
							<option value="add">Add</option>
							<option value="erase">Erase</option>
						</select>
						{#if segEdit.tool === 'brush'}
							<input
								type="range"
								min="0.5"
								max="8"
								step="0.5"
								bind:value={segEdit.brushMM}
								title="Brush radius (mm)"
								style="width:80px"
							/>
							<span class="muted">{segEdit.brushMM.toFixed(1)} mm</span>
						{/if}
						{#if segEdit.tool === 'boundary'}
							<button class="btn" disabled={boundaryDraft.length < 3} onclick={saveBoundaryDraft}>
								Close boundary ({boundaryDraft.length})
							</button>
							<button class="btn" disabled={!boundaryDraft.length} onclick={() => (boundaryDraft = [])}>
								Cancel
							</button>
							<button
								class="btn danger"
								disabled={!segBoundaries[String(ps.cursor.z)]?.length}
								onclick={clearSliceBoundaries}
								title="Remove all boundary polylines on this slice"
							>
								Clear slice
							</button>
						{/if}
						{#if segEdit.tool === 'area'}
							<button class="btn" disabled={areaDraft.length < 3} onclick={finishAreaDraft}>
								Close area ({areaDraft.length})
							</button>
							<button class="btn" disabled={!areaDraft.length} onclick={() => (areaDraft = [])}>
								Cancel
							</button>
						{/if}
						<button class="btn" title="Undo last mask edit" onclick={() => segHistory('undo')}>↶</button>
						<button class="btn" title="Redo mask edit" onclick={() => segHistory('redo')}>↷</button>
						<span title="Propagate the current slice's mask to neighbouring slices (threshold- and boundary-aware)">
							<button class="btn" disabled={!!segEdit.busy} onclick={() => segPropagate(-1)}>⇞</button>
							<input
								type="number"
								min="1"
								max="40"
								bind:value={segEdit.propagateN}
								style="width:44px"
								title="Slices to propagate"
							/>
							<button class="btn" disabled={!!segEdit.busy} onclick={() => segPropagate(1)}>⇟</button>
						</span>
						<button class="btn" class:primary={segEdit.grid} title="Measurement grid (1 mm)" onclick={() => (segEdit.grid = !segEdit.grid)}>
							<Icon name="grid" size={13} />
						</button>
						{#if segLodPresets.length}
							<select bind:value={segEdit.lodId} title="Level-of-detail preset for model build">
								<option value={0}>Full detail</option>
								{#each segLodPresets as lp (lp.id)}
									<option value={lp.id}>{lp.name}</option>
								{/each}
							</select>
						{/if}
						{#if segStats}
							<span class="muted" title="Segmented volume">{segStats.ml.toFixed(2)} ml</span>
						{/if}
						<button class="btn primary" disabled={!!segEdit.busy} onclick={maskBuildModel}>
							{segEdit.busy || 'Build 3D model'}
						</button>
					{/if}
					<div class="tool-sep"></div>
					<label class="inline-label" for="seg-th">Bone HU</label>
					<input id="seg-th" type="number" step="50" bind:value={segThreshold} style="width:70px" />
					<button class="btn" disabled={segBusy} onclick={createBoneModel}>
						<Icon name="volume" size={14} />
						{segBusy ? 'Segmenting…' : 'Create bone model'}
					</button>
					<button
						class="btn"
						title="Plan an augmentation: draw closed outlines with the boundary tool, then define the filling"
						onclick={() => (showAugment = true)}
					>
						Augment…
					</button>
					<button class="btn" disabled={aiBusy} title="Automatic multi-structure segmentation (offline heuristic)" onclick={runAiSegmentation}>
						{aiBusy ? 'AI running…' : 'AI segmentation'}
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
					{#if ps.lastNervePoint && ps.activeNerveId === ps.lastNervePoint.nerveId}
						{@const pn = ps.nerves.find((n) => n.id === ps?.lastNervePoint?.nerveId)}
						{#if pn && ps.lastNervePoint.index < pn.points.length}
							<div class="tool-sep"></div>
							<label class="inline-label" for="np-d">Point ⌀</label>
							<input
								id="np-d"
								class="chip-num"
								type="number"
								min="0.5"
								max="6"
								step="0.5"
								value={pn.points[ps.lastNervePoint.index].d ?? pn.diameter}
								onchange={(e) => {
									if (!ps?.lastNervePoint) return;
									pn.points[ps.lastNervePoint.index].d = Number(e.currentTarget.value) || pn.diameter;
									ps.saveNerve(pn.id);
								}}
							/>
							<button
								class="btn"
								title="Apply this diameter to all points"
								onclick={() => {
									if (!ps?.lastNervePoint) return;
									const d = pn.points[ps.lastNervePoint.index].d ?? pn.diameter;
									for (const p of pn.points) p.d = d;
									ps.saveNerve(pn.id);
								}}
							>
								Apply to all
							</button>
							<button
								class="btn"
								title="Center all views on this nerve point"
								onclick={() => {
									if (!ps?.lastNervePoint) return;
									const pt = pn.points[ps.lastNervePoint.index];
									ps.cursor.z = Math.max(0, Math.min(ps.ds.slices - 1, Math.round(pt.z / ps.ds.spacing_z)));
									ps.cursor.x = Math.round(pt.x / ps.ds.spacing_x);
									ps.cursor.y = Math.round(pt.y / ps.ds.spacing_y);
								}}
							>
								Center views
							</button>
							<button
								class="btn"
								title="Select the previous nerve point and center the views on it"
								disabled={ps.lastNervePoint.index <= 0}
								onclick={() => stepNervePoint(pn, -1)}
							>
								◀ Prev point
							</button>
							<button
								class="btn"
								title="Select the next nerve point and center the views on it"
								disabled={ps.lastNervePoint.index >= pn.points.length - 1}
								onclick={() => stepNervePoint(pn, +1)}
							>
								Next point ▶
							</button>
							<button
								class="btn"
								title="Move this point onto the current axial slice"
								onclick={() => {
									if (!ps?.lastNervePoint) return;
									ps.markEdit();
									pn.points[ps.lastNervePoint.index].z = ps.cursor.z * ps.ds.spacing_z;
									ps.saveNerve(pn.id);
								}}
							>
								To slice
							</button>
							<button
								class="btn"
								title="Interchange this point with its successor (fix ordering)"
								disabled={ps.lastNervePoint.index >= pn.points.length - 1}
								onclick={() => {
									if (!ps?.lastNervePoint) return;
									const i = ps.lastNervePoint.index;
									ps.markEdit();
									[pn.points[i], pn.points[i + 1]] = [pn.points[i + 1], pn.points[i]];
									ps.lastNervePoint = { nerveId: pn.id, index: i + 1 };
									ps.saveNerve(pn.id);
								}}
							>
								Swap ↔ next
							</button>
							<button
								class="btn"
								class:primary={ps.showNervePointNumbers}
								title="Show point numbers along the nerve"
								onclick={() => ps && (ps.showNervePointNumbers = !ps.showNervePointNumbers)}
							>
								#
							</button>
						{/if}
					{/if}
					{#if ps.activeNerveId != null}
						{@const an = ps.nerves.find((n) => n.id === ps?.activeNerveId)}
						{#if an && an.points.length >= 2}
							<button
								class="btn"
								disabled={nerveDetecting}
								title="Trace the canal automatically from the first to the last marked point, routing through the intermediate markers as waypoints."
								onclick={() => autoDetectNerve(an.id)}
							>
								{nerveDetecting ? 'Detecting…' : 'Auto detect'}
							</button>
						{/if}
					{/if}
					{#if ps.nerveEditMode}
						<span class="muted">Click in the panoramic or cross-section view to add nerve points</span>
					{/if}
					<span class="warn-text" title="The displayed nerve course is a manual marking and may deviate from the real canal — verify against the image data in all views.">
						<Icon name="warning" size={12} /> Verify the nerve course manually
					</span>
				{:else if stage === 'implant'}
					<button class="btn primary" onclick={openImplantDialog}>
						<Icon name="implant" size={14} /> Add implant
					</button>
					<button
						class="btn"
						disabled={ps.implants.length < 2}
						onclick={() => (showAngleDialog = true)}
					>
						<Icon name="angle" size={14} /> Angles…
					</button>
					<button
						class="btn"
						disabled={ps.implants.filter((i) => i.abutment).length < 2}
						title="Angle between abutments"
						onclick={() => (showAbutmentAngles = true)}
					>
						<Icon name="angle" size={14} /> Abutments…
					</button>
					<button
						class="btn"
						disabled={ps.implants.length < 2}
						title="Assign angulated abutments to a group (axis parallelization, All-on-4/6)"
						onclick={() => (showGroupAbutments = true)}
					>
						Group abutments…
					</button>
					<button class="btn" title="Place a virtual tooth from the library (prosthetic-driven planning)" onclick={() => (showVirtualTeeth = true)}>
						<Icon name="tooth" size={14} /> Virtual tooth…
					</button>
					{#if outdatedImplants.length}
						<span
							class="warn-text"
							title="These implants are no longer in the active catalog (outdated article). Use Change… to replace them, or keep them knowingly: {outdatedImplants
								.map((i) => i.article)
								.join(', ')}"
						>
							<Icon name="warning" size={12} /> {outdatedImplants.length} outdated
						</span>
					{/if}
					{#if selectedImplant}
						<div class="tool-sep"></div>
						<span>
							<strong>{selectedImplant.tooth ? `Tooth ${toothLabel(selectedImplant.tooth, notation)} — ` : ''}</strong>
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
						<button class="btn" title="Change implant system or size" onclick={openChangeImplantDialog}>
							Change…
						</button>
						<select
							title="Abutment"
							value={abutmentLabel(selectedImplant.abutment)}
							onchange={(e) => {
								if (!selectedImplant || !ps) return;
								const preset = ABUTMENT_PRESETS.find((p) => p.name === e.currentTarget.value);
								ps.markEdit();
								selectedImplant.abutment = preset?.spec ? { ...preset.spec } : null;
								ps.saveImplant(selectedImplant.id);
							}}
						>
							{#each ABUTMENT_PRESETS as p (p.name)}
								<option value={p.name}>Abutment: {p.name}</option>
							{/each}
						</select>
						{#if selectedImplant.abutment}
							<button
								class="btn"
								class:primary={showAbutmentDial}
								title="Rotational alignment of the abutment around the implant axis"
								onclick={() => (showAbutmentDial = !showAbutmentDial)}
							>
								⟳ abut.
							</button>
						{/if}
						<button class="btn" title="Define a custom abutment (emergence profile + mesostructure)" onclick={() => (showAbutmentEditor = true)}>
							Custom abut…
						</button>
						{#if ps.implants.length > 1}
							<button
								class="btn"
								title="Make implants parallel (master or mean direction)"
								onclick={() => (makeParallelOpen = true)}
							>
								∥ Parallelize…
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
										// prefer the sleeve system recommended for the implant's manufacturer
										const rec = SLEEVE_SYSTEMS.find((s) =>
											s.name.toLowerCase().includes(im.manufacturer.toLowerCase())
										);
										im.sleeve = rec
											? {
													system: rec.name,
													diameter: rec.diameters[0],
													height: rec.heights[0],
													offset: rec.offsets[Math.floor(rec.offsets.length / 2)]
												}
											: defaultSleeve();
										ps.saveImplant(im.id);
									}
								}
							}}
						>
							Assign sleeves to all
						</button>
						{#if selectedImplant}
							<div class="tool-sep"></div>
							<span><strong>{selectedImplant.tooth ? `Tooth ${toothLabel(selectedImplant.tooth, notation)}` : 'Implant'}</strong></span>
							<select
								value={selectedImplant.sleeve?.system ?? ''}
								onchange={(e) => {
									if (!selectedImplant || !ps) return;
									const v = e.currentTarget.value;
									if (v.startsWith('custom:')) {
										const cs = customSleeves.find((c) => c.id === Number(v.slice(7)));
										if (cs && cs.segments.length) {
											selectedImplant.sleeve = {
												system: cs.name,
												diameter: Math.max(...cs.segments.map((g) => g.upperDiameter)),
												height: cs.segments.reduce((a, g) => a + g.height, 0),
												offset: cs.segments[0].distanceToZeroLevel,
												systemId: cs.id
											};
										}
										ps.saveImplant(selectedImplant.id);
										return;
									}
									const sys = SLEEVE_SYSTEMS.find((s) => s.name === v);
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
								{#if recSleeveSystems.length}
									<optgroup label="Recommended ({selectedImplant.manufacturer})">
										{#each recSleeveSystems as s (s.name)}
											<option value={s.name}>{s.name}</option>
										{/each}
									</optgroup>
									<optgroup label="Open sleeve systems">
										{#each SLEEVE_SYSTEMS.filter((s) => !recSleeveSystems.includes(s)) as s (s.name)}
											<option value={s.name}>{s.name}</option>
										{/each}
									</optgroup>
								{:else}
									{#each SLEEVE_SYSTEMS as s (s.name)}
										<option value={s.name}>{s.name}</option>
									{/each}
								{/if}
								{#if customSleeves.length}
									<optgroup label="Custom systems (/sleeves)">
										{#each customSleeves as cs (cs.id)}
											<option value={'custom:' + cs.id}>{cs.name}</option>
										{/each}
									</optgroup>
								{/if}
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
						<div class="tool-sep"></div>
						<button
							class="btn"
							class:primary={windowMode}
							title="Click the guide or scan in the 3D view to place an inspection window"
							onclick={() => (windowMode = !windowMode)}
						>
							{windowMode ? 'Click 3D to place window…' : `Windows (${guideWindows.length})`}
						</button>
						{#if windowMode}
							<input
								type="number"
								min="2"
								max="10"
								step="0.5"
								bind:value={windowDiameter}
								title="Window diameter (mm)"
								style="width:58px"
							/>
							<button
								class="btn"
								disabled={!guideWindows.length}
								onclick={() => {
									guideWindows.pop();
									saveGuideWindows();
								}}>Undo</button
							>
							<button
								class="btn danger"
								disabled={!guideWindows.length}
								onclick={() => {
									guideWindows.length = 0;
									saveGuideWindows();
								}}>Clear</button
							>
						{/if}
						<button class="btn" class:primary={showGuideOptions} onclick={openGuideOptions}>
							<Icon name="settings" size={14} /> Design options…
							{#if guideWarnings.length}<span class="warn-text">({guideWarnings.length}⚠)</span>{/if}
						</button>
						<button
							class="btn"
							disabled={ps.implants.length < 2}
							title="Bone reduction: propose bars between consecutive implants at platform level (edit in Design options)"
							onclick={proposeReductionBars}
						>
							Bars from implants
						</button>
						<button
							class="btn"
							class:primary={connectorPreview}
							title="Preview connector order between implant positions in the axial view"
							onclick={() => (connectorPreview = !connectorPreview)}
						>
							Connectors
						</button>
						<button
							class="btn"
							class:primary={footprintPreview}
							title="Show the planned guide footprint (cut profile) outline in the axial view"
							onclick={() => (footprintPreview = !footprintPreview)}
						>
							Cut profile
						</button>
						<button class="btn" title="Adjust offset/wall thickness for your producer and apply printer calibration" onclick={openProducerExport}>
							<Icon name="export" size={14} /> Producer export…
						</button>
						<button class="btn primary" disabled={guideBusy} onclick={generateGuideAction}>
							<Icon name="guide" size={14} />
							{guideBusy ? 'Generating…' : 'Generate guide'}
						</button>
						{#if guideError}<span class="warn-text">{guideError}</span>{/if}
						{#if data.plan.guide_stale}
							<span class="warn-text" title="Implants changed after the guide was generated — regenerate before export">
								<Icon name="warning" size={13} /> Guide outdated
							</span>
						{/if}
						{#each guideModels as g (g.id)}
							<button
								class="btn"
								title="Copy this guide as a plain 3D model (stacked-guide base)"
								onclick={() => convertGuideToModel(g)}
							>
								→ model
							</button>
							{#if data.plan.approved && !data.plan.guide_stale}
								<a class="btn" href="/api/models/{g.id}/file?download=1" title="Download STL">
									<Icon name="export" size={14} /> {g.name}.stl
								</a>
							{:else}
								<button class="btn" disabled title="Approve the plan (plan menu) before exporting for production">
									<Icon name="export" size={14} /> {g.name}.stl — approval required
								</button>
							{/if}
						{/each}
					{/if}
				{:else}
					<span class="muted">{stages.find((s) => s.key === stage)?.label} tools coming soon</span>
				{/if}
			</div>

			{#if stage === 'align'}
				<div class="view-grid grid-2x2">
					<div class="view panel" class:cell-max={maximized === 'a3d'} class:cell-hidden={maximized && maximized !== 'a3d'}>
						<VolumeView state={ps} bind:this={alignVolView} onMeshClick={onScanMeshClick} forceClipAxial={pcsCut} />
						{@render maxBtn('a3d')}
					</div>
					<div class="view panel" class:cell-max={maximized === 'aax'} class:cell-hidden={maximized && maximized !== 'aax'}>
						<SliceView
							state={ps}
							zoomSignal={zoomSig}
							plane="axial"
							overlayDraw={axialOverlay}
							onToolPointer={alignAxialTool}
							previewRotate={pcsAngles.yaw}
							overlayDeps={[JSON.stringify(ps.curveControl), ps.crossU, objectsVersion, contourTick, modelsVersion, maskTick, segEdit.active, pcsAngles.yaw]}
						/>
						{@render maxBtn('aax')}
					</div>
					<div class="view panel" class:cell-max={maximized === 'acor'} class:cell-hidden={maximized && maximized !== 'acor'}>
						<SliceView state={ps}
							zoomSignal={zoomSig} plane="coronal"
							onToolPointer={(e) => occlusalTool(e) || pcsRotCoronal(e)}
							overlayDraw={occlusalOverlay}
							previewRotate={pcsAngles.pitch}
							overlayDeps={[pcsAngles.pitch, occlusalZ]} />
						{@render maxBtn('acor')}
					</div>
					<div class="view panel" class:cell-max={maximized === 'asag'} class:cell-hidden={maximized && maximized !== 'asag'}>
						<SliceView state={ps}
							zoomSignal={zoomSig} plane="sagittal"
							onToolPointer={(e) => occlusalTool(e) || pcsRotSagittal(e)}
							overlayDraw={occlusalOverlay}
							previewRotate={-pcsAngles.roll}
							overlayDeps={[pcsAngles.roll, occlusalZ]} />
						{@render maxBtn('asag')}
					</div>
				</div>
			{:else if stage === 'pano'}
				<div class="view-grid grid-pano">
					<div class="view panel area-ax" class:cell-max={maximized === 'pax'} class:cell-hidden={maximized && maximized !== 'pax'}>
						<SliceView
							state={ps}
							zoomSignal={zoomSig}
							plane="axial"
							overlayDraw={axialOverlay}
							onToolPointer={axialTool}
							overlayDeps={[JSON.stringify(ps.curveControl), ps.curveEditMode, ps.crossU, objectsVersion, contourTick]}
						/>
						{@render maxBtn('pax')}
					</div>
					<div class="view panel area-3d" class:cell-max={maximized === 'p3d'} class:cell-hidden={maximized && maximized !== 'p3d'}>
						<VolumeView state={ps} />
						{@render maxBtn('p3d')}
					</div>
					<div class="view panel area-pano" class:cell-max={maximized === 'ppano'} class:cell-hidden={maximized && maximized !== 'ppano'}>
						<PanoView state={ps} />
						{@render maxBtn('ppano')}
					</div>
				</div>
			{:else}
				<div class="view-grid grid-2x2">
					<div class="view panel" class:cell-max={maximized === 'd3d'} class:cell-hidden={maximized && maximized !== 'd3d'}>
						<VolumeView state={ps} onMeshClick={onGuideMeshClick} bind:this={defaultVolView} />
						{@render maxBtn('d3d')}
					</div>
					<div class="view panel" class:cell-max={maximized === 'dax'} class:cell-hidden={maximized && maximized !== 'dax'}>
						<SliceView
							state={ps}
							zoomSignal={zoomSig}
							plane="axial"
							overlayDraw={axialOverlay}
							onToolPointer={axialTool}
							onImageDblClick={onAxialDblClick}
							overlayDeps={[JSON.stringify(ps.curveControl), ps.crossU, objectsVersion, contourTick]}
						/>
						{@render maxBtn('dax')}
					</div>
					<div class="view panel" class:cell-max={maximized === 'dpano'} class:cell-hidden={maximized && maximized !== 'dpano'}>
						<PanoView
							state={ps}
							overlayDraw={(ctx, t, info) => ps && drawPanoOverlay(ps, ctx, t, info)}
							onToolPointer={(e) => (ps ? panoTool(ps, e) : false)}
							overlayDeps={[objectsVersion]}
						/>
						{@render maxBtn('dpano')}
					</div>
					<div class="view panel" class:cell-max={maximized === 'dcross'} class:cell-hidden={maximized && maximized !== 'dcross'}>
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
						{@render maxBtn('dcross')}
					</div>
				</div>
			{/if}
		{/if}
	</main>
</div>

{#if grayscaleOpen && ps}
	<AdjustGrayscale state={ps} onclose={() => (grayscaleOpen = false)} />
{/if}

{#if hotkeysOpen}
	<div class="hk-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (hotkeysOpen = false)}>
		<div class="hk-dialog panel">
			<div class="dialog-title">Keyboard & mouse shortcuts</div>
			<table class="hk-table">
				<tbody>
					{#each HOTKEYS as [key, desc] (key)}
						<tr><td class="hk-key">{key}</td><td>{desc}</td></tr>
					{/each}
				</tbody>
			</table>
			<div class="dialog-actions">
				<button class="btn primary" onclick={() => (hotkeysOpen = false)}>Close</button>
			</div>
		</div>
	</div>
{/if}

{#if helpOpen}
	<HelpOverlay
		topic={stage === 'data' ? 'data' : stage === 'align' ? 'align' : stage === 'pano' ? 'pano' : stage === 'nerve' ? 'nerve' : stage === 'implant' ? 'implant' : stage === 'sleeve' ? 'sleeve' : stage === 'guide' ? 'guide' : 'report'}
		onclose={() => (helpOpen = false)}
	/>
{/if}

{#if showGroupAbutments && ps}
	<GroupAbutmentDialog
		implants={ps.implants.map((i) => ({
			id: i.id,
			label: `${i.tooth ? toothLabel(i.tooth, notation) + ' — ' : ''}${i.article || i.line}`,
			ax: i.ax,
			ay: i.ay,
			az: i.az,
			abutment: i.abutment
				? { preset: abutmentLabel(i.abutment), angle: i.abutment.angle, rotation: (i.abutment as { rotation?: number }).rotation ?? 0 }
				: null
		}))}
		presets={[
			{ name: 'Straight', angles: [0] },
			{ name: 'Angled', angles: [17, 30] }
		]}
		onassign={async (rows) => {
			if (!ps) return;
			ps.markEdit();
			for (const r of rows) {
				const im = ps.implants.find((i) => i.id === r.id);
				if (!im) continue;
				im.abutment = {
					type: r.abutment.angle > 0 ? 'angled' : 'straight',
					angle: r.abutment.angle,
					height: 4,
					diameter: 4.5
				};
				ps.saveImplant(im.id);
			}
		}}
		onclose={() => (showGroupAbutments = false)}
	/>
{/if}

{#if showAbutmentDial && selectedImplant?.abutment && ps}
	<div class="dial-float panel">
		<div class="panel-header">
			Abutment rotation
			<button class="btn ghost" style="margin-left:auto" onclick={() => (showAbutmentDial = false)}>×</button>
		</div>
		<div style="padding:10px">
			<AbutmentRotateDial
				rotation={(selectedImplant.abutment as { rotation?: number }).rotation ?? 0}
				onrotate={(deg) => {
					if (!selectedImplant?.abutment || !ps) return;
					(selectedImplant.abutment as { rotation?: number }).rotation = deg;
					ps.saveImplant(selectedImplant.id);
				}}
			/>
		</div>
	</div>
{/if}

{#if showAbutmentEditor && ps}
	<AbutmentEditor
		initial={null}
		onsave={(a) => {
			if (!ps || !selectedImplant) {
				showAbutmentEditor = false;
				return;
			}
			ps.markEdit();
			selectedImplant.abutment = userAbutmentToSpec(a);
			ps.saveImplant(selectedImplant.id);
			showAbutmentEditor = false;
		}}
		onclose={() => (showAbutmentEditor = false)}
	/>
{/if}

{#if showVirtualTeeth && ps}
	<VirtualToothPicker
		{notation}
		onpick={(tooth) => {
			if (!ps) return;
			ps.markEdit();
			ps.addMeasurement(
				'annotation',
				[
					{
						x: ps.cursor.x * ps.ds.spacing_x,
						y: ps.cursor.y * ps.ds.spacing_y,
						z: ps.cursor.z * ps.ds.spacing_z
					}
				],
				tooth,
				`Virtual tooth ${toothLabel(tooth, notation)}`
			);
			showVirtualTeeth = false;
		}}
		onclose={() => (showVirtualTeeth = false)}
	/>
{/if}

{#if showAugment && ps}
	<AugmentWizard
		caseId={data.caseData.id}
		datasetId={ps.ds.id}
		getOutlines={() => segBoundaries}
		onclose={() => (showAugment = false)}
		ondone={async () => {
			showAugment = false;
			await invalidateAll();
		}}
	/>
{/if}

{#if aiReview && ps}
	<AiReviewWizard
		datasetId={ps.ds.id}
		caseId={data.caseData.id}
		planId={data.plan.id}
		models={aiReview}
		onimport={aiImport}
		onclose={() => aiImport([])}
	/>
{/if}

{#if showVpe}
	<VpeDialog caseId={data.caseData.id} planId={data.plan.id} onclose={() => (showVpe = false)} />
{/if}

{#if showTemplateMatch && ps}
	<TemplateMatchDialog
		caseId={data.caseData.id}
		datasets={data.datasets.map((d) => ({
			id: d.id,
			label: `${d.series_description || d.description} (${d.cols}×${d.rows}×${d.slices})`
		}))}
		onapplied={async () => {
			showTemplateMatch = false;
			await invalidateAll();
		}}
		onclose={() => (showTemplateMatch = false)}
	/>
{/if}

{#if showPerio && ps}
	<PerioChart {notation} initial={perioData} onsave={savePerio} onclose={() => (showPerio = false)} />
{/if}

{#if showPackageImport}
	<ProstheticImportDialog
		caseId={data.caseData.id}
		onclose={() => (showPackageImport = false)}
		ondone={async () => {
			showPackageImport = false;
			await invalidateAll();
		}}
	/>
{/if}

{#if showFineAlign && ps}
	<FineAlignDialog
		name={ps.models.find((m) => m.id === matching.modelId)?.name ?? 'Scan'}
		onnudge={fineNudge}
		onclose={() => (showFineAlign = false)}
	/>
{/if}

{#if showToolbarAdjust}
	<div class="backdrop2" role="presentation" onclick={() => (showToolbarAdjust = false)}>
		<div class="panel pe-dialog" role="dialog" onclick={(e) => e.stopPropagation()}>
			<div class="dialog-title">Adjust toolbar — measurement tools</div>
			<div class="dialog-body">
				{#each MEASURE_TOOLS as mt (mt.key)}
					<label class="pa-row2">
						<input
							type="checkbox"
							checked={!hiddenTools.includes(mt.key)}
							onchange={(e) => {
								hiddenTools = e.currentTarget.checked
									? hiddenTools.filter((k) => k !== mt.key)
									: [...hiddenTools, mt.key];
								saveHiddenTools();
							}}
						/>
						{mt.label}
					</label>
				{/each}
			</div>
			<div class="dialog-actions">
				<button
					class="btn"
					onclick={() => {
						hiddenTools = [];
						saveHiddenTools();
					}}
				>
					Reset to default
				</button>
				<button class="btn primary" onclick={() => (showToolbarAdjust = false)}>Done</button>
			</div>
		</div>
	</div>
{/if}

{#if showProducerExport}
	<div class="backdrop2" role="presentation" onclick={() => (showProducerExport = false)}>
		<div class="panel pe-dialog" role="dialog" onclick={(e) => e.stopPropagation()}>
			<div class="dialog-title">Producer export</div>
			<div class="dialog-body">
				<p class="muted">
					Adjust the fit for your production setup. The adjustments are applied on top of the
					design values for this export only.
				</p>
				<div class="field-row">
					<div>
						<label for="pe-off">Offset adjustment (mm)</label>
						<input id="pe-off" type="number" step="0.05" min="-0.5" max="0.5" bind:value={producer.offsetAdj} style="width:100%" />
					</div>
					<div>
						<label for="pe-th">Wall thickness adjustment (mm)</label>
						<input id="pe-th" type="number" step="0.5" min="-1" max="2" bind:value={producer.thicknessAdj} style="width:100%" />
					</div>
				</div>
				<div>
					<label for="pe-printer">Printer (calibration matrix — manage under /sleeves)</label>
					<select id="pe-printer" bind:value={producer.printer} style="width:100%">
						<option value="">No calibration</option>
						{#each Object.entries(printerScales) as [name, f] (name)}
							<option value={name}>{name} (×{f})</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="dialog-actions">
				<button class="btn" onclick={() => (showProducerExport = false)}>Cancel</button>
				<button class="btn primary" disabled={producerBusy} onclick={producerExport}>
					{producerBusy ? 'Generating…' : 'Generate production guide'}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if axialPopup && ps && easyMode}
	<div class="axial-popup panel">
		<div class="axial-popup-title">Axial position</div>
		<div class="axial-gauge">
			<div class="axial-gauge-bar">
				<div
					class="axial-gauge-fill"
					style="height:{(100 * (ps.ds.slices - 1 - ps.cursor.z)) / Math.max(1, ps.ds.slices - 1)}%"
				></div>
			</div>
			<div>
				<div class="mono">{ps.cursor.z + 1} / {ps.ds.slices}</div>
				<div class="faint">{(ps.cursor.z * ps.ds.spacing_z).toFixed(1)} mm</div>
			</div>
		</div>
	</div>
{/if}

{#if showGuideOptions && stage === 'guide'}
	<div class="guide-options-float panel">
		<div class="panel-header">
			Guide design options
			<button class="btn ghost" style="margin-left:auto" onclick={() => (showGuideOptions = false)}>×</button>
		</div>
		<div class="guide-options-body">
			<GuideOptionsPanel
				params={{ ...guideParams, ...guideAdvanced }}
				warnings={guideWarnings}
				recipes={guideRecipes}
				models={ps?.models ?? []}
				caseMeta={{
					patientName: `${data.patient.last_name ?? ''} ${data.patient.first_name ?? ''}`.trim(),
					patientId: data.patient.external_id || String(data.patient.id),
					date: (data.plan.updated_at ?? '').slice(0, 10)
				}}
				archPoint={(tooth) => {
					const c = ps?.curve;
					if (!c) return null;
					const u = toothArchU(c, tooth);
					return u == null ? null : c.points[indexAtLength(c, u)];
				}}
				onchange={(p) => {
					guideParams.offset = Number(p.offset ?? guideParams.offset);
					guideParams.thickness = Number(p.thickness ?? guideParams.thickness);
					guideParams.regionRadius = Number(p.regionRadius ?? guideParams.regionRadius);
					const { offset, thickness, regionRadius, ...rest } = p;
					void offset;
					void thickness;
					void regionRadius;
					guideAdvanced = rest;
					saveGuideAdvanced();
				}}
				onrecipe={(key) => {
					const r = guideRecipes.find((x) => x.key === key);
					if (!r) return;
					const { offset, thickness, regionRadius, ...rest } = r.params;
					if (offset != null) guideParams.offset = Number(offset);
					if (thickness != null) guideParams.thickness = Number(thickness);
					if (regionRadius != null) guideParams.regionRadius = Number(regionRadius);
					guideAdvanced = { ...guideAdvanced, ...rest };
					saveGuideAdvanced();
				}}
			/>
		</div>
	</div>
{/if}

{#if showImplantPicker}
	<ImplantPicker
		{notation}
		favorites={pickerFavorites}
		onpick={(sel) => {
			const idx = IMPLANT_LIBRARY.findIndex(
				(l) => l.manufacturer === sel.line.manufacturer && l.line === sel.line.line
			);
			if (idx >= 0) newImplant.lineIndex = idx;
			newImplant.diameter = sel.diameter;
			newImplant.length = sel.length;
			showImplantPicker = false;
		}}
		onfavorites={async (next) => {
			pickerFavorites = next;
			await fetch('/api/favorites', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ favorites: next })
			});
		}}
		onclose={() => (showImplantPicker = false)}
	/>
{/if}

{#if showAngleDialog && ps}
	<AngleBetweenImplants
		implants={ps.implants.map((i) => ({
			id: i.id,
			label: `${i.tooth ? toothLabel(i.tooth, notation) + ' — ' : ''}${i.article || i.line}`,
			ax: i.ax,
			ay: i.ay,
			az: i.az
		}))}
		onalign={alignImplantsTo}
		onclose={() => (showAngleDialog = false)}
	/>
{/if}

{#if showAbutmentAngles && ps}
	<AngleBetweenAbutments
		implants={ps.implants
			.filter((i) => i.abutment)
			.map((i) => ({
				id: i.id,
				label: `${i.tooth ? toothLabel(i.tooth, notation) + ' — ' : ''}${i.article || i.line}`,
				ax: i.ax,
				ay: i.ay,
				az: i.az,
				abutmentAngle: i.abutment?.angle
			}))}
		onclose={() => (showAbutmentAngles = false)}
	/>
{/if}

{#if wizardFiles}
	<ImportWizard
		caseId={data.caseData.id}
		files={wizardFiles}
		onclose={() => (wizardFiles = null)}
		ondone={async () => {
			wizardFiles = null;
			offerAiAfterImport = true;
			await invalidateAll();
		}}
	/>
{/if}

{#if distancePopover && ps}
	<DistancePopover state={ps} kind={distancePopover} onclose={() => (distancePopover = null)} />
{/if}

{#if makeParallelOpen && ps}
	<MakeParallel state={ps} {notation} onclose={() => (makeParallelOpen = false)} />
{/if}

{#if compareOpen}
	<PlanCompare
		plans={data.plans}
		currentPlanId={data.plan.id}
		{notation}
		onclose={() => (compareOpen = false)}
	/>
{/if}

<!-- align patient coordinate system dialog -->
<dialog bind:this={pcsDialog}>
	<div class="dialog-title">Align patient coordinate system</div>
	<div class="dialog-body">
		<p class="muted">
			Rotates and resamples the volume so the occlusal plane is horizontal and the
			sagittal midline is vertical. This is applied permanently to the dataset.
		</p>
		<div class="field-row">
			<div>
				<label for="pcs-yaw">Yaw (axial ↻, °)</label>
				<input id="pcs-yaw" type="number" min="-45" max="45" step="1" bind:value={pcsAngles.yaw} style="width:100%" />
			</div>
			<div>
				<label for="pcs-pitch">Pitch (coronal ↻, °)</label>
				<input id="pcs-pitch" type="number" min="-45" max="45" step="1" bind:value={pcsAngles.pitch} style="width:100%" />
			</div>
			<div>
				<label for="pcs-roll">Roll (sagittal ↺, °)</label>
				<input id="pcs-roll" type="number" min="-45" max="45" step="1" bind:value={pcsAngles.roll} style="width:100%" />
			</div>
		</div>
		<div class="field-row">
			<label class="checkbox-inline" style="margin-top:0">
				<input type="checkbox" bind:checked={pcsCut} />
				Horizontal 3D cut at the axial position (clips the 3D view while aligning)
			</label>
			<div>
				<label for="pcs-th">Setup 3D views — bone threshold (HU)</label>
				<input id="pcs-th" type="number" step="50" bind:value={segThreshold} style="width:100%" />
			</div>
		</div>
		<p class="faint">
			Tip: use the coronal view to judge roll and the sagittal view for pitch before applying.
			Panoramic curve and planned objects keep their coordinates — re-check them after large
			corrections.
		</p>
	</div>
	<div class="dialog-actions">
		<button
			type="button"
			class="btn"
			disabled={pcsProposing || pcsBusy}
			title="Geometric auto-proposal from the bone segmentation (jaw-arch fit): fills the angles and proposes a panoramic curve"
			onclick={proposePcs}
		>
			{pcsProposing ? 'Analyzing…' : 'Propose automatically'}
		</button>
		<button
			type="button"
			class="btn"
			disabled={pcsBusy}
			title="Undo all applied PCS rotations (restores the original orientation)"
			onclick={() => applyPcs(true)}
		>
			Reset to default
		</button>
		<button type="button" class="btn" onclick={() => pcsDialog?.close()}>Cancel</button>
		<button type="button" class="btn primary" disabled={pcsBusy} onclick={() => applyPcs(false)}>
			{pcsBusy ? 'Resampling…' : 'Apply rotation'}
		</button>
	</div>
</dialog>

<!-- add/change implant dialog -->
<dialog bind:this={implantDialog}>
	<div class="dialog-title">{implantDialogMode === 'change' ? 'Change implant' : 'Add implant'}</div>
	<div class="dialog-body">
		<div>
			<label for="im-tooth">
				Tooth position ({notation === 'universal' ? 'Universal' : 'FDI'}) — {data.plan.jaw}
			</label>
			<div class="fdi-grid">
				{#each [FDI_UPPER, FDI_LOWER] as row, ri (ri)}
					<div class="fdi-row" class:fdi-other-jaw={(ri === 0) !== (data.plan.jaw === 'maxilla')}>
						{#each row as tooth (tooth)}
							<button
								type="button"
								class="fdi-tooth"
								class:fdi-active={newImplant.tooth === String(tooth)}
								class:fdi-placed={ps?.implants.some((i) => i.tooth === String(tooth))}
								onclick={() => (newImplant.tooth = String(tooth))}
							>
								{toothLabel(tooth, notation)}
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
			<div style="align-self:end">
				<button type="button" class="btn" onclick={openImplantPicker}>
					<Icon name="search" size={14} /> Browse library…
				</button>
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
		{#if IMPLANT_LIBRARY[newImplant.lineIndex]}
			{@const dl = IMPLANT_LIBRARY[newImplant.lineIndex]}
			<p class="faint">
				{dl.manufacturer} {dl.line} · article {articleName(dl, newImplant.diameter, newImplant.length)}
				· platform {implantPlatform({ manufacturer: dl.manufacturer, line: dl.line, diameter: newImplant.diameter }) ?? '—'}
				· total length {newImplant.length.toFixed(1)} mm
			</p>
		{/if}
		<p class="faint">
			{implantDialogMode === 'change'
				? 'Position and axis are kept; only the system and dimensions change.'
				: 'The implant is placed at the arch position of the chosen tooth (or where you clicked); drag it in the views to refine.'}
		</p>
		<p class="warn-text">
			<Icon name="warning" size={12} />
			Refer to the implant manufacturer's instructions for use for specific indications and
			contraindications.
		</p>
	</div>
	<div class="dialog-actions">
		<button type="button" class="btn" onclick={() => implantDialog?.close()}>Cancel</button>
		<button type="button" class="btn primary" onclick={confirmAddImplant}>
			{implantDialogMode === 'change' ? 'Apply change' : 'Place implant'}
		</button>
	</div>
</dialog>

<footer class="status-bar">
	<span class="faint">coDiagnostiX Web — planning workspace</span>
	{#if aiBusy}
		<span class="ai-chip ai-running" title="The AI assistant is processing this dataset — you can keep working">⏳ AI assistant…</span>
	{:else if aiReady}
		<button
			class="ai-chip ai-done"
			title="AI assistant results are ready — click to review and import"
			onclick={() => {
				aiReview = aiReady;
				aiReady = null;
			}}
		>
			✓ AI results ready — review
		</button>
	{/if}
	<span class="hint-text"><Icon name="chevron" size={11} /> {nextHint}</span>
	{#if ps?.liveDistances}
		{@const ld = ps.liveDistances}
		{#if ld.nerve != null}
			<button
				class="dist-chip"
				class:dist-bad={ld.nerve < ps.nerveSafety}
				title="Click for per-nerve distances"
				onclick={() => (distancePopover = distancePopover === 'nerve' ? null : 'nerve')}
			>
				nerve {ld.nerve.toFixed(1)} mm
			</button>
		{/if}
		{#if ld.implant != null}
			<button
				class="dist-chip"
				class:dist-bad={ld.implant < ps.implantSafety}
				title="Click for per-implant distances"
				onclick={() => (distancePopover = distancePopover === 'implant' ? null : 'implant')}
			>
				implant {ld.implant.toFixed(1)} mm
			</button>
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
	/* point-placement affordance while an in-view edit mode is active */
	.view-area.edit-cursor :global(.view canvas) {
		cursor: crosshair;
	}

	/* AI-assistant job status chip (status bar) */
	.ai-chip {
		font-size: 11px;
		padding: 1px 8px;
		border-radius: 9px;
		border: 1px solid transparent;
	}
	.ai-running {
		color: #e0a04d;
		border-color: rgba(224, 160, 77, 0.5);
	}
	.ai-done {
		color: #5fce7b;
		border-color: rgba(95, 206, 123, 0.6);
		background: rgba(95, 206, 123, 0.08);
		cursor: pointer;
	}

	.perio-btn {
		margin-bottom: 6px;
		width: 100%;
		justify-content: center;
	}

	.dial-float {
		position: fixed;
		right: 16px;
		top: 120px;
		z-index: 70;
		box-shadow: var(--shadow);
	}

	:global(.tool-hidden) {
		display: none !important;
	}
	.pa-row2 {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text);
	}

	.backdrop2 {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 110;
	}
	.pe-dialog {
		width: 420px;
	}

	.axial-popup {
		position: fixed;
		top: 60px;
		right: 18px;
		z-index: 80;
		padding: 8px 12px;
		box-shadow: var(--shadow);
		pointer-events: none;
	}
	.axial-popup-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-dim);
		margin-bottom: 4px;
	}
	.axial-gauge {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.axial-gauge-bar {
		width: 10px;
		height: 64px;
		background: var(--bg-0);
		border: 1px solid var(--border);
		border-radius: 3px;
		position: relative;
		overflow: hidden;
	}
	.axial-gauge-fill {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		background: linear-gradient(var(--bg-0), var(--accent));
	}
	.mono {
		font-family: var(--mono);
		font-size: 12px;
	}

	.guide-options-float {
		position: fixed;
		right: 16px;
		top: 96px;
		width: 380px;
		max-height: calc(100vh - 140px);
		display: flex;
		flex-direction: column;
		z-index: 60;
		box-shadow: var(--shadow);
	}
	.guide-options-body {
		overflow-y: auto;
		padding: 10px;
	}

	.status-ic {
		margin-left: 4px;
		font-size: 10px;
	}
	.status-ic.ok {
		color: var(--green);
	}
	.status-ic.err {
		color: var(--red);
	}
	.status-ic.busy {
		color: var(--yellow);
	}

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
	.stage-bar-hidden {
		display: none;
	}
	.easy-rail {
		padding: 8px;
		border-bottom: 1px solid var(--border-soft);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.easy-step-title {
		font-size: 11px;
		font-weight: 700;
		color: var(--accent-bright);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 2px 4px;
	}
	.easy-sub {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 5px 8px;
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--text);
	}
	.easy-sub:hover {
		background: var(--bg-3);
	}
	.easy-sub:disabled {
		opacity: 0.4;
	}
	.easy-current {
		background: var(--accent-dim);
		color: #fff;
	}
	.easy-check {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1px solid var(--border);
		display: inline-grid;
		place-items: center;
		flex: none;
	}
	.easy-done {
		background: var(--green);
		border-color: var(--green);
		color: #fff;
	}
	.easy-nav {
		display: flex;
		gap: 6px;
		justify-content: space-between;
		margin-top: 4px;
	}
	.easy-help {
		border-top: 1px solid var(--border-soft);
		margin-top: 6px;
		padding-top: 6px;
	}
	.easy-help-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		font-size: 11px;
		font-weight: 600;
		color: var(--accent-bright);
		padding: 2px 4px;
	}
	.easy-help-body {
		font-size: 11px;
		color: var(--text-dim);
		margin: 6px 4px 0;
		line-height: 1.5;
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
	.hk-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.hk-dialog {
		min-width: 460px;
		box-shadow: var(--shadow);
	}
	.hk-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		margin: 8px 0;
	}
	.hk-table td {
		padding: 4px 14px;
		border-bottom: 1px solid var(--border-soft);
	}
	.hk-key {
		font-family: var(--mono);
		color: var(--accent-bright);
		white-space: nowrap;
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
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.group-eye {
		opacity: 0.5;
	}
	.group-eye:hover {
		opacity: 1;
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
	.tree-label-btn {
		text-align: left;
		cursor: pointer;
	}
	.tree-label-btn:hover {
		color: var(--accent-bright);
	}
	.model-props {
		margin: 2px 6px 8px 22px;
		padding: 8px;
		background: var(--bg-1);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mp-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: var(--text-dim);
		text-transform: none;
		letter-spacing: 0;
		margin: 0;
	}
	.mp-row input[type='color'] {
		width: 36px;
		height: 22px;
		padding: 1px;
	}
	.mp-row input[type='range'] {
		flex: 1;
	}
	.mp-row .btn {
		padding: 2px 8px;
		font-size: 11px;
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
	.fdi-other-jaw {
		opacity: 0.4;
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
	.cell-max {
		grid-area: 1 / 1 / -1 / -1 !important;
	}
	.cell-hidden {
		display: none !important;
	}
	.max-btn {
		position: absolute;
		bottom: 6px;
		left: 6px;
		z-index: 3;
		width: 24px;
		height: 20px;
		border-radius: 3px;
		border: 1px solid var(--border);
		background: var(--bg-2);
		color: var(--text-dim);
		font-size: 11px;
		opacity: 0.35;
	}
	.view:hover .max-btn {
		opacity: 1;
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
	.density-panel {
		display: flex;
		flex-direction: column;
		gap: 1px;
		background: var(--bg-0);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 6px;
	}
	.density-row {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 8px;
	}
	.density-bar {
		height: 6px;
		border-radius: 1px;
		min-width: 2px;
	}
	.density-val {
		font-size: 8px;
		color: var(--text-faint);
		line-height: 1;
	}
	.density-foot {
		font-size: 10px;
		margin-top: 4px;
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
	.dataset-info {
		flex: 1;
	}
	.adv-row {
		display: flex;
		justify-content: center;
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
