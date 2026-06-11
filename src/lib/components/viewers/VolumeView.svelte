<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { STLLoader } from 'three/addons/loaders/STLLoader.js';
	import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
	import type { PlanningState } from '$lib/client/planning.svelte';

	let {
		state: ps,
		onMeshClick
	}: {
		state: PlanningState;
		/** click (not drag) on a surface model: scan-local + volume-local mm coords */
		onMeshClick?: (e: {
			modelId: number;
			scanLocal: { x: number; y: number; z: number };
			volumeLocal: { x: number; y: number; z: number };
		}) => void;
	} = $props();

	/** read vertex positions of a loaded model (scan-local coords) */
	export function getModelPositions(id: number): Float32Array | null {
		const mesh = modelMeshes.get(id);
		const attr = mesh?.geometry?.getAttribute('position');
		return attr ? (attr.array as Float32Array) : null;
	}

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
	let objGroup: THREE.Group | null = null;
	let sceneReady = $state(false);
	let volHalfExtent = { x: 0, y: 0, z: 0 };

	function rebuildObjects() {
		if (!objGroup) return;
		// dispose previous
		for (const child of [...objGroup.children]) {
			objGroup.remove(child);
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				(child.material as THREE.Material).dispose();
			}
		}

		const off = new THREE.Vector3(volHalfExtent.x, volHalfExtent.y, volHalfExtent.z);
		const warnIds = new Set(ps.warnings.map((w) => w.implantId));
		for (const w of ps.warnings) if (w.kind === 'implant') warnIds.add(w.otherId);

		for (const im of ps.implants) {
			if (!im.visible) continue;
			const axis = new THREE.Vector3(im.ax, im.ay, im.az).normalize();
			const head = new THREE.Vector3(im.x, im.y, im.z).sub(off);
			const center = head.clone().addScaledVector(axis, im.length / 2);
			const geo = new THREE.CylinderGeometry(im.diameter / 2, im.diameter / 2.6, im.length, 24);
			const selected = ps.selectedImplantId === im.id;
			const warning = warnIds.has(im.id);
			const mat = new THREE.MeshStandardMaterial({
				color: warning ? '#d05050' : im.color,
				emissive: selected ? '#306080' : '#000000',
				roughness: 0.35,
				metalness: 0.55
			});
			const mesh = new THREE.Mesh(geo, mat);
			// cylinder +Y → head direction (opposite of axis)
			mesh.quaternion.setFromUnitVectors(
				new THREE.Vector3(0, 1, 0),
				axis.clone().multiplyScalar(-1)
			);
			mesh.position.copy(center);
			objGroup.add(mesh);

			if (im.sleeve) {
				const s = im.sleeve;
				const sleeveCenter = head
					.clone()
					.addScaledVector(axis, -(s.offset + s.height / 2));
				const sgeo = new THREE.CylinderGeometry(s.diameter / 2, s.diameter / 2, s.height, 24, 1, true);
				const smat = new THREE.MeshStandardMaterial({
					color: '#9ab8c8',
					roughness: 0.3,
					metalness: 0.8,
					side: THREE.DoubleSide,
					transparent: true,
					opacity: 0.85
				});
				const sm = new THREE.Mesh(sgeo, smat);
				sm.quaternion.copy(mesh.quaternion);
				sm.position.copy(sleeveCenter);
				objGroup.add(sm);
			}
		}

		for (const n of ps.nerves) {
			if (!n.visible || n.points.length === 0) continue;
			const mat = new THREE.MeshStandardMaterial({
				color: n.color,
				roughness: 0.6,
				metalness: 0.05
			});
			// per-point diameters: joint spheres + connecting cones
			const pts = n.points.map((p) => new THREE.Vector3(p.x - off.x, p.y - off.y, p.z - off.z));
			for (let i = 0; i < pts.length; i++) {
				const r = (n.points[i].d ?? n.diameter) / 2;
				const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat);
				s.position.copy(pts[i]);
				objGroup.add(s);
				if (i < pts.length - 1) {
					const r2 = (n.points[i + 1].d ?? n.diameter) / 2;
					const dir = pts[i + 1].clone().sub(pts[i]);
					const len = dir.length();
					if (len > 0.01) {
						const seg = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, 10, 1), mat);
						seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
						seg.position.copy(pts[i]).addScaledVector(dir, len / 2);
						objGroup.add(seg);
					}
				}
			}
		}
		redraw?.();
	}

	$effect(() => {
		// rebuild 3D objects when planning objects change
		void ps.implants.map((i) => [
			i.x, i.y, i.z, i.ax, i.ay, i.az, i.length, i.diameter, i.visible, i.color,
			i.sleeve?.diameter, i.sleeve?.height, i.sleeve?.offset
		]);
		void ps.nerves.map((n) => [
			n.points.length, n.diameter, n.visible, n.color,
			n.points.map((p) => p.x + p.y + p.z + (p.d ?? 0))
		]);
		void ps.selectedImplantId;
		void ps.warnings;
		if (sceneReady) rebuildObjects();
	});

	// ---------- surface models (scans, segmentations, guides) ----------
	let modelGroup: THREE.Group | null = null;
	const modelMeshes = new Map<number, THREE.Mesh>();

	async function loadModelMesh(id: number): Promise<void> {
		if (modelMeshes.has(id) || !modelGroup) return;
		const placeholder = new THREE.Mesh(); // reserve slot to avoid double-fetch
		modelMeshes.set(id, placeholder);
		try {
			const res = await fetch(`/api/models/${id}/file`);
			if (!res.ok) throw new Error(`fetch failed ${res.status}`);
			const fmt = res.headers.get('X-Format') ?? 'stl';
			const buf = await res.arrayBuffer();
			let geometry: THREE.BufferGeometry;
			if (fmt === 'ply') {
				geometry = new PLYLoader().parse(buf);
			} else {
				geometry = new STLLoader().parse(buf);
			}
			geometry.computeVertexNormals();
			const mesh = new THREE.Mesh(
				geometry,
				new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 })
			);
			mesh.matrixAutoUpdate = false;
			mesh.userData.modelId = id;
			modelMeshes.set(id, mesh);
			modelGroup.add(mesh);

			// first-time placement: center the scan on the volume so it is visible
			const m = ps.models.find((m) => m.id === id);
			if (m && !m.transform && m.kind === 'scan') {
				geometry.computeBoundingBox();
				const bb = geometry.boundingBox!;
				const cx = (bb.min.x + bb.max.x) / 2;
				const cy = (bb.min.y + bb.max.y) / 2;
				const cz = (bb.min.z + bb.max.z) / 2;
				const t = new THREE.Matrix4().makeTranslation(
					volHalfExtent.x - cx,
					volHalfExtent.y - cy,
					volHalfExtent.z - cz
				);
				m.transform = t.toArray();
				ps.saveModel(id);
			}
			syncModels();
		} catch {
			modelMeshes.delete(id);
		}
	}

	function syncModels() {
		if (!modelGroup) return;
		const seen = new Set<number>();
		for (const m of ps.models) {
			seen.add(m.id);
			const mesh = modelMeshes.get(m.id);
			if (!mesh) {
				loadModelMesh(m.id);
				continue;
			}
			if (!mesh.geometry || !(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
			mesh.visible = m.visible;
			mesh.material.color.set(m.color);
			mesh.material.transparent = m.opacity < 1;
			mesh.material.opacity = m.opacity;
			const arr = m.transform ?? new THREE.Matrix4().identity().toArray();
			mesh.matrix.fromArray(arr);
			mesh.matrixWorldNeedsUpdate = true;
		}
		// remove deleted models
		for (const [id, mesh] of modelMeshes) {
			if (!seen.has(id)) {
				modelGroup.remove(mesh);
				mesh.geometry?.dispose();
				modelMeshes.delete(id);
			}
		}
		redraw?.();
	}

	$effect(() => {
		void ps.models.map((m) => [m.id, m.visible, m.color, m.opacity, m.transform]);
		if (sceneReady) syncModels();
	});

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

				// objects layer (implants, nerves) in volume-local mm (centered)
				volHalfExtent = { x: ex, y: ey, z: ez };
				objGroup = new THREE.Group();
				group.add(objGroup);
				modelGroup = new THREE.Group();
				modelGroup.position.set(-ex, -ey, -ez); // children live in volume-local mm
				group.add(modelGroup);
				scene.add(new THREE.AmbientLight(0xffffff, 0.55));
				const dir = new THREE.DirectionalLight(0xffffff, 1.1);
				dir.position.set(120, 200, 160);
				scene.add(dir);

				renderer = new THREE.WebGLRenderer({ antialias: true });
				renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
				container.appendChild(renderer.domElement);

				const maxExt = Math.max(ex, ey, ez);
				camera.position.set(0, maxExt * 1.2, maxExt * 2.6);
				camera.lookAt(0, 0, 0);

				controls = new OrbitControls(camera, renderer.domElement);
				controls.enableDamping = true;
				controls.dampingFactor = 0.12;

				// click-on-model raycast (click = pointer travel < 5px)
				let downPos: { x: number; y: number } | null = null;
				renderer.domElement.addEventListener('pointerdown', (e) => {
					downPos = { x: e.clientX, y: e.clientY };
				});
				renderer.domElement.addEventListener('pointerup', (e) => {
					if (!downPos || !onMeshClick || !renderer || !modelGroup) return;
					const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
					downPos = null;
					if (moved > 5) return;
					const rect = renderer.domElement.getBoundingClientRect();
					const ndc = new THREE.Vector2(
						((e.clientX - rect.left) / rect.width) * 2 - 1,
						-((e.clientY - rect.top) / rect.height) * 2 + 1
					);
					const ray = new THREE.Raycaster();
					ray.setFromCamera(ndc, camera);
					const meshes = [...modelMeshes.values()].filter((m) => m.geometry && m.visible);
					const hits = ray.intersectObjects(meshes, false);
					if (!hits.length) return;
					const hit = hits[0];
					const mesh = hit.object as THREE.Mesh;
					const sl = mesh.worldToLocal(hit.point.clone());
					const vl = modelGroup.worldToLocal(hit.point.clone());
					onMeshClick({
						modelId: mesh.userData.modelId as number,
						scanLocal: { x: sl.x, y: sl.y, z: sl.z },
						volumeLocal: { x: vl.x, y: vl.y, z: vl.z }
					});
				});

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
				sceneReady = true;
				rebuildObjects();
				syncModels();

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
