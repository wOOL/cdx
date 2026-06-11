<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { AnaglyphEffect } from 'three/addons/effects/AnaglyphEffect.js';
	import { STLLoader } from 'three/addons/loaders/STLLoader.js';
	import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
	import type { PlanningState } from '$lib/client/planning.svelte';

	let {
		state: ps,
		onMeshClick,
		forceClipAxial = false,
		guideHandles = null,
		onHandleMove,
		onHandleResize,
		onHandleDone,
		onVolumeClick
	}: {
		state: PlanningState;
		/** externally force the axial clip plane (PCS dialog horizontal 3D cut) */
		forceClipAxial?: boolean;
		/** click (not drag) on a surface model: scan-local + volume-local mm coords */
		onMeshClick?: (e: {
			modelId: number;
			scanLocal: { x: number; y: number; z: number };
			volumeLocal: { x: number; y: number; z: number };
		}) => void;
		/** draggable guide-design handles (support circles + label), volume-local mm */
		guideHandles?: {
			supports: { x: number; y: number; radius: number }[];
			label: { x: number; y: number; text: string; height: number } | null;
		} | null;
		/** continuous while dragging a handle on the model surface */
		onHandleMove?: (kind: 'support' | 'label', index: number, x: number, y: number) => void;
		/** wheel over a handle: delta is ±0.5 mm */
		onHandleResize?: (kind: 'support' | 'label', index: number, delta: number) => void;
		/** drag finished — persist */
		onHandleDone?: () => void;
		/**
		 * click (not drag) that hits NO surface model: the ray is marched through
		 * the volume render at the current threshold; fires with the first dense
		 * point (volume-local mm) — the original's "click in the 3D area"
		 */
		onVolumeClick?: (p: { x: number; y: number; z: number }) => void;
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
	// clip planes bound to the axial slice / cross-section position
	let clipAxial = $state(false);
	let clipCross = $state(false);
	// red/cyan stereo rendering
	let stereo = $state(false);
	let stereoEffect: AnaglyphEffect | null = null;
	// current anatomical view direction (orientation indicator)
	let viewDir = $state('');

	let material: THREE.ShaderMaterial | null = null;
	let redraw: (() => void) | null = null;
	let objGroup: THREE.Group | null = null;
	let groupRef: THREE.Group | null = null;
	let cameraRef: THREE.PerspectiveCamera | null = null;
	let controlsRef: OrbitControls | null = null;
	let viewDistance = 0;

	/** Current 3D viewing direction (camera → orbit target) in volume mm coordinates. */
	export function getViewDirection(): { x: number; y: number; z: number } | null {
		if (!cameraRef || !controlsRef || !groupRef) return null;
		const d = controlsRef.target.clone().sub(cameraRef.position);
		const q = new THREE.Quaternion();
		groupRef.getWorldQuaternion(q);
		d.applyQuaternion(q.invert());
		const len = d.length() || 1;
		return { x: d.x / len, y: d.y / len, z: d.z / len };
	}

	/** standard anatomical camera perspectives (world: +y = head up, +z = anterior) */
	function setPerspective(name: string) {
		if (!cameraRef || !controlsRef) return;
		const d = viewDistance;
		const eps = d * 0.001;
		const pos: Record<string, [number, number, number]> = {
			anterior: [0, 0, d],
			posterior: [0, 0, -d],
			left: [d, 0, 0],
			right: [-d, 0, 0],
			superior: [0, d, eps],
			inferior: [0, -d, eps]
		};
		const p = pos[name];
		if (!p) return;
		cameraRef.position.set(p[0], p[1], p[2]);
		controlsRef.target.set(0, 0, 0);
		cameraRef.lookAt(0, 0, 0);
		controlsRef.update();
		redraw?.();
	}
	let sceneReady = $state(false);
	let volHalfExtent = { x: 0, y: 0, z: 0 };
	let meshClipPlanes: THREE.Plane[] = [];

	/** apply current clip planes to every mesh material (models + implants + nerves) */
	function applyMeshClipping() {
		const planes = meshClipPlanes.length ? meshClipPlanes : null;
		for (const mesh of modelMeshes.values()) {
			if (mesh.material instanceof THREE.Material) mesh.material.clippingPlanes = planes;
		}
		if (objGroup) {
			objGroup.traverse((o) => {
				if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) {
					o.material.clippingPlanes = planes;
				}
			});
		}
	}

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

			if (im.abutment) {
				const a = im.abutment;
				const ageo = new THREE.CylinderGeometry(a.diameter / 2 * 0.75, im.diameter / 2, a.height, 20);
				const amat = new THREE.MeshStandardMaterial({
					color: '#b59ad4',
					roughness: 0.4,
					metalness: 0.4
				});
				const am = new THREE.Mesh(ageo, amat);
				am.quaternion.copy(mesh.quaternion);
				if (a.type === 'angled') {
					// tilt the abutment around a horizontal axis for an angled emergence
					const tilt = new THREE.Quaternion().setFromAxisAngle(
						new THREE.Vector3(1, 0, 0),
						(a.angle * Math.PI) / 180
					);
					am.quaternion.multiply(tilt);
				}
				am.position.copy(head.clone().addScaledVector(axis, -a.height / 2));
				objGroup.add(am);
			}

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
		applyMeshClipping();
		redraw?.();
	}

	$effect(() => {
		// rebuild 3D objects when planning objects change
		void ps.implants.map((i) => [
			i.x, i.y, i.z, i.ax, i.ay, i.az, i.length, i.diameter, i.visible, i.color,
			i.sleeve?.diameter, i.sleeve?.height, i.sleeve?.offset,
			i.abutment?.type, i.abutment?.height, i.abutment?.angle
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

	// preview volume kept for CPU ray-marching (3D-click seeding)
	let previewVol: { data: Uint8Array; cols: number; rows: number; slices: number } | null = null;

	/**
	 * March a click ray through the preview volume; returns the first sample at
	 * or above the current render threshold as volume-local mm, or null.
	 */
	function marchVolume(ndc: THREE.Vector2): { x: number; y: number; z: number } | null {
		if (!previewVol || !cameraRef || !modelGroup) return null;
		const extX = volHalfExtent.x * 2;
		const extY = volHalfExtent.y * 2;
		const extZ = volHalfExtent.z * 2;
		if (extX <= 0 || extY <= 0 || extZ <= 0) return null;
		const ray = new THREE.Raycaster();
		ray.setFromCamera(ndc, cameraRef);
		// ray endpoints into volume-local mm
		const o = modelGroup.worldToLocal(ray.ray.origin.clone());
		const q = modelGroup.worldToLocal(ray.ray.origin.clone().add(ray.ray.direction));
		const d = q.sub(o).normalize();
		// clip to the volume box [0, ext]
		let t0 = 0;
		let t1 = Infinity;
		for (const [oc, dc, ext] of [
			[o.x, d.x, extX],
			[o.y, d.y, extY],
			[o.z, d.z, extZ]
		] as const) {
			if (Math.abs(dc) < 1e-9) {
				if (oc < 0 || oc > ext) return null;
				continue;
			}
			const a = (0 - oc) / dc;
			const b = (ext - oc) / dc;
			t0 = Math.max(t0, Math.min(a, b));
			t1 = Math.min(t1, Math.max(a, b));
		}
		if (t1 <= t0) return null;
		const { data, cols, rows, slices } = previewVol;
		const thr = Math.max(1, Math.round(threshold * 255));
		const step = Math.min(extX / cols, extY / rows, extZ / slices) * 0.6;
		for (let t = t0 + step * 0.5; t <= t1; t += step) {
			const x = o.x + d.x * t;
			const y = o.y + d.y * t;
			const z = o.z + d.z * t;
			const i = Math.min(cols - 1, Math.max(0, Math.floor((x / extX) * cols)));
			const j = Math.min(rows - 1, Math.max(0, Math.floor((y / extY) * rows)));
			const k = Math.min(slices - 1, Math.max(0, Math.floor((z / extZ) * slices)));
			if (data[k * cols * rows + j * cols + i] >= thr) return { x, y, z };
		}
		return null;
	}

	// ---------- draggable guide-design handles (supports + label) ----------
	let handleGroup: THREE.Group | null = null;
	let hoveredHandle: { kind: 'support' | 'label'; index: number } | null = null;
	let draggingHandle: { kind: 'support' | 'label'; index: number } | null = null;
	const HANDLE_BLUE = 0x59b8e0;
	const HANDLE_HOVER = 0xf0dc3c;

	/** volume-local z of the highest model surface at (x, y); fallback: volume mid */
	function surfaceZAt(x: number, y: number): number {
		if (!modelGroup) return volHalfExtent.z;
		const top = modelGroup.localToWorld(new THREE.Vector3(x, y, volHalfExtent.z * 2 + 60));
		const bottom = modelGroup.localToWorld(new THREE.Vector3(x, y, -60));
		const dir = bottom.sub(top.clone()).normalize();
		const ray = new THREE.Raycaster(top, dir);
		const meshes = [...modelMeshes.values()].filter((m) => m.geometry && m.visible);
		const hits = ray.intersectObjects(meshes, false);
		if (!hits.length) return volHalfExtent.z;
		return modelGroup.worldToLocal(hits[0].point.clone()).z;
	}

	function makeLabelSprite(text: string, heightMm: number): THREE.Sprite {
		const cv = document.createElement('canvas');
		cv.width = 256;
		cv.height = 64;
		const ctx = cv.getContext('2d')!;
		ctx.fillStyle = 'rgba(11, 13, 16, 0.72)';
		ctx.fillRect(0, 0, cv.width, cv.height);
		ctx.fillStyle = '#f0dc3c';
		ctx.font = 'bold 34px Inter, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text || 'Label', cv.width / 2, cv.height / 2);
		const sprite = new THREE.Sprite(
			new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })
		);
		const h = Math.max(2, heightMm) * 1.6;
		sprite.scale.set(h * 4, h, 1);
		return sprite;
	}

	/** rebuild the handle meshes from the prop (skipped mid-drag — the drag moves them live) */
	function rebuildHandles(): void {
		if (!modelGroup) return;
		if (!handleGroup) {
			handleGroup = new THREE.Group();
			modelGroup.add(handleGroup);
		}
		for (const c of [...handleGroup.children]) {
			handleGroup.remove(c);
		}
		hoveredHandle = null;
		if (!guideHandles) {
			redraw?.();
			return;
		}
		guideHandles.supports.forEach((s, i) => {
			const z = surfaceZAt(s.x, s.y) + 0.6;
			const ring = new THREE.Mesh(
				new THREE.TorusGeometry(s.radius, 0.35, 8, 40),
				new THREE.MeshBasicMaterial({ color: HANDLE_BLUE, depthTest: false })
			);
			ring.position.set(s.x, s.y, z);
			ring.renderOrder = 10;
			ring.userData.handle = { kind: 'support', index: i };
			// invisible disc = generous hit/hover area
			const hit = new THREE.Mesh(
				new THREE.CircleGeometry(Math.max(s.radius, 2.5), 24),
				new THREE.MeshBasicMaterial({ visible: false })
			);
			hit.position.set(s.x, s.y, z);
			hit.userData.handle = { kind: 'support', index: i };
			// red centre dot, original-style
			const dot = new THREE.Mesh(
				new THREE.SphereGeometry(0.6, 10, 10),
				new THREE.MeshBasicMaterial({ color: 0xd84a4a, depthTest: false })
			);
			dot.position.set(s.x, s.y, z);
			dot.renderOrder = 11;
			handleGroup!.add(ring, hit, dot);
		});
		if (guideHandles.label) {
			const l = guideHandles.label;
			const z = surfaceZAt(l.x, l.y) + 3;
			const sprite = makeLabelSprite(l.text, l.height);
			sprite.position.set(l.x, l.y, z);
			sprite.renderOrder = 12;
			sprite.userData.handle = { kind: 'label', index: 0 };
			handleGroup.add(sprite);
		}
		redraw?.();
	}

	$effect(() => {
		// re-key on content; mid-drag rebuilds are skipped (drag moves meshes directly)
		const key = guideHandles
			? JSON.stringify([guideHandles.supports, guideHandles.label])
			: null;
		void key;
		if (draggingHandle) return;
		rebuildHandles();
	});

	function pickHandle(e: PointerEvent | WheelEvent): { kind: 'support' | 'label'; index: number } | null {
		if (!handleGroup || !cameraRef || !guideHandles) return null;
		const el = (e.currentTarget ?? e.target) as HTMLElement;
		const rect = el.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1
		);
		const ray = new THREE.Raycaster();
		ray.setFromCamera(ndc, cameraRef);
		const hits = ray.intersectObjects(handleGroup.children, false);
		for (const h of hits) {
			const hd = h.object.userData.handle;
			if (hd) return hd as { kind: 'support' | 'label'; index: number };
		}
		return null;
	}

	/** drag target: model surface point (volume-local), plane fallback off-mesh */
	function dragPoint(e: PointerEvent): { x: number; y: number } | null {
		if (!cameraRef || !modelGroup) return null;
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1
		);
		const ray = new THREE.Raycaster();
		ray.setFromCamera(ndc, cameraRef);
		const meshes = [...modelMeshes.values()].filter((m) => m.geometry && m.visible);
		const hits = ray.intersectObjects(meshes, false);
		if (hits.length) {
			const vl = modelGroup.worldToLocal(hits[0].point.clone());
			return { x: vl.x, y: vl.y };
		}
		// fallback: horizontal plane through the volume middle
		const planePoint = modelGroup.localToWorld(new THREE.Vector3(0, 0, volHalfExtent.z));
		const planeNormal = modelGroup
			.localToWorld(new THREE.Vector3(0, 0, 1))
			.sub(modelGroup.localToWorld(new THREE.Vector3(0, 0, 0)))
			.normalize();
		const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
		const pt = new THREE.Vector3();
		if (!ray.ray.intersectPlane(plane, pt)) return null;
		const vl = modelGroup.worldToLocal(pt);
		return { x: vl.x, y: vl.y };
	}

	function setHandleHover(h: { kind: 'support' | 'label'; index: number } | null): void {
		if (!handleGroup) return;
		hoveredHandle = h;
		for (const c of handleGroup.children) {
			const hd = c.userData.handle as { kind: string; index: number } | undefined;
			if (!hd || !(c instanceof THREE.Mesh) || !(c.material instanceof THREE.MeshBasicMaterial))
				continue;
			if (c.material.visible === false) continue; // hit discs
			if (c.geometry instanceof THREE.TorusGeometry || c.geometry.type === 'TorusGeometry') {
				const active = h && h.kind === hd.kind && h.index === hd.index;
				c.material.color.set(active ? HANDLE_HOVER : HANDLE_BLUE);
			}
		}
		redraw?.();
	}

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
			// PLY vertex colors (PLYLoader exposes them as a 'color' attribute):
			// render them instead of the uniform model tint
			const hasVertexColors = geometry.hasAttribute('color');
			const mesh = new THREE.Mesh(
				geometry,
				new THREE.MeshStandardMaterial({
					roughness: 0.65,
					metalness: 0.05,
					vertexColors: hasVertexColors
				})
			);
			mesh.matrixAutoUpdate = false;
			mesh.userData.modelId = id;
			mesh.userData.hasVertexColors = hasVertexColors;
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
			// vertex-colored scans keep their own colors (white base = no tint)
			if (!mesh.userData.hasVertexColors) mesh.material.color.set(m.color);
			mesh.material.transparent = m.opacity < 1;
			mesh.material.opacity = m.opacity;
			// per-model look: metallic sheen or triangle wireframe (guide visualization)
			mesh.material.wireframe = m.shading === 'wireframe';
			mesh.material.metalness = m.shading === 'metallic' ? 0.85 : 0.05;
			mesh.material.roughness = m.shading === 'metallic' ? 0.25 : 0.65;
			const arr = m.transform ?? new THREE.Matrix4().identity().toArray();
			mesh.matrix.fromArray(arr);
			mesh.matrixWorldNeedsUpdate = true;
		}
		// remove deleted models
		for (const [id, mesh] of modelMeshes) {
			if (!seen.has(id)) {
				modelGroup.remove(mesh);
				mesh.geometry?.dispose();
				if (mesh.material instanceof THREE.Material) mesh.material.dispose();
				modelMeshes.delete(id);
			}
		}
		applyMeshClipping();
		redraw?.();
	}

	$effect(() => {
		void ps.models.map((m) => [m.id, m.visible, m.color, m.opacity, m.transform, m.shading]);
		if (sceneReady) syncModels();
	});

	$effect(() => {
		const p = PRESETS.find((p) => p.name === preset);
		if (p && p.name !== 'MIP') threshold = p.threshold;
	});

	$effect(() => {
		// read reactive deps unconditionally so the effect re-runs once the scene is ready
		const th = threshold;
		const mip = preset === 'MIP' ? 1 : 0;
		void sceneReady;
		if (material) {
			material.uniforms.u_threshold.value = th;
			material.uniforms.u_mip.value = mip;
			redraw?.();
		}
	});

	// update clip plane uniforms from viewer state
	$effect(() => {
		const wantAxial = clipAxial || forceClipAxial;
		const wantCross = clipCross;
		const cursorZ = ps.cursor.z;
		const c = ps.curve;
		const crossU = ps.crossU;
		void sceneReady;
		if (!material) return;
		const ex = volHalfExtent.x;
		const ey = volHalfExtent.y;
		const ez = volHalfExtent.z;
		// horizontal cut: keep volume below the axial slice plane
		const zmm = cursorZ * ps.ds.spacing_z - ez;
		material.uniforms.u_clipZ.value = wantAxial ? zmm : 1e6;
		// vertical cut: keep the lingual side of the cross-section plane
		let cn = { x: 0, y: 0 };
		let cd = 1e6;
		if (wantCross && c) {
			const i = Math.max(0, Math.min(c.points.length - 1, Math.round((crossU / c.length) * (c.points.length - 1))));
			const t = c.tangents[i];
			cn = { x: t.x, y: t.y };
			cd = (c.points[i].x - ex) * t.x + (c.points[i].y - ey) * t.y;
		}
		material.uniforms.u_clipN.value.set(cn.x, cn.y);
		material.uniforms.u_clipD.value = wantCross ? cd : 1e6;

		// matching clip planes for surface meshes (volume-local → world via the group transform)
		meshClipPlanes = [];
		if (groupRef) {
			groupRef.updateMatrixWorld(true);
			if (wantAxial) {
				meshClipPlanes.push(
					new THREE.Plane(new THREE.Vector3(0, 0, -1), zmm).applyMatrix4(groupRef.matrixWorld)
				);
			}
			if (wantCross && cd < 1e5) {
				meshClipPlanes.push(
					new THREE.Plane(new THREE.Vector3(-cn.x, -cn.y, 0), cd).applyMatrix4(groupRef.matrixWorld)
				);
			}
		}
		applyMeshClipping();
		redraw?.();
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
		uniform float u_clipZ;         // discard samples with z > u_clipZ (1e6 = off)
		uniform vec2 u_clipN;          // vertical cut plane normal (xy)
		uniform float u_clipD;         // discard samples with dot(p.xy, n) > d (1e6 = off)

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
			if (p.z > u_clipZ) return 0.0;
			if (dot(p.xy, u_clipN) > u_clipD) return 0.0;
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
				previewVol = { data, cols, rows, slices };

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
						u_camPos: { value: new THREE.Vector3() },
						u_clipZ: { value: 1e6 },
						u_clipN: { value: new THREE.Vector2(0, 0) },
						u_clipD: { value: 1e6 }
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
				groupRef = group;

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

				renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
				renderer.localClippingEnabled = true;
				renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
				stereoEffect = new AnaglyphEffect(renderer);
				container.appendChild(renderer.domElement);

				const maxExt = Math.max(ex, ey, ez);
				camera.position.set(0, maxExt * 1.2, maxExt * 2.6);
				camera.lookAt(0, 0, 0);
				cameraRef = camera;
				viewDistance = maxExt * 2.8;

				controls = new OrbitControls(camera, renderer.domElement);
				controls.enableDamping = true;
				controls.dampingFactor = 0.12;
				controlsRef = controls;

				// guide-design handles: hover highlight, drag on the surface, wheel resize
				renderer.domElement.addEventListener('pointermove', (e) => {
					if (!guideHandles) return;
					if (draggingHandle) {
						const p = dragPoint(e);
						if (p) {
							// move the handle meshes live (state rebuild waits for drag end)
							for (const c of handleGroup?.children ?? []) {
								const hd = c.userData.handle as { kind: string; index: number } | undefined;
								if (hd && hd.kind === draggingHandle.kind && hd.index === draggingHandle.index) {
									c.position.x = p.x;
									c.position.y = p.y;
								}
							}
							redraw?.();
							onHandleMove?.(draggingHandle.kind, draggingHandle.index, p.x, p.y);
						}
						return;
					}
					const h = pickHandle(e);
					if (
						(h?.kind ?? null) !== (hoveredHandle?.kind ?? null) ||
						(h?.index ?? -1) !== (hoveredHandle?.index ?? -1)
					) {
						setHandleHover(h);
					}
					renderer!.domElement.style.cursor = h ? 'grab' : '';
				});
				renderer.domElement.addEventListener(
					'wheel',
					(e) => {
						if (!guideHandles) return;
						const h = draggingHandle ?? pickHandle(e);
						if (!h) return;
						e.preventDefault();
						e.stopImmediatePropagation(); // keep OrbitControls from zooming
						onHandleResize?.(h.kind, h.index, e.deltaY < 0 ? 0.5 : -0.5);
					},
					{ capture: true, passive: false }
				);
				renderer.domElement.addEventListener('pointerup', () => {
					if (draggingHandle) {
						draggingHandle = null;
						if (controls) controls.enabled = true;
						onHandleDone?.();
						rebuildHandles();
					}
				});

				// click-on-model raycast (click = pointer travel < 5px)
				let downPos: { x: number; y: number } | null = null;
				renderer.domElement.addEventListener('pointerdown', (e) => {
					if (guideHandles && e.button === 0) {
						const h = pickHandle(e);
						if (h) {
							draggingHandle = h;
							setHandleHover(h);
							if (controls) controls.enabled = false;
							e.preventDefault();
							return;
						}
					}
					downPos = { x: e.clientX, y: e.clientY };
				});
				renderer.domElement.addEventListener('pointerup', (e) => {
					if (!downPos || (!onMeshClick && !onVolumeClick) || !renderer || !modelGroup) return;
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
					const meshes = onMeshClick
						? [...modelMeshes.values()].filter((m) => m.geometry && m.visible)
						: [];
					const hits = ray.intersectObjects(meshes, false);
					if (!hits.length) {
						// nothing solid under the cursor — march the volume render instead
						if (onVolumeClick) {
							const p = marchVolume(ndc);
							if (p) onVolumeClick(p);
						}
						return;
					}
					if (!onMeshClick) return;
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
					if (stereo && stereoEffect) stereoEffect.render(scene, camera);
					else renderer.render(scene, camera);

					// orientation indicator: which anatomical side faces the camera
					const p = camera.position;
					const el = Math.asin(p.y / (p.length() || 1));
					const az = Math.atan2(p.x, p.z);
					let dir: string;
					if (el > 1.05) dir = 'Superior';
					else if (el < -1.05) dir = 'Inferior';
					else {
						const deg = ((az * 180) / Math.PI + 360) % 360;
						dir = deg < 45 || deg >= 315 ? 'Anterior' : deg < 135 ? 'Left' : deg < 225 ? 'Posterior' : 'Right';
					}
					const festive = new Date().getMonth() === 11 ? '🦌 ' : '';
					viewDir = `${festive}${dir}`;
				};
				redraw = draw;

				controls.addEventListener('change', draw);

				const resize = () => {
					if (!container || !renderer) return;
					const w = container.clientWidth;
					const h = container.clientHeight;
					if (w === 0 || h === 0) return;
					renderer.setSize(w, h);
					stereoEffect?.setSize(w, h);
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
	{#if viewDir}
		<div class="view-dir">{viewDir}</div>
	{/if}
	<div class="vol-controls">
		<button
			class="clip-btn"
			class:clip-on={clipAxial}
			title="Horizontal cut at the axial slice"
			onclick={() => (clipAxial = !clipAxial)}>⬓</button
		>
		<button
			class="clip-btn"
			class:clip-on={clipCross}
			title="Vertical cut at the cross-section"
			onclick={() => (clipCross = !clipCross)}>◧</button
		>
		<button
			class="clip-btn"
			class:clip-on={stereo}
			title="Red/cyan stereo 3D (anaglyph glasses)"
			onclick={() => {
				stereo = !stereo;
				redraw?.();
			}}>👓</button
		>
		<select
			value=""
			title="Camera perspective"
			onchange={(e) => {
				setPerspective(e.currentTarget.value);
				e.currentTarget.value = '';
			}}
		>
			<option value="" disabled>View…</option>
			<option value="anterior">Anterior</option>
			<option value="posterior">Posterior</option>
			<option value="left">Left</option>
			<option value="right">Right</option>
			<option value="superior">Superior</option>
			<option value="inferior">Inferior</option>
		</select>
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
		z-index: 1;
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
		z-index: 3;
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
	.clip-btn {
		width: 24px;
		height: 22px;
		border-radius: 3px;
		border: 1px solid var(--border);
		background: var(--bg-2);
		color: var(--text-dim);
		font-size: 12px;
	}
	.clip-on {
		color: var(--accent-bright);
		border-color: var(--accent);
	}
	.view-dir {
		position: absolute;
		bottom: 6px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-dim);
		pointer-events: none;
		z-index: 2;
	}
</style>
