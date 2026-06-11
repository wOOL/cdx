<script lang="ts">
	/**
	 * Self-contained guide-generation options panel.
	 * All edits are reported through `onchange(nextParams)`; the component never
	 * mutates the `params` prop. Recipe selection is reported via `onrecipe(key)`.
	 */
	interface Recipe {
		key: string;
		name: string;
		description: string;
	}

	let {
		params,
		warnings = [],
		recipes = [],
		onchange,
		onrecipe
	}: {
		params: Record<string, unknown>;
		warnings: string[];
		recipes: Recipe[];
		onchange: (params: Record<string, unknown>) => void;
		onrecipe: (key: string) => void;
	} = $props();

	let recipeKey = $state('');
	let selectedRecipe = $derived(recipes.find((r) => r.key === recipeKey) ?? null);

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
				fields: ['x', 'y', 'diameter'],
				template: { x: 0, y: 0, diameter: 5 }
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

	function labelOf(): { text: string; x: number; y: number } {
		const l = (params.label ?? {}) as Record<string, unknown>;
		return { text: typeof l.text === 'string' ? l.text : '', x: num(l.x, 0), y: num(l.y, 0) };
	}

	function setLabel(field: 'text' | 'x' | 'y', raw: string): void {
		const next = { ...labelOf(), [field]: field === 'text' ? raw : num(raw, 0) };
		set('label', next.text.trim() ? next : undefined);
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

	<!-- embossed label -->
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

	<!-- editable lists -->
	{#each LISTS as list (list.key)}
		<div class="list">
			<div class="list-head">
				<span>{list.name}</span>
				<button type="button" class="btn ghost" onclick={() => addRow(list.key, list.template)}>
					+ Add
				</button>
			</div>
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
