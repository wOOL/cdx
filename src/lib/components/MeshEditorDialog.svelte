<script lang="ts">
	/**
	 * Mesh Editor window (desktop coDiagnostiX "Mesh Editor", see
	 * cod_guide/video "cdx-expert-how-to-mesh-editor"): a full-screen modal
	 * with the model centered in a 3D view, a left rail of functions meant to
	 * be worked top-down (Part detection → Close holes → Boundary
	 * optimization → Bridge → Remesh → Reduce → Invert → Wax knife → Eraser →
	 * Margin cut → Combine), and a
	 * bottom bar with Undo/Redo, live point/triangle counts and
	 * Save as copy / Apply / Cancel.
	 *
	 * Edits are a CLIENT-HELD op list replayed server-side from the model's
	 * pristine baseline on every request (POST /api/models/:id/edit
	 * { ops: [...] }). Previews never write the file, so:
	 *   undo  = pop + replay        redo  = re-push + replay
	 *   Apply = persist (overwrite + one-time .orig backup)
	 *   Save as copy = persist into a NEW model row
	 *   Cancel = close — the baseline on disk was never touched.
	 */
	import { onMount } from 'svelte';
	import MeshCanvas, {
		type CanvasOverlay,
		type MeshPickHit
	} from './aireview/MeshCanvas.svelte';

	let {
		modelId,
		caseId,
		onclose
	}: {
		modelId: number;
		caseId: number;
		onclose: (changed: boolean) => void;
	} = $props();

	// ------------------------------------------------------------- types
	interface Vec3 {
		x: number;
		y: number;
		z: number;
	}
	/** wire mirror of the server's MeshEditOp (client code stays $lib/server-free) */
	interface EditOp {
		op:
			| 'smooth'
			| 'remesh'
			| 'fillHoles'
			| 'boundarySmooth'
			| 'bridge'
			| 'parts'
			| 'reduce'
			| 'invert'
			| 'erase'
			| 'marginCut'
			| 'combine';
		mode?: 'flatten' | 'add';
		strength?: 'A' | 'B' | 'C' | 'D';
		center?: Vec3;
		radius?: number;
		a?: Vec3;
		b?: Vec3;
		action?: 'deleteSelected' | 'keepSelected' | 'keepLargest';
		part?: number;
		hole?: number;
		exceptLargest?: boolean;
		maxEdges?: number;
		iterations?: number;
		loop?: number;
		targetPercent?: number;
		deep?: boolean;
		axis?: Vec3;
		depth?: number;
		points?: Vec3[];
		keep?: 'inside' | 'outside';
		modelId?: number;
	}
	interface PartInfo {
		index: number;
		triangles: number;
		vertices: number;
	}
	interface HoleInfo {
		index: number;
		edges: number;
		lengthMm: number;
		centroid: Vec3;
		loop: Vec3[];
	}
	type Tool =
		| 'parts'
		| 'holes'
		| 'boundary'
		| 'bridge'
		| 'remesh'
		| 'reduce'
		| 'invert'
		| 'wax'
		| 'eraser'
		| 'margin'
		| 'combine';

	const TOOLS: { key: Tool; label: string; hint: string }[] = [
		{ key: 'parts', label: 'Part detection', hint: 'Detect all connected parts, then delete loose debris.' },
		{ key: 'holes', label: 'Close holes', hint: 'Close all holes, keep the largest opening, or close a selected hole.' },
		{ key: 'boundary', label: 'Boundary optimization', hint: 'Smooths ragged open borders (scan rims) without touching interior geometry.' },
		{ key: 'bridge', label: 'Bridge boundaries', hint: 'Click the mesh near two open boundaries, then bridge them with a strip.' },
		{ key: 'remesh', label: 'Remesh', hint: 'Split long triangles around a picked point (or the whole mesh) and relax them.' },
		{ key: 'reduce', label: 'Reduce', hint: 'Decimate the mesh to a target percentage of its triangles (vertex clustering).' },
		{ key: 'invert', label: 'Invert mesh', hint: 'Flip the orientation (winding) of every triangle.' },
		{ key: 'wax', label: 'Wax knife', hint: 'Click the mesh to smooth locally — optionally removing or adding material.' },
		{ key: 'eraser', label: 'Eraser', hint: 'Click the mesh to delete triangles around the point; deep erase cuts through.' },
		{ key: 'margin', label: 'Cut along margin line', hint: 'Click point by point along the margin, then cut away one side.' },
		{ key: 'combine', label: 'Combine', hint: 'Merge another model of this case into this mesh (alignment-aware).' }
	];

	const base = `/api/models/${modelId}/edit`;

	// ------------------------------------------------------------- state
	let positions = $state<Float32Array | null>(null);
	let triangles = $state(0);
	let vertices = $state(0);
	let ops = $state<EditOp[]>([]);
	let redoStack = $state<EditOp[]>([]);
	let busy = $state('');
	let loadErr = $state('');
	let lastNote = $state('');
	let modelName = $state('');
	let siblings = $state<{ id: number; name: string; kind: string }[]>([]);
	let copySaved = $state(false);
	let resetTick = $state(0);
	let mainH = $state(0);
	let tool = $state<Tool>('parts');

	// part detection
	let partsList = $state<PartInfo[] | null>(null);
	let selectedPart = $state(-1);
	let partHighlight = $state<Float32Array | null>(null);
	// holes
	let holesList = $state<HoleInfo[] | null>(null);
	let openEdges = $state(0);
	let selectedHole = $state(-1);
	// boundary optimization (shares the boundary-loop list with Close holes)
	let boundaryIterations = $state(3);
	let boundaryLoop = $state(-1); // -1 = all boundaries
	// bridge
	let bridgeA = $state<Vec3 | null>(null);
	let bridgeB = $state<Vec3 | null>(null);
	// remesh
	let remeshRadius = $state(5);
	let remeshWhole = $state(false);
	let remeshCenter = $state<Vec3 | null>(null);
	// reduce
	let reducePercent = $state(50);
	// wax knife
	let waxMode = $state<'smooth' | 'remove' | 'add'>('smooth');
	let waxStrength = $state<'A' | 'B' | 'C' | 'D'>('B');
	let waxRadius = $state(5);
	// eraser
	let eraseRadius = $state(3);
	let eraseDeep = $state(false);
	// margin cut
	let marginPts = $state<Vec3[]>([]);
	// combine
	let combineId = $state<number | null>(null);

	// ------------------------------------------------------------- derived
	const activeHint = $derived(TOOLS.find((t) => t.key === tool)?.hint ?? '');
	const pickActive = $derived(
		tool === 'bridge' ||
			tool === 'wax' ||
			tool === 'eraser' ||
			tool === 'margin' ||
			(tool === 'remesh' && !remeshWhole)
	);
	const canvasMeshes = $derived.by(() => {
		const list: {
			id: number;
			positions: Float32Array | null;
			color: string;
			visible: boolean;
			transform: number[] | null;
			raised?: boolean;
		}[] = [];
		if (positions) {
			list.push({ id: 1, positions, color: '#3eb5a2', visible: true, transform: null });
			if (partHighlight && tool === 'parts') {
				list.push({
					id: 2,
					positions: partHighlight,
					color: '#f08a24',
					visible: true,
					transform: null,
					raised: true
				});
			}
		}
		return list;
	});
	const canvasOverlays = $derived.by(() => {
		const out: CanvasOverlay[] = [];
		if (tool === 'margin' && marginPts.length) {
			out.push({ points: marginPts, color: '#e8d44d', line: true, closed: marginPts.length > 2, size: 6 });
		}
		if (tool === 'bridge') {
			const pts: Vec3[] = [];
			if (bridgeA) pts.push(bridgeA);
			if (bridgeB) pts.push(bridgeB);
			if (pts.length) out.push({ points: pts, color: '#f08a24', size: 9 });
		}
		if (tool === 'remesh' && !remeshWhole && remeshCenter) {
			out.push({ points: [remeshCenter], color: '#45b8e0', size: 9 });
		}
		if (tool === 'holes' && selectedHole >= 0 && holesList?.[selectedHole]) {
			out.push({ points: holesList[selectedHole].loop, color: '#f06a5a', line: true, closed: true, size: 0 });
		}
		if (tool === 'boundary' && boundaryLoop >= 0 && holesList?.[boundaryLoop]) {
			out.push({ points: holesList[boundaryLoop].loop, color: '#f06a5a', line: true, closed: true, size: 0 });
		}
		return out;
	});

	// ------------------------------------------------------------- helpers
	function r3(v: number): number {
		return Math.round(v * 1000) / 1000;
	}
	function rv(p: { x: number; y: number; z: number }): Vec3 {
		return { x: r3(p.x), y: r3(p.y), z: r3(p.z) };
	}
	function plainOps(list: EditOp[]): EditOp[] {
		return JSON.parse(JSON.stringify(list)) as EditOp[];
	}
	function opsQuery(): string {
		return ops.length ? `&ops=${encodeURIComponent(JSON.stringify(plainOps(ops)))}` : '';
	}

	/** Replay `next` from the baseline; on success adopt the returned mesh. */
	async function runPreview(next: EditOp[], label: string, silent = false): Promise<boolean> {
		if (busy) return false;
		busy = label;
		try {
			const res = await fetch(base, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ops: next })
			});
			if (!res.ok) {
				if (!silent) {
					const b = await res.json().catch(() => null);
					alert(b?.message ?? 'Mesh edit failed');
				}
				return false;
			}
			const buf = await res.arrayBuffer();
			positions = new Float32Array(buf);
			triangles = Number(res.headers.get('X-Triangles')) || positions.length / 9;
			vertices = Number(res.headers.get('X-Vertices')) || 0;
			try {
				const reports = JSON.parse(res.headers.get('X-Reports') ?? '[]') as Record<string, unknown>[];
				const last = reports[reports.length - 1];
				lastNote = last
					? Object.entries(last)
							.filter(([k]) => k !== 'op')
							.map(([k, v]) => `${k}: ${v}`)
							.join(' · ')
					: '';
			} catch {
				lastNote = '';
			}
			return true;
		} catch {
			if (!silent) alert('Mesh edit failed — is the server reachable?');
			return false;
		} finally {
			busy = '';
		}
	}

	async function refreshInspect(): Promise<void> {
		partHighlight = null;
		selectedPart = -1;
		selectedHole = -1;
		boundaryLoop = -1; // loop indices shift after an edit
		if (partsList) await fetchParts();
		if (holesList) await fetchHoles();
	}

	async function pushOp(op: EditOp, label: string): Promise<boolean> {
		const next = [...plainOps(ops), op];
		if (!(await runPreview(next, label))) return false;
		ops = next;
		redoStack = [];
		await refreshInspect();
		return true;
	}

	async function undo(): Promise<void> {
		if (!ops.length || busy) return;
		const popped = ops[ops.length - 1];
		const next = ops.slice(0, -1);
		if (await runPreview(next, 'Undo')) {
			ops = next;
			redoStack = [...redoStack, popped];
			await refreshInspect();
		}
	}
	async function redo(): Promise<void> {
		if (!redoStack.length || busy) return;
		const op = redoStack[redoStack.length - 1];
		const next = [...plainOps(ops), op];
		if (await runPreview(next, 'Redo')) {
			ops = next;
			redoStack = redoStack.slice(0, -1);
			await refreshInspect();
		}
	}

	// ------------------------------------------------------------- inspection
	async function fetchParts(): Promise<void> {
		try {
			const res = await fetch(`${base}?inspect=parts${opsQuery()}`);
			if (!res.ok) return;
			const b = await res.json();
			partsList = b.parts as PartInfo[];
		} catch {
			// inspection is best-effort
		}
	}
	async function selectPart(i: number): Promise<void> {
		selectedPart = i;
		partHighlight = null;
		try {
			const res = await fetch(`${base}?inspect=part&part=${i}${opsQuery()}`);
			if (res.ok) partHighlight = new Float32Array(await res.arrayBuffer());
		} catch {
			partHighlight = null;
		}
	}
	async function fetchHoles(): Promise<void> {
		try {
			const res = await fetch(`${base}?inspect=holes${opsQuery()}`);
			if (!res.ok) return;
			const b = await res.json();
			holesList = b.holes as HoleInfo[];
			openEdges = Number(b.openEdges) || 0;
		} catch {
			// inspection is best-effort
		}
	}

	function openTool(t: Tool): void {
		tool = t;
		if (t === 'parts' && !partsList) void fetchParts();
		if ((t === 'holes' || t === 'boundary') && !holesList) void fetchHoles();
	}

	// ------------------------------------------------------------- tool actions
	function picked(hit: MeshPickHit | null): void {
		if (!hit || busy) return;
		const p = rv(hit);
		if (tool === 'bridge') {
			if (!bridgeA || (bridgeA && bridgeB)) {
				bridgeA = p;
				bridgeB = null;
			} else {
				bridgeB = p;
			}
		} else if (tool === 'remesh') {
			remeshCenter = p;
		} else if (tool === 'wax') {
			const op: EditOp = { op: 'smooth', center: p, radius: waxRadius };
			if (waxMode !== 'smooth') {
				op.mode = waxMode === 'remove' ? 'flatten' : 'add';
				op.strength = waxStrength;
			}
			void pushOp(op, 'Wax knife');
		} else if (tool === 'eraser') {
			const op: EditOp = { op: 'erase', center: p, radius: eraseRadius };
			if (eraseDeep) {
				op.deep = true;
				op.axis = rv({ x: hit.nx, y: hit.ny, z: hit.nz });
			}
			void pushOp(op, eraseDeep ? 'Deep erase' : 'Eraser');
		} else if (tool === 'margin') {
			marginPts = [...marginPts, p];
		}
	}

	async function partAction(action: 'deleteSelected' | 'keepSelected' | 'keepLargest'): Promise<void> {
		const op: EditOp = { op: 'parts', action };
		if (action !== 'keepLargest') {
			if (selectedPart < 0) return;
			op.part = selectedPart;
		}
		await pushOp(op, 'Part detection');
	}

	async function boundaryApply(): Promise<void> {
		const op: EditOp = {
			op: 'boundarySmooth',
			iterations: Math.min(10, Math.max(1, Math.round(boundaryIterations) || 3))
		};
		if (boundaryLoop >= 0) op.loop = boundaryLoop;
		await pushOp(op, 'Boundary optimization');
	}

	async function bridgeApply(): Promise<void> {
		if (!bridgeA || !bridgeB) return;
		if (await pushOp({ op: 'bridge', a: bridgeA, b: bridgeB }, 'Bridge boundaries')) {
			bridgeA = null;
			bridgeB = null;
		}
	}

	async function marginCut(keep: 'inside' | 'outside'): Promise<void> {
		if (marginPts.length < 3) return;
		const pts = marginPts.map(rv);
		if (await pushOp({ op: 'marginCut', points: pts, keep }, 'Margin cut')) marginPts = [];
	}

	/** Split: the discarded (outer) side becomes a new model, this mesh keeps the inner side. */
	async function marginSplit(): Promise<void> {
		if (marginPts.length < 3 || busy) return;
		const pts = marginPts.map(rv);
		busy = 'Split along margin';
		try {
			const res = await fetch(base, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					ops: [...plainOps(ops), { op: 'marginCut', points: pts, keep: 'outside' }],
					saveAsCopy: true,
					name: `${modelName || 'Model'} (outer)`
				})
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				alert(b?.message ?? 'Split failed');
				return;
			}
			copySaved = true;
		} finally {
			busy = '';
		}
		if (await pushOp({ op: 'marginCut', points: pts, keep: 'inside' }, 'Margin cut')) marginPts = [];
	}

	// ------------------------------------------------------------- persist
	async function apply(): Promise<void> {
		if (busy) return;
		if (!ops.length) {
			onclose(copySaved);
			return;
		}
		busy = 'Apply';
		try {
			const res = await fetch(base, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ops: plainOps(ops), apply: true })
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				alert(b?.message ?? 'Apply failed');
				return;
			}
			onclose(true);
		} finally {
			busy = '';
		}
	}

	async function saveAsCopy(): Promise<void> {
		if (busy) return;
		busy = 'Save as copy';
		try {
			const res = await fetch(base, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ops: plainOps(ops), saveAsCopy: true })
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				alert(b?.message ?? 'Save as copy failed');
				return;
			}
			onclose(true);
		} finally {
			busy = '';
		}
	}

	function cancel(): void {
		if (ops.length && !confirm('Discard the mesh edits? The model file was not modified.')) return;
		onclose(copySaved);
	}

	// ------------------------------------------------------------- init
	onMount(() => {
		void caseId; // models for Combine are resolved server-side via the model's case
		void (async () => {
			if (!(await runPreview([], 'Loading', true))) {
				loadErr = 'Could not load the model mesh.';
			}
			try {
				const r = await fetch(`${base}?inspect=stats`);
				if (r.ok) {
					const b = await r.json();
					modelName = String(b.name ?? '');
					siblings = (b.models ?? []) as { id: number; name: string; kind: string }[];
					combineId = siblings[0]?.id ?? null;
				}
			} catch {
				// stats are decorative
			}
		})();
	});
</script>

<div class="me-backdrop" role="presentation">
	<div class="me-dialog panel">
		<div class="dialog-title me-title">
			<span>
				Mesh Editor{modelName ? ` — ${modelName}` : ''}
				<span class="me-subtitle">Optimize or modify mesh</span>
			</span>
			<button class="btn ghost me-close" onclick={cancel} title="Close" aria-label="Close">✕</button>
		</div>

		<div class="me-body">
			<aside class="me-rail">
				{#each TOOLS as t (t.key)}
					<button class="me-tool" class:current={tool === t.key} onclick={() => openTool(t.key)}>
						{t.label}
					</button>
					{#if tool === t.key}
						<div class="me-panel">
							{#if t.key === 'parts'}
								<button class="btn small" disabled={!!busy} onclick={fetchParts}>Detect all parts</button>
								{#if partsList}
									{#if partsList.length === 0}
										<div class="me-note">No parts found.</div>
									{:else}
										<div class="me-list">
											{#each partsList as p (p.index)}
												<button
													class="me-item"
													class:sel={selectedPart === p.index}
													onclick={() => selectPart(p.index)}
												>
													Part {p.index + 1} — {p.triangles} tris · {p.vertices} pts
												</button>
											{/each}
										</div>
									{/if}
									<button class="btn small" disabled={!!busy || selectedPart < 0} onclick={() => partAction('deleteSelected')}>
										Delete selected part
									</button>
									<button class="btn small" disabled={!!busy || selectedPart < 0} onclick={() => partAction('keepSelected')}>
										Delete all but the selected part
									</button>
									<button class="btn small" disabled={!!busy || partsList.length < 2} onclick={() => partAction('keepLargest')}>
										Delete all but largest part
									</button>
								{/if}
							{:else if t.key === 'holes'}
								<button class="btn small" disabled={!!busy} onclick={fetchHoles}>Detect holes</button>
								{#if holesList}
									<div class="me-note">{holesList.length} hole(s) · {openEdges} open edges</div>
									{#if holesList.length > 0}
										<div class="me-list">
											{#each holesList as h (h.index)}
												<button
													class="me-item"
													class:sel={selectedHole === h.index}
													onclick={() => (selectedHole = selectedHole === h.index ? -1 : h.index)}
													onmouseenter={() => (selectedHole = h.index)}
												>
													Hole {h.index + 1} — {h.edges} edges · {h.lengthMm} mm
												</button>
											{/each}
										</div>
										<button
											class="btn small"
											disabled={!!busy}
											onclick={() => pushOp({ op: 'fillHoles', maxEdges: 100000 }, 'Close holes')}
										>
											Close all holes (incl. largest)
										</button>
										<button
											class="btn small"
											disabled={!!busy || holesList.length < 2}
											onclick={() => pushOp({ op: 'fillHoles', maxEdges: 100000, exceptLargest: true }, 'Close holes')}
										>
											Close holes without largest
										</button>
										<button
											class="btn small"
											disabled={!!busy || selectedHole < 0}
											onclick={() => pushOp({ op: 'fillHoles', hole: selectedHole }, 'Close hole')}
										>
											Close selected hole
										</button>
									{/if}
								{/if}
							{:else if t.key === 'boundary'}
								<button class="btn small" disabled={!!busy} onclick={fetchHoles}>Detect boundaries</button>
								{#if holesList}
									<div class="me-note">{holesList.length} open boundary loop(s)</div>
									{#if holesList.length > 0}
										<div class="me-list">
											<button class="me-item" class:sel={boundaryLoop === -1} onclick={() => (boundaryLoop = -1)}>
												All boundaries
											</button>
											{#each holesList as h (h.index)}
												<button
													class="me-item"
													class:sel={boundaryLoop === h.index}
													onclick={() => (boundaryLoop = boundaryLoop === h.index ? -1 : h.index)}
													onmouseenter={() => (boundaryLoop = h.index)}
												>
													Boundary {h.index + 1} — {h.edges} edges · {h.lengthMm} mm
												</button>
											{/each}
										</div>
										<label class="me-field">
											Iterations
											<input type="number" min="1" max="10" step="1" bind:value={boundaryIterations} />
										</label>
										<button class="btn small" disabled={!!busy} onclick={boundaryApply}>
											Smooth {boundaryLoop >= 0 ? `boundary ${boundaryLoop + 1}` : 'all boundaries'}
										</button>
									{/if}
								{/if}
							{:else if t.key === 'bridge'}
								<div class="me-note">
									A: {bridgeA ? 'set' : 'click the mesh near the first boundary'}<br />
									B: {bridgeB ? 'set' : bridgeA ? 'click near the second boundary' : '—'}
								</div>
								<button class="btn small" disabled={!!busy || !bridgeA || !bridgeB} onclick={bridgeApply}>
									Bridge boundaries
								</button>
								<button class="btn small" disabled={!bridgeA && !bridgeB} onclick={() => ((bridgeA = null), (bridgeB = null))}>
									Clear points
								</button>
							{:else if t.key === 'remesh'}
								<label class="me-field">
									Radius
									<input type="range" min="1" max="30" step="1" bind:value={remeshRadius} />
									{remeshRadius} mm
								</label>
								<label class="me-check">
									<input type="checkbox" bind:checked={remeshWhole} /> whole mesh
								</label>
								{#if !remeshWhole}
									<div class="me-note">{remeshCenter ? 'Center set — click again to move it.' : 'Click the mesh to set the center.'}</div>
								{/if}
								<button
									class="btn small"
									disabled={!!busy || (!remeshWhole && !remeshCenter)}
									onclick={() =>
										pushOp(
											remeshWhole
												? { op: 'remesh', radius: remeshRadius }
												: { op: 'remesh', center: remeshCenter!, radius: remeshRadius },
											'Remesh'
										)}
								>
									Remesh
								</button>
							{:else if t.key === 'reduce'}
								<label class="me-field">
									Percentage reduction to
									<input type="range" min="10" max="95" step="5" bind:value={reducePercent} />
									{reducePercent} %
								</label>
								<button class="btn small" disabled={!!busy} onclick={() => pushOp({ op: 'reduce', targetPercent: reducePercent }, 'Reduce')}>
									Reduce mesh
								</button>
							{:else if t.key === 'invert'}
								<button class="btn small" disabled={!!busy} onclick={() => pushOp({ op: 'invert' }, 'Invert mesh')}>
									Invert mesh
								</button>
							{:else if t.key === 'wax'}
								<div class="me-seg">
									<button class="btn small" class:primary={waxMode === 'smooth'} onclick={() => (waxMode = 'smooth')}>Smooth</button>
									<button class="btn small" class:primary={waxMode === 'remove'} onclick={() => (waxMode = 'remove')}>Remove</button>
									<button class="btn small" class:primary={waxMode === 'add'} onclick={() => (waxMode = 'add')}>Add</button>
								</div>
								{#if waxMode !== 'smooth'}
									<div class="me-seg">
										{#each ['A', 'B', 'C', 'D'] as s (s)}
											<button
												class="btn small"
												class:primary={waxStrength === s}
												title="Strength {s}"
												onclick={() => (waxStrength = s as 'A' | 'B' | 'C' | 'D')}
											>
												{s}
											</button>
										{/each}
									</div>
								{/if}
								<label class="me-field">
									Radius
									<input type="range" min="1" max="15" step="0.5" bind:value={waxRadius} />
									{waxRadius} mm
								</label>
							{:else if t.key === 'eraser'}
								<label class="me-field">
									Radius
									<input type="range" min="0.5" max="10" step="0.5" bind:value={eraseRadius} />
									{eraseRadius} mm
								</label>
								<label class="me-check">
									<input type="checkbox" bind:checked={eraseDeep} /> deep erase (through-thickness)
								</label>
							{:else if t.key === 'margin'}
								<div class="me-note">{marginPts.length} point(s) on the margin line</div>
								<button class="btn small" disabled={!marginPts.length} onclick={() => (marginPts = marginPts.slice(0, -1))}>
									Remove last point
								</button>
								<button class="btn small" disabled={!marginPts.length} onclick={() => (marginPts = [])}>
									Remove margin line
								</button>
								<button class="btn small" disabled={!!busy || marginPts.length < 3} onclick={() => marginCut('inside')}>
									Cut — keep inside
								</button>
								<button class="btn small" disabled={!!busy || marginPts.length < 3} onclick={() => marginCut('outside')}>
									Cut — keep outside
								</button>
								<button
									class="btn small"
									disabled={!!busy || marginPts.length < 3}
									title="Keep the inside here; the outside is saved as a new model"
									onclick={marginSplit}
								>
									Cut — split into two models
								</button>
							{:else if t.key === 'combine'}
								{#if siblings.length === 0}
									<div class="me-note">No other models in this case.</div>
								{:else}
									<select class="me-select" bind:value={combineId}>
										{#each siblings as s (s.id)}
											<option value={s.id}>{s.name} ({s.kind})</option>
										{/each}
									</select>
									<button
										class="btn small"
										disabled={!!busy || combineId == null}
										onclick={() => pushOp({ op: 'combine', modelId: combineId! }, 'Combine')}
									>
										Apply operation
									</button>
								{/if}
							{/if}
						</div>
					{/if}
				{/each}

				<div class="me-help">
					<div class="me-help-title">Short help</div>
					{activeHint}
					<br />Move: drag · Zoom: wheel{pickActive ? ' · Pick: click the mesh' : ''}
				</div>
			</aside>

			<section class="me-main" bind:clientHeight={mainH}>
				{#if loadErr}
					<div class="me-err">{loadErr}</div>
				{:else}
					<MeshCanvas
						meshes={canvasMeshes}
						overlays={canvasOverlays}
						{pickActive}
						onpick={picked}
						{resetTick}
						height={Math.max(320, mainH - 16)}
					/>
					{#if busy}
						<div class="me-busy">Processing — {busy}…</div>
					{/if}
					<button class="btn small me-reset" onclick={() => resetTick++}>Reset view</button>
				{/if}
			</section>
		</div>

		<div class="dialog-actions me-actions">
			<button class="btn" onclick={undo} disabled={!!busy || ops.length === 0} title="Remove the last edit (replayed from the original)">
				↶ Undo
			</button>
			<button class="btn" onclick={redo} disabled={!!busy || redoStack.length === 0} title="Re-apply the last undone edit">
				↷ Redo
			</button>
			<span class="me-status muted">
				Point count: {vertices.toLocaleString()} · Triangle count: {triangles.toLocaleString()}
				· {ops.length} edit{ops.length === 1 ? '' : 's'}
				{#if lastNote}· {lastNote}{/if}
			</span>
			<button class="btn" onclick={saveAsCopy} disabled={!!busy || !positions} title="Keep this model untouched and save the result as a new model">
				Save as copy
			</button>
			<button class="btn primary" onclick={apply} disabled={!!busy || !positions} title="Overwrite this model with the edited mesh (a one-time .orig backup is kept)">
				Apply
			</button>
			<button class="btn" onclick={cancel} disabled={!!busy}>Cancel</button>
		</div>
	</div>
</div>

<style>
	.me-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.me-dialog {
		width: min(1240px, 96vw);
		height: min(840px, 94vh);
		display: flex;
		flex-direction: column;
		box-shadow: var(--shadow);
	}
	.me-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.me-subtitle {
		margin-left: 10px;
		font-size: 11px;
		font-weight: 400;
		color: var(--text-dim);
	}
	.me-close {
		padding: 0 6px;
	}
	.me-body {
		flex: 1;
		display: grid;
		grid-template-columns: 280px 1fr;
		min-height: 0;
	}
	.me-rail {
		border-right: 1px solid var(--border-soft);
		background: var(--bg-1);
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		overflow-y: auto;
	}
	.me-tool {
		text-align: left;
		padding: 7px 10px;
		border-radius: var(--radius);
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.me-tool:hover {
		background: var(--bg-3);
	}
	.me-tool.current {
		background: var(--accent-dim);
	}
	.me-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px 12px;
		border-left: 2px solid var(--border-soft);
		margin: 0 0 4px 8px;
	}
	.btn.small {
		font-size: 12px;
		padding: 4px 8px;
	}
	.me-panel .btn.small {
		text-align: left;
	}
	.me-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 3px;
	}
	.me-item {
		text-align: left;
		font-size: 12px;
		padding: 3px 6px;
		border-radius: var(--radius);
		color: var(--text-dim);
	}
	.me-item:hover {
		background: var(--bg-3);
	}
	.me-item.sel {
		background: var(--accent-dim);
		color: var(--text);
	}
	.me-note {
		font-size: 11px;
		color: var(--text-dim);
	}
	.me-field {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
		margin: 0;
		color: var(--text);
		white-space: nowrap;
	}
	.me-field input[type='range'] {
		flex: 1;
		min-width: 60px;
	}
	.me-field input[type='number'] {
		width: 60px;
	}
	.me-check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		text-transform: none;
		letter-spacing: 0;
		margin: 0;
		color: var(--text);
	}
	.me-seg {
		display: flex;
		gap: 4px;
	}
	.me-select {
		width: 100%;
		font-size: 12px;
	}
	.me-help {
		margin-top: auto;
		padding: 10px;
		font-size: 11px;
		color: var(--text-dim);
		border-top: 1px solid var(--border-soft);
	}
	.me-help-title {
		font-weight: 600;
		color: var(--text);
		margin-bottom: 3px;
	}
	.me-main {
		position: relative;
		padding: 8px;
		min-width: 0;
		min-height: 0;
	}
	.me-err {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-dim);
	}
	.me-busy {
		position: absolute;
		top: 18px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-1);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 6px 14px;
		font-size: 12px;
		box-shadow: var(--shadow);
	}
	.me-reset {
		position: absolute;
		right: 16px;
		top: 16px;
	}
	.me-actions {
		align-items: center;
	}
	.me-status {
		margin-right: auto;
		margin-left: 6px;
		font-size: 12px;
	}
</style>
