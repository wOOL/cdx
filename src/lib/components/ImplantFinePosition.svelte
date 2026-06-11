<script lang="ts">
	/**
	 * Fine positioning for the selected implant (desktop: implant context menu →
	 * Fine positioning): numeric-step nudges expressed in the IMPLANT's own frame —
	 * mesial/distal and buccal/lingual translations perpendicular to the axis,
	 * depth along the axis, and tilts around the shoulder or the tip.
	 */
	import type { ImplantData } from '$lib/client/planning.svelte';

	let {
		implant,
		onapply,
		onclose
	}: {
		implant: ImplantData;
		onapply: () => void;
		onclose: () => void;
	} = $props();

	let tStep = $state(0.1);
	let rStep = $state(1);
	let pivot = $state<'shoulder' | 'tip'>('shoulder');

	type V3 = { x: number; y: number; z: number };

	function axis(): V3 {
		return { x: implant.ax, y: implant.ay, z: implant.az };
	}

	/** orthonormal basis (u, v) perpendicular to the implant axis */
	function basis(): { u: V3; v: V3 } {
		const a = axis();
		const ref: V3 = Math.abs(a.z) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
		let u = cross(a, ref);
		u = scale(u, 1 / (len(u) || 1));
		const v = cross(a, u);
		return { u, v };
	}

	const cross = (a: V3, b: V3): V3 => ({
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x
	});
	const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
	const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
	const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

	function translate(dir: V3, sign: 1 | -1): void {
		const d = scale(dir, sign * tStep);
		implant.x += d.x;
		implant.y += d.y;
		implant.z += d.z;
		onapply();
	}

	/** rotate the axis around `around` by deg; keep head (shoulder) or apex (tip) fixed */
	function tilt(around: V3, sign: 1 | -1): void {
		const rad = (sign * rStep * Math.PI) / 180;
		const a = axis();
		const cosA = Math.cos(rad);
		const sinA = Math.sin(rad);
		const k = scale(around, 1 / (len(around) || 1));
		// Rodrigues rotation
		const rotated = add(
			add(scale(a, cosA), scale(cross(k, a), sinA)),
			scale(k, (k.x * a.x + k.y * a.y + k.z * a.z) * (1 - cosA))
		);
		const n = len(rotated) || 1;
		const a2 = scale(rotated, 1 / n);
		if (pivot === 'tip') {
			// apex stays: head = apex − a2·L
			const L = implant.length;
			const apex = add({ x: implant.x, y: implant.y, z: implant.z }, scale(a, L));
			implant.x = apex.x - a2.x * L;
			implant.y = apex.y - a2.y * L;
			implant.z = apex.z - a2.z * L;
		}
		implant.ax = a2.x;
		implant.ay = a2.y;
		implant.az = a2.z;
		onapply();
	}

	const rows = $derived.by(() => {
		const { u, v } = basis();
		return { u, v, a: axis() };
	});
</script>

<div class="ifp">
	<div class="ifp-head">
		<strong>Fine positioning</strong>
		<button class="btn" onclick={onclose}>✕</button>
	</div>
	{#if implant.locked}
		<div class="ifp-note">Implant is position-locked — unlock it to fine-position.</div>
	{:else}
		<div class="ifp-grid">
			<label class="ifp-step">
				step (mm)
				<input type="number" min="0.05" step="0.05" bind:value={tStep} />
			</label>
			<div class="ifp-row">
				<span>Mesial / Distal</span>
				<button class="btn" onclick={() => translate(rows.u, -1)}>−</button>
				<button class="btn" onclick={() => translate(rows.u, 1)}>+</button>
			</div>
			<div class="ifp-row">
				<span>Buccal / Lingual</span>
				<button class="btn" onclick={() => translate(rows.v, -1)}>−</button>
				<button class="btn" onclick={() => translate(rows.v, 1)}>+</button>
			</div>
			<div class="ifp-row">
				<span>Depth (along axis)</span>
				<button class="btn" title="Shallower" onclick={() => translate(rows.a, -1)}>▲</button>
				<button class="btn" title="Deeper" onclick={() => translate(rows.a, 1)}>▼</button>
			</div>
			<label class="ifp-step">
				step (°)
				<input type="number" min="0.1" step="0.1" bind:value={rStep} />
			</label>
			<div class="ifp-row">
				<span>Pivot</span>
				<select bind:value={pivot}>
					<option value="shoulder">Shoulder (head fixed)</option>
					<option value="tip">Tip (apex fixed)</option>
				</select>
			</div>
			<div class="ifp-row">
				<span>Tilt M/D</span>
				<button class="btn" onclick={() => tilt(rows.v, -1)}>−</button>
				<button class="btn" onclick={() => tilt(rows.v, 1)}>+</button>
			</div>
			<div class="ifp-row">
				<span>Tilt B/L</span>
				<button class="btn" onclick={() => tilt(rows.u, -1)}>−</button>
				<button class="btn" onclick={() => tilt(rows.u, 1)}>+</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.ifp {
		position: absolute;
		right: 12px;
		top: 48px;
		z-index: 40;
		background: var(--panel, #1b1f2a);
		border: 1px solid var(--border, #2c3142);
		border-radius: 8px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		min-width: 240px;
	}
	.ifp-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.ifp-grid {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.ifp-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.ifp-row span {
		flex: 1;
	}
	.ifp-step {
		display: flex;
		align-items: center;
		gap: 6px;
		opacity: 0.85;
	}
	.ifp-step input {
		width: 64px;
	}
	.ifp-note {
		opacity: 0.75;
		max-width: 240px;
	}
</style>
