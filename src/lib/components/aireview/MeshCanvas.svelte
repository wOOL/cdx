<script lang="ts">
	/**
	 * Minimal self-contained WebGL mesh canvas for the AI review wizard's
	 * "3D objects" step: flat-shaded triangle soups, orbit + zoom, per-mesh
	 * color/visibility/transform. Intentionally independent of the planning
	 * viewers (no three.js scene graph — one shader, one VBO pair per mesh).
	 */
	import type { WizardMesh } from './overlay';

	let {
		meshes,
		resetTick = 0,
		height = 340
	}: {
		meshes: WizardMesh[];
		resetTick?: number;
		height?: number;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let wrapW = $state(0);

	let gl: WebGLRenderingContext | null = null;
	let prog: WebGLProgram | null = null;
	let loc: {
		aPos: number;
		aNrm: number;
		uMvp: WebGLUniformLocation | null;
		uModel: WebGLUniformLocation | null;
		uColor: WebGLUniformLocation | null;
	} | null = null;
	const buffers = new Map<number, { pos: WebGLBuffer; nrm: WebGLBuffer; count: number }>();

	// orbit camera state
	let cam = $state({ yaw: 0, pitch: -0.25, dist: 0, cx: 0, cy: 0, cz: 0 });
	let fitted = false;
	let lastReset = -1;

	// ---------- tiny column-major mat4 helpers ----------
	function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
		const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
		const nf = 1 / (near - far);
		const m = new Float32Array(16);
		m[0] = f / aspect;
		m[5] = f;
		m[10] = (far + near) * nf;
		m[11] = -1;
		m[14] = 2 * far * near * nf;
		return m;
	}
	function lookAt(eye: number[], at: number[], up: number[]): Float32Array {
		const zx = eye[0] - at[0];
		const zy = eye[1] - at[1];
		const zz = eye[2] - at[2];
		let zl = Math.hypot(zx, zy, zz) || 1;
		const z = [zx / zl, zy / zl, zz / zl];
		const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
		const xl = Math.hypot(x[0], x[1], x[2]) || 1;
		x[0] /= xl;
		x[1] /= xl;
		x[2] /= xl;
		const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
		const m = new Float32Array(16);
		m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
		m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
		m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
		m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
		m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
		m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
		m[15] = 1;
		return m;
	}
	function mul4(a: Float32Array, b: Float32Array): Float32Array {
		const o = new Float32Array(16);
		for (let c = 0; c < 4; c++) {
			for (let r = 0; r < 4; r++) {
				let s = 0;
				for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
				o[c * 4 + r] = s;
			}
		}
		return o;
	}

	function hexToRgb(hex: string): [number, number, number] {
		const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
		if (!m) return [0.8, 0.8, 0.78];
		const v = parseInt(m[1], 16);
		return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
	}

	function flatNormals(p: Float32Array): Float32Array {
		const n = new Float32Array(p.length);
		for (let i = 0; i + 8 < p.length; i += 9) {
			const ux = p[i + 3] - p[i];
			const uy = p[i + 4] - p[i + 1];
			const uz = p[i + 5] - p[i + 2];
			const vx = p[i + 6] - p[i];
			const vy = p[i + 7] - p[i + 1];
			const vz = p[i + 8] - p[i + 2];
			let nx = uy * vz - uz * vy;
			let ny = uz * vx - ux * vz;
			let nz = ux * vy - uy * vx;
			const l = Math.hypot(nx, ny, nz) || 1;
			nx /= l;
			ny /= l;
			nz /= l;
			for (let v = 0; v < 3; v++) {
				n[i + v * 3] = nx;
				n[i + v * 3 + 1] = ny;
				n[i + v * 3 + 2] = nz;
			}
		}
		return n;
	}

	const VS = `
		attribute vec3 aPos;
		attribute vec3 aNrm;
		uniform mat4 uMvp;
		uniform mat4 uModel;
		varying vec3 vNrm;
		void main() {
			gl_Position = uMvp * uModel * vec4(aPos, 1.0);
			vNrm = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNrm;
		}`;
	const FS = `
		precision mediump float;
		uniform vec3 uColor;
		varying vec3 vNrm;
		void main() {
			vec3 n = normalize(vNrm);
			float d = abs(n.y) * 0.55 + abs(n.z) * 0.25 + abs(n.x) * 0.10;
			gl_FragColor = vec4(uColor * (0.30 + 0.70 * d), 1.0);
		}`;

	function initGl(): void {
		if (!canvas || gl) return;
		gl = canvas.getContext('webgl', { antialias: true });
		if (!gl) return;
		const compile = (type: number, src: string) => {
			const s = gl!.createShader(type)!;
			gl!.shaderSource(s, src);
			gl!.compileShader(s);
			return s;
		};
		prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
		gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
		gl.linkProgram(prog);
		loc = {
			aPos: gl.getAttribLocation(prog, 'aPos'),
			aNrm: gl.getAttribLocation(prog, 'aNrm'),
			uMvp: gl.getUniformLocation(prog, 'uMvp'),
			uModel: gl.getUniformLocation(prog, 'uModel'),
			uColor: gl.getUniformLocation(prog, 'uColor')
		};
		gl.enable(gl.DEPTH_TEST);
	}

	function fitView(): void {
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		let any = false;
		for (const m of meshes) {
			if (!m.positions) continue;
			const t = m.transform;
			const p = m.positions;
			const stride = Math.max(3, Math.floor(p.length / 3 / 4000) * 3);
			for (let i = 0; i + 2 < p.length; i += stride) {
				let x = p[i];
				let y = p[i + 1];
				let z = p[i + 2];
				if (t) {
					const tx = t[0] * x + t[4] * y + t[8] * z + t[12];
					const ty = t[1] * x + t[5] * y + t[9] * z + t[13];
					const tz = t[2] * x + t[6] * y + t[10] * z + t[14];
					x = tx;
					y = ty;
					z = tz;
				}
				if (x < min[0]) min[0] = x;
				if (y < min[1]) min[1] = y;
				if (z < min[2]) min[2] = z;
				if (x > max[0]) max[0] = x;
				if (y > max[1]) max[1] = y;
				if (z > max[2]) max[2] = z;
				any = true;
			}
		}
		if (!any) return;
		const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 100;
		cam = {
			yaw: 0,
			pitch: -0.25,
			dist: diag * 1.6,
			cx: (min[0] + max[0]) / 2,
			cy: (min[1] + max[1]) / 2,
			cz: (min[2] + max[2]) / 2
		};
		fitted = true;
	}

	function draw(): void {
		if (!canvas || !gl || !prog || !loc) return;
		const cw = canvas.width;
		const ch = canvas.height;
		gl.viewport(0, 0, cw, ch);
		gl.clearColor(0.07, 0.085, 0.11, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		if (!fitted || cam.dist === 0) return;

		// orbit: anterior view (camera towards -y), z up, yaw about z
		const cy = Math.cos(cam.yaw);
		const sy = Math.sin(cam.yaw);
		const cp = Math.cos(cam.pitch);
		const sp = Math.sin(cam.pitch);
		const eye = [
			cam.cx + cam.dist * cp * sy,
			cam.cy - cam.dist * cp * cy,
			cam.cz + cam.dist * sp
		];
		const view = lookAt(eye, [cam.cx, cam.cy, cam.cz], [0, 0, 1]);
		const proj = perspective(35, cw / Math.max(1, ch), cam.dist * 0.01, cam.dist * 10);
		const mvp = mul4(proj, view);

		gl.useProgram(prog);
		gl.uniformMatrix4fv(loc.uMvp, false, mvp);
		const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

		for (const m of meshes) {
			if (!m.visible || !m.positions || m.positions.length < 9) continue;
			let buf = buffers.get(m.id);
			if (!buf) {
				const pos = gl.createBuffer()!;
				gl.bindBuffer(gl.ARRAY_BUFFER, pos);
				gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
				const nrm = gl.createBuffer()!;
				gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
				gl.bufferData(gl.ARRAY_BUFFER, flatNormals(m.positions), gl.STATIC_DRAW);
				buf = { pos, nrm, count: m.positions.length / 3 };
				buffers.set(m.id, buf);
			}
			gl.uniformMatrix4fv(loc.uModel, false, m.transform ? new Float32Array(m.transform) : ident);
			gl.uniform3fv(loc.uColor, hexToRgb(m.color));
			gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
			gl.enableVertexAttribArray(loc.aPos);
			gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, buf.nrm);
			gl.enableVertexAttribArray(loc.aNrm);
			gl.vertexAttribPointer(loc.aNrm, 3, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.TRIANGLES, 0, buf.count);
		}
	}

	$effect(() => {
		// track: size, reset, camera and per-mesh visible/positions/transform
		void wrapW;
		void cam.yaw;
		void cam.pitch;
		void cam.dist;
		let loadedCount = 0;
		for (const m of meshes) {
			void m.visible;
			void m.transform;
			if (m.positions) loadedCount++;
		}
		if (!canvas) return;
		canvas.width = Math.max(50, Math.floor(wrapW));
		canvas.height = height;
		initGl();
		if ((resetTick !== lastReset || !fitted) && loadedCount > 0) {
			lastReset = resetTick;
			fitView();
		}
		draw();
	});

	let drag: { x: number; y: number } | null = null;
	function down(e: PointerEvent): void {
		drag = { x: e.clientX, y: e.clientY };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent): void {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		drag = { x: e.clientX, y: e.clientY };
		cam.yaw += dx * 0.008;
		cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch - dy * 0.008));
	}
	function up(): void {
		drag = null;
	}
	function wheel(e: WheelEvent): void {
		e.preventDefault();
		cam.dist = Math.max(10, Math.min(3000, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
	}
</script>

<div class="mc-wrap" bind:clientWidth={wrapW} style="height:{height}px">
	<canvas
		bind:this={canvas}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onwheel={wheel}
	></canvas>
</div>

<style>
	.mc-wrap {
		position: relative;
		width: 100%;
		background: #11161c;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		overflow: hidden;
	}
	canvas {
		display: block;
		touch-action: none;
		cursor: grab;
	}
	canvas:active {
		cursor: grabbing;
	}
</style>
