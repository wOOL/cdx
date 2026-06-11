<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import type { PlanningState } from '$lib/client/planning.svelte';

	let { state: ps }: { state: PlanningState } = $props();

	let container: HTMLDivElement | undefined = $state();
	let loading = $state(true);
	let loadError = $state('');

	// rendering presets — threshold in normalized units of the u8 window [-1000..3000] HU
	const PRESETS = [
		{ name: 'Bone', threshold: (300 + 1000) / 4000 },
		{ name: 'Hard bone', threshold: (700 + 1000) / 4000 },
		{ name: 'Soft tissue', threshold: (-300 + 1000) / 4000 },
		{ name: 'MIP', threshold: 0 }
	];
	let preset = $state('Bone');
	let threshold = $state((300 + 1000) / 4000);

	let material: THREE.ShaderMaterial | null = null;
	let redraw: (() => void) | null = null;

	$effect(() => {
		const p = PRESETS.find((p) => p.name === preset);
		if (p && p.name !== 'MIP') threshold = p.threshold;
	});

	$effect(() => {
		if (material) {
			material.uniforms.u_threshold.value = threshold;
			material.uniforms.u_mip.value = preset === 'MIP' ? 1 : 0;
			redraw?.();
		}
	});

	const VERT = /* glsl */ `
		varying vec3 v_position;
		void main() {
			v_position = position;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`;

	const FRAG = /* glsl */ `
		precision highp float;
		precision highp sampler3D;

		uniform sampler3D u_data;
		uniform vec3 u_halfExtent;     // box half-size in object space (mm)
		uniform float u_threshold;     // iso threshold (0..1)
		uniform int u_mip;             // 1 = MIP mode
		uniform vec3 u_camPos;         // camera in object space

		varying vec3 v_position;

		vec2 boxIntersect(vec3 ro, vec3 rd, vec3 halfExtent) {
			vec3 inv = 1.0 / rd;
			vec3 t0 = (-halfExtent - ro) * inv;
			vec3 t1 = (halfExtent - ro) * inv;
			vec3 tmin = min(t0, t1);
			vec3 tmax = max(t0, t1);
			return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
		}

		float sampleVol(vec3 p) {
			vec3 uvw = (p + u_halfExtent) / (2.0 * u_halfExtent);
			return texture(u_data, uvw).r;
		}

		vec3 gradient(vec3 p, float eps) {
			return normalize(vec3(
				sampleVol(p + vec3(eps, 0, 0)) - sampleVol(p - vec3(eps, 0, 0)),
				sampleVol(p + vec3(0, eps, 0)) - sampleVol(p - vec3(0, eps, 0)),
				sampleVol(p + vec3(0, 0, eps)) - sampleVol(p - vec3(0, 0, eps))
			));
		}

		void main() {
			vec3 rd = normalize(v_position - u_camPos);
			vec2 hit = boxIntersect(u_camPos, rd, u_halfExtent - 0.01);
			float tNear = max(hit.x, 0.0);
			float tFar = hit.y;
			if (tNear >= tFar) discard;

			float stepSize = length(u_halfExtent) * 2.0 / 400.0;
			vec3 p = u_camPos + rd * tNear;

			if (u_mip == 1) {
				float m = 0.0;
				for (int i = 0; i < 512; i++) {
					float t = tNear + float(i) * stepSize;
					if (t > tFar) break;
					m = max(m, sampleVol(u_camPos + rd * t));
				}
				if (m < 0.02) discard;
				gl_FragColor = vec4(vec3(m), 1.0);
				return;
			}

			// isosurface raymarch with refinement
			float prev = sampleVol(p);
			for (int i = 1; i < 512; i++) {
				float t = tNear + float(i) * stepSize;
				if (t > tFar) break;
				vec3 pos = u_camPos + rd * t;
				float v = sampleVol(pos);
				if (v >= u_threshold && prev < u_threshold) {
					// binary refine
					float a = t - stepSize;
					float b = t;
					for (int j = 0; j < 6; j++) {
						float mid = (a + b) * 0.5;
						if (sampleVol(u_camPos + rd * mid) >= u_threshold) b = mid; else a = mid;
					}
					vec3 hitP = u_camPos + rd * b;
					vec3 n = -gradient(hitP, stepSize);
					vec3 lightDir = normalize(-rd + vec3(0.3, 0.5, 0.2));
					float diff = max(dot(n, lightDir), 0.0);
					float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 24.0);
					vec3 base = vec3(0.88, 0.84, 0.75);
					vec3 col = base * (0.25 + 0.7 * diff) + vec3(0.4) * spec;
					gl_FragColor = vec4(col, 1.0);
					return;
				}
				prev = v;
			}
			discard;
		}
	`;

	onMount(() => {
		let disposed = false;
		let renderer: THREE.WebGLRenderer | null = null;
		let controls: OrbitControls | null = null;
		let ro: ResizeObserver | null = null;

		(async () => {
			try {
				const res = await fetch(`/api/datasets/${ps.ds.id}/preview`);
				if (!res.ok) throw new Error(`preview fetch failed (${res.status})`);
				const cols = Number(res.headers.get('X-Cols'));
				const rows = Number(res.headers.get('X-Rows'));
				const slices = Number(res.headers.get('X-Slices'));
				const data = new Uint8Array(await res.arrayBuffer());
				if (disposed || !container) return;

				const texture = new THREE.Data3DTexture(data, cols, rows, slices);
				texture.format = THREE.RedFormat;
				texture.type = THREE.UnsignedByteType;
				texture.minFilter = THREE.LinearFilter;
				texture.magFilter = THREE.LinearFilter;
				texture.unpackAlignment = 1;
				texture.needsUpdate = true;

				// physical extents in mm (full volume size)
				const ex = (ps.ds.cols * ps.ds.spacing_x) / 2;
				const ey = (ps.ds.rows * ps.ds.spacing_y) / 2;
				const ez = (ps.ds.slices * ps.ds.spacing_z) / 2;

				const scene = new THREE.Scene();
				scene.background = new THREE.Color(0x000000);

				const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);

				material = new THREE.ShaderMaterial({
					uniforms: {
						u_data: { value: texture },
						u_halfExtent: { value: new THREE.Vector3(ex, ey, ez) },
						u_threshold: { value: threshold },
						u_mip: { value: 0 },
						u_camPos: { value: new THREE.Vector3() }
					},
					vertexShader: VERT,
					fragmentShader: FRAG,
					side: THREE.BackSide,
					transparent: false
				});

				const geometry = new THREE.BoxGeometry(ex * 2, ey * 2, ez * 2);
				const mesh = new THREE.Mesh(geometry, material);
				// orient anatomy: DICOM +z (head) → screen up, +y (posterior) → away
				const group = new THREE.Group();
				group.add(mesh);
				group.rotation.x = -Math.PI / 2;
				scene.add(group);

				renderer = new THREE.WebGLRenderer({ antialias: true });
				renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
				container.appendChild(renderer.domElement);

				const maxExt = Math.max(ex, ey, ez);
				camera.position.set(0, maxExt * 1.2, maxExt * 2.6);
				camera.lookAt(0, 0, 0);

				controls = new OrbitControls(camera, renderer.domElement);
				controls.enableDamping = true;
				controls.dampingFactor = 0.12;

				const draw = () => {
					if (!renderer || !material) return;
					// camera position in mesh-local (object) space
					const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
					const camLocal = camera.position.clone().applyMatrix4(inv);
					material.uniforms.u_camPos.value.copy(camLocal);
					renderer.render(scene, camera);
				};
				redraw = draw;

				controls.addEventListener('change', draw);

				const resize = () => {
					if (!container || !renderer) return;
					const w = container.clientWidth;
					const h = container.clientHeight;
					if (w === 0 || h === 0) return;
					renderer.setSize(w, h);
					camera.aspect = w / h;
					camera.updateProjectionMatrix();
					draw();
				};
				ro = new ResizeObserver(resize);
				ro.observe(container);
				resize();

				// damping needs a few frames after interaction
				let rafId = 0;
				const tick = () => {
					if (disposed) return;
					if (controls) controls.update();
					rafId = requestAnimationFrame(tick);
				};
				tick();
				const cancelTick = () => cancelAnimationFrame(rafId);

				loading = false;

				return () => cancelTick();
			} catch (e) {
				loadError = e instanceof Error ? e.message : 'failed to load volume';
				loading = false;
			}
		})();

		return () => {
			disposed = true;
			ro?.disconnect();
			controls?.dispose();
			if (renderer) {
				renderer.dispose();
				renderer.domElement.remove();
			}
		};
	});
</script>

<div class="volume-view" bind:this={container}>
	{#if loading}
		<div class="vol-status muted">Loading volume…</div>
	{:else if loadError}
		<div class="vol-status muted">3D unavailable: {loadError}</div>
	{/if}
	<div class="view-label">3D</div>
	<div class="vol-controls">
		<select bind:value={preset}>
			{#each PRESETS as p (p.name)}
				<option value={p.name}>{p.name}</option>
			{/each}
		</select>
		{#if preset !== 'MIP'}
			<input type="range" min="0.05" max="0.95" step="0.005" bind:value={threshold} title="Threshold" />
		{/if}
	</div>
</div>

<style>
	.volume-view {
		position: relative;
		width: 100%;
		height: 100%;
		background: #000;
		overflow: hidden;
	}
	.volume-view :global(canvas) {
		position: absolute;
		inset: 0;
	}
	.vol-status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.view-label {
		position: absolute;
		top: 6px;
		left: 8px;
		font-size: 11px;
		color: var(--accent-bright);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		pointer-events: none;
	}
	.vol-controls {
		position: absolute;
		top: 4px;
		right: 6px;
		display: flex;
		gap: 6px;
		align-items: center;
		opacity: 0.35;
		transition: opacity 0.15s;
	}
	.volume-view:hover .vol-controls {
		opacity: 1;
	}
	.vol-controls select {
		padding: 2px 6px;
		font-size: 11px;
	}
	.vol-controls input[type='range'] {
		width: 90px;
	}
</style>
