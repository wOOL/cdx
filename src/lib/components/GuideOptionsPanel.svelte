<script lang="ts">
	/**
	 * Self-contained guide-generation options panel.
	 * All edits are reported through `onchange(nextParams)`; the component never
	 * mutates the `params` prop. Recipe selection is reported via `onrecipe(key)`.
	 *
	 * Extra keys managed in `params` (all flow through the existing POST body's
	 * `params` object — the guide endpoint reads them from there):
	 *  - intaglioModelId: guide foundation = intaglio (bottom) surface of another
	 *    case model (dual-scan denture workflow)
	 *  - mergeModelIds:   "Add object" — case models merged into the guide STL
	 *    with the tool paths / windows cut through them (coDX 9.10)
	 *  - label.height / label.depth / label.style ('embossed' | 'impressed')
	 *  - rotationMarkers: engrave a radial implant-rotation marker on each
	 *    sleeve mount's top face (oriented by the abutment rotation azimuth)
	 */
	import { FDI_LOWER, FDI_UPPER } from '$lib/implantLibrary';

	interface Recipe {
		key: string;
		name: string;
		description: string;
	}

	let {
		params,
		warnings = [],
		recipes = [],
		models = [],
		caseMeta = null,
		archPoint = null,
		onchange,
		onrecipe
	}: {
		params: Record<string, unknown>;
		warnings: string[];
		recipes: Recipe[];
		/** The case's models (guides are filtered out) for "Guide foundation" / "Add object". */
		models?: { id: number; name: string; kind: string }[];
		/** Case metadata for the label preset buttons; section hidden when absent. */
		caseMeta?: { patientName?: string; patientId?: string; date?: string; dateOfBirth?: string; teeth?: string } | null;
		/** FDI tooth → axial arch position (mm); the tooth quick-pick is hidden when absent. */
		archPoint?: ((tooth: string) => { x: number; y: number } | null) | null;
		onchange: (params: Record<string, unknown>) => void;
		onrecipe: (key: string) => void;
	} = $props();

	let recipeKey = $state('');
	let selectedRecipe = $derived(recipes.find((r) => r.key === recipeKey) ?? null);
	let foundationModels = $derived(models.filter((m) => m.kind !== 'guide'));

	const NUMERIC_FIELDS: { key: string; label: string; def: number; step: number }[] = [
		{ key: 'offset', label: 'Offset', def: 0.15, step: 0.05 },
		{ key: 'thickness', label: 'Thickness', def: 2.5, step: 0.5 },
		{ key: 'regionRadius', label: 'Region radius', def: 9, step: 1 },
		{ key: 'voxel', label: 'Voxel', def: 0.3, step: 0.05 },
		{ key: 'mountWall', label: 'Mount wall', def: 1.6, step: 0.1 }
	];

	/** List sections: storage key, display name, per-row numeric fields, new-row template. */
	const LISTS: { key: string; name: string; fields: string[]; template: Record<string, number> }[] =
		[
			{
				key: 'supportRegions',
				name: 'Bone support regions',
				fields: ['x', 'y', 'radius'],
				template: { x: 0, y: 0, radius: 5 }
			},
			{
				key: 'windows',
				name: 'Inspection windows',
				fields: ['x', 'y', 'diameter', 'length', 'angle'],
				template: { x: 0, y: 0, diameter: 5, length: 5, angle: 0 }
			},
			{
				key: 'reductionBars',
				name: 'Bone reduction bars',
				fields: ['x1', 'y1', 'x2', 'y2', 'width', 'height', 'zTop'],
				template: { x1: 0, y1: 0, x2: 10, y2: 0, width: 4, height: 3, zTop: 0 }
			}
		];

	function num(v: unknown, def: number): number {
		const n = Number(v);
		return Number.isFinite(n) ? n : def;
	}

	function set(key: string, value: unknown): void {
		onchange({ ...params, [key]: value });
	}

	function setNum(key: string, raw: string, def: number): void {
		set(key, num(raw, def));
	}

	function labelOf(): {
		text: string;
		x: number;
		y: number;
		height: number;
		depth: number;
		style: 'embossed' | 'impressed';
	} {
		const l = (params.label ?? {}) as Record<string, unknown>;
		return {
			text: typeof l.text === 'string' ? l.text : '',
			x: num(l.x, 0),
			y: num(l.y, 0),
			height: num(l.height, 3),
			depth: num(l.depth, 0.8),
			style: l.style === 'impressed' ? 'impressed' : 'embossed'
		};
	}

	function setLabel(field: 'text' | 'x' | 'y' | 'height' | 'depth', raw: string): void {
		const next = { ...labelOf(), [field]: field === 'text' ? raw : num(raw, 0) };
		set('label', next.text.trim() ? next : undefined);
	}

	function setLabelStyle(embossed: boolean): void {
		const next = { ...labelOf(), style: embossed ? ('embossed' as const) : ('impressed' as const) };
		set('label', next.text.trim() ? next : undefined);
	}

	/** Label text presets from case metadata (only the ones with a value). */
	let labelPresets = $derived(
		[
			{ name: 'Patient name', value: caseMeta?.patientName ?? '' },
			{ name: 'Patient ID', value: caseMeta?.patientId ?? '' },
			{ name: 'Date', value: caseMeta?.date ?? '' },
			{ name: 'Date of birth', value: caseMeta?.dateOfBirth ?? '' },
			{ name: 'Tooth positions', value: caseMeta?.teeth ?? '' }
		].filter((pr) => pr.value.trim().length > 0)
	);

	/** Guide foundation: '' = base model surface, otherwise an intaglio model id. */
	function setFoundation(raw: string): void {
		const id = Number(raw);
		set('intaglioModelId', Number.isFinite(id) && id > 0 ? id : undefined);
	}

	function mergeIdsOf(): number[] {
		const v = params.mergeModelIds;
		return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
	}

	function toggleMerge(id: number, on: boolean): void {
		const next = mergeIdsOf().filter((n) => n !== id);
		if (on) next.push(id);
		set('mergeModelIds', next.length > 0 ? next : undefined);
	}

	/** Tooth quick-pick: append a support circle at the FDI tooth's arch position. */
	function addToothSupport(tooth: number): void {
		const pt = archPoint?.(String(tooth));
		if (!pt) return;
		set('supportRegions', [
			...rowsOf('supportRegions'),
			{ x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10, radius: 5 }
		]);
	}

	function rowsOf(key: string): Record<string, number>[] {
		const v = params[key];
		return Array.isArray(v) ? (v as Record<string, number>[]) : [];
	}

	function setRow(key: string, idx: number, field: string, raw: string): void {
		const next = rowsOf(key).map((r, i) => (i === idx ? { ...r, [field]: num(raw, 0) } : r));
		set(key, next);
	}

	function addRow(key: string, template: Record<string, number>): void {
		set(key, [...rowsOf(key), { ...template }]);
	}

	function delRow(key: string, idx: number): void {
		set(
			key,
			rowsOf(key).filter((_, i) => i !== idx)
		);
	}

	function pickRecipe(key: string): void {
		recipeKey = key;
		if (key) onrecipe(key);
	}
</script>

<div class="panel guide-options">
	<!-- recipe preset -->
	<div class="row">
		<div class="field grow">
			<label for="gop-recipe">Recipe</label>
			<select id="gop-recipe" value={recipeKey} onchange={(e) => pickRecipe(e.currentTarget.value)}>
				<option value="">— custom —</option>
				{#each recipes as r (r.key)}
					<option value={r.key}>{r.name}</option>
				{/each}
			</select>
		</div>
	</div>
	{#if selectedRecipe}
		<p class="recipe-note">{selectedRecipe.description}</p>
	{/if}

	<!-- guide foundation: base model surface or the intaglio (bottom) surface of
	     another case model (dual-scan denture/appliance workflow) -->
	<div class="row">
		<div class="field grow">
			<label for="gop-foundation">Guide foundation</label>
			<select
				id="gop-foundation"
				value={String(num(params.intaglioModelId, 0) || '')}
				onchange={(e) => setFoundation(e.currentTarget.value)}
			>
				<option value="">Anatomy / base model surface (default)</option>
				{#each foundationModels as m (m.id)}
					<option value={String(m.id)}>Intaglio (bottom) surface of “{m.name}”</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- "Add object" (coDX 9.10): merge case models into the produced guide,
	     with the drill corridors and inspection windows cut through them -->
	{#if foundationModels.length > 0}
		<div class="list">
			<div class="list-head"><span>Add object (merge into guide)</span></div>
			{#each foundationModels as m (m.id)}
				<label class="check">
					<input
						type="checkbox"
						checked={mergeIdsOf().includes(m.id)}
						onchange={(e) => toggleMerge(m.id, e.currentTarget.checked)}
					/>
					{m.name}
				</label>
			{/each}
			{#if mergeIdsOf().length > 0}
				<p class="recipe-note">
					Tool paths and inspection windows are enforced through the merged object(s).
				</p>
			{/if}
		</div>
	{/if}

	<!-- numeric parameters -->
	<div class="row wrap">
		{#each NUMERIC_FIELDS as f (f.key)}
			<div class="field">
				<label for={`gop-${f.key}`}>{f.label}</label>
				<input
					id={`gop-${f.key}`}
					type="number"
					step={f.step}
					value={num(params[f.key], f.def)}
					oninput={(e) => setNum(f.key, e.currentTarget.value, f.def)}
				/>
			</div>
		{/each}
	</div>

	<div class="row">
		<label class="check">
			<input
				type="checkbox"
				checked={Boolean(params.largeConnectors)}
				onchange={(e) => set('largeConnectors', e.currentTarget.checked)}
			/>
			Use large connectors
		</label>
		<div class="field">
			<label for="gop-holeshape">Hole shape</label>
			<select
				id="gop-holeshape"
				value={params.mountHoleShape === 'fitForm' ? 'fitForm' : 'cylindrical'}
				onchange={(e) => set('mountHoleShape', e.currentTarget.value)}
			>
				<option value="cylindrical">Cylindrical</option>
				<option value="fitForm">Fit to sleeve form</option>
			</select>
		</div>
	</div>

	<!-- label (embossed or impressed) -->
	<div class="row">
		<div class="field grow">
			<label for="gop-label-text">Label text</label>
			<input
				id="gop-label-text"
				type="text"
				maxlength="24"
				placeholder="A–Z 0–9 -"
				value={labelOf().text}
				oninput={(e) => setLabel('text', e.currentTarget.value)}
			/>
		</div>
		<div class="field">
			<label for="gop-label-x">Label X</label>
			<input
				id="gop-label-x"
				type="number"
				step="0.5"
				value={labelOf().x}
				oninput={(e) => setLabel('x', e.currentTarget.value)}
			/>
		</div>
		<div class="field">
			<label for="gop-label-y">Label Y</label>
			<input
				id="gop-label-y"
				type="number"
				step="0.5"
				value={labelOf().y}
				oninput={(e) => setLabel('y', e.currentTarget.value)}
			/>
		</div>
	</div>
	{#if labelPresets.length > 0}
		<div class="row wrap presets">
			{#each labelPresets as pr (pr.name)}
				<button
					type="button"
					class="btn ghost"
					title={pr.value}
					onclick={() => setLabel('text', pr.value.slice(0, 24))}
				>
					{pr.name}
				</button>
			{/each}
		</div>
	{/if}
	<div class="row">
		<div class="field">
			<label for="gop-label-height">Text height</label>
			<input
				id="gop-label-height"
				type="number"
				step="0.5"
				min="1"
				max="10"
				value={labelOf().height}
				oninput={(e) => setLabel('height', e.currentTarget.value)}
			/>
		</div>
		<div class="field">
			<label for="gop-label-depth">Relief depth</label>
			<input
				id="gop-label-depth"
				type="number"
				step="0.1"
				min="0.2"
				max="2"
				value={labelOf().depth}
				oninput={(e) => setLabel('depth', e.currentTarget.value)}
			/>
		</div>
		<label class="check">
			<input
				type="checkbox"
				checked={labelOf().style !== 'impressed'}
				onchange={(e) => setLabelStyle(e.currentTarget.checked)}
			/>
			Embossed (unchecked: impressed)
		</label>
	</div>
	<div class="row">
		<label
			class="check"
			title="Transfers the planned implant rotation onto the guide: each sleeve mount gets a small radial marker engraved on its top face, pointing along the abutment rotation azimuth (azimuth 0 when the implant has no abutment rotation)."
		>
			<input
				type="checkbox"
				checked={Boolean(params.rotationMarkers)}
				onchange={(e) => set('rotationMarkers', e.currentTarget.checked)}
			/>
			Engrave rotation markers (sleeve mounts)
		</label>
	</div>

	<!-- editable lists -->
	{#each LISTS as list (list.key)}
		<div class="list">
			<div class="list-head">
				<span>{list.name}</span>
				<button type="button" class="btn ghost" onclick={() => addRow(list.key, list.template)}>
					+ Add
				</button>
			</div>
			{#if list.key === 'supportRegions' && archPoint}
				<!-- FDI tooth quick-pick: append a support circle at the tooth's arch position -->
				<div class="fdi-grid">
					{#each [FDI_UPPER, FDI_LOWER] as fdiRow, ri (ri)}
						<div class="fdi-row">
							{#each fdiRow as tooth (tooth)}
								<button
									type="button"
									class="fdi-tooth"
									disabled={!archPoint(String(tooth))}
									title={`Add support circle at tooth ${tooth}`}
									onclick={() => addToothSupport(tooth)}
								>
									{tooth}
								</button>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
			{#each rowsOf(list.key) as row, idx (idx)}
				<div class="list-row">
					{#each list.fields as field (field)}
						<div class="field">
							<label for={`gop-${list.key}-${idx}-${field}`}>{field}</label>
							<input
								id={`gop-${list.key}-${idx}-${field}`}
								type="number"
								step="0.5"
								value={num(row[field], 0)}
								oninput={(e) => setRow(list.key, idx, field, e.currentTarget.value)}
							/>
						</div>
					{/each}
					<button
						type="button"
						class="btn ghost del"
						title="Remove"
						onclick={() => delRow(list.key, idx)}
					>
						✕
					</button>
				</div>
			{/each}
		</div>
	{/each}

	<!-- design-rule warnings -->
	{#if warnings.length > 0}
		<div class="warnings">
			<strong>Design warnings</strong>
			<ul>
				{#each warnings as w, i (i)}
					<li>{w}</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.guide-options {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px;
		font-size: 12px;
	}
	.row {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}
	.row.wrap {
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.field.grow {
		flex: 1;
	}
	.field input[type='number'] {
		width: 64px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 12px;
		margin-bottom: 6px;
	}
	.recipe-note {
		margin: 0;
		font-size: 11px;
		color: var(--text-dim, #9aa);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim, #9aa);
	}
	.list-row {
		display: flex;
		gap: 4px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.list-row .field input {
		width: 52px;
	}
	.btn.del {
		padding: 4px 8px;
	}
	.presets {
		gap: 4px;
	}
	/* FDI tooth quick-pick — same look as the implant dialog's fdi-grid */
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
		padding: 3px 0;
		font-size: 10px;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: var(--bg-1);
		color: var(--text-dim);
		min-width: 20px;
	}
	.fdi-tooth:hover:not(:disabled) {
		border-color: var(--accent-dim);
		color: var(--text);
	}
	.fdi-tooth:disabled {
		opacity: 0.35;
	}
	.warnings {
		border: 1px solid var(--yellow, #e8d44d);
		border-radius: var(--radius, 4px);
		background: color-mix(in srgb, var(--yellow, #e8d44d) 12%, transparent);
		color: var(--yellow, #e8d44d);
		padding: 8px 10px;
	}
	.warnings ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	.warnings li {
		margin: 2px 0;
	}
</style>
