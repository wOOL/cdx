<script lang="ts">
	/**
	 * Minimal self-contained flat-shaded WebGL triangle-soup preview for the
	 * VPE dialog (no dependency on the main viewers). Orbit by drag, zoom by
	 * wheel. parts[0] is tinted as the base model, later parts as shells.
	 */
	let {
		positions,
		parts
	}: {
		positions: Float32Array;
		parts: { name: string; offset: number; count: number }[];
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();

	const BASE_COLOR = [0.73, 0.69, 0.62];
	const SHELL_COLORS = [
		[0.3, 0.64, 1.0],
		[0.49, 0.82, 0.54],
		[0.89, 0.76, 0.36],
		[0.83, 0.34, 0.42],
		[0.71, 0.42, 0.83],
		[0.27, 0.72, 0.63]
	];

	let gl: WebGLRenderingContext | null = null;
	let prog: WebGLProgram | null = null;
	let buf: WebGLBuffer | null = null;
	let vertCount = 0;
	let center = [0, 0, 0];
	let dist = 100;
	let yaw = 0.6;
	let pitch = 0.5;

	function compile(g: WebGLRenderingContext, type: number, src: string): WebGLShader {
		const sh = g.createShader(type)!;
		g.shaderSource(sh, src);
		g.compileShader(sh);
		return sh;
	}

	function init(c: HTMLCanvasElement): void {
		gl = c.getContext('webgl', { antialias: true });
		if (!gl) return;
		const vs = `attribute vec3 aPos, aNrm, aCol; uniform mat4 uMVP; uniform vec3 uEye;
			varying vec3 vCol;
			void main() {
				gl_Position = uMVP * vec4(aPos, 1.0);
				float d = abs(dot(normalize(aNrm), normalize(uEye - aPos)));
				vCol = aCol * (0.30 + 0.70 * d);
			}`;
		const fs = `precision mediump float; varying vec3 vCol;
			void main() { gl_FragColor = vec4(vCol, 1.0); }`;
		prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
		gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
		gl.linkProgram(prog);
		gl.enable(gl.DEPTH_TEST);
		buf = gl.createBuffer();
	}

	/** interleave pos(3) + flat normal(3) + part color(3) per vertex */
	function upload(): void {
		if (!gl || !buf) return;
		vertCount = Math.floor(positions.length / 9) * 3;
		const data = new Float32Array(vertCount * 9);
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
		let pi = 0;
		for (let t = 0; t < vertCount / 3; t++) {
			const i = t * 9;
			while (pi + 1 < parts.length && i >= parts[pi + 1].offset) pi++;
			const col = pi === 0 ? BASE_COLOR : SHELL_COLORS[(pi - 1) % SHELL_COLORS.length];
			const ux = positions[i + 3] - positions[i];
			const uy = positions[i + 4] - positions[i + 1];
			const uz = positions[i + 5] - positions[i + 2];
			const vx = positions[i + 6] - positions[i];
			const vy = positions[i + 7] - positions[i + 1];
			const vz = positions[i + 8] - positions[i + 2];
			let nx = uy * vz - uz * vy;
			let ny = uz * vx - ux * vz;
			let nz = ux * vy - uy * vx;
			const nl = Math.hypot(nx, ny, nz) || 1;
			nx /= nl; ny /= nl; nz /= nl;
			for (let v = 0; v < 3; v++) {
				const o = (t * 3 + v) * 9;
				const x = positions[i + v * 3];
				const y = positions[i + v * 3 + 1];
				const z = positions[i + v * 3 + 2];
				data[o] = x; data[o + 1] = y; data[o + 2] = z;
				data[o + 3] = nx; data[o + 4] = ny; data[o + 5] = nz;
				data[o + 6] = col[0]; data[o + 7] = col[1]; data[o + 8] = col[2];
				if (x < minX) minX = x; if (x > maxX) maxX = x;
				if (y < minY) minY = y; if (y > maxY) maxY = y;
				if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
			}
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		if (vertCount > 0) {
			center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
			dist = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1) * 1.8;
		}
	}

	function draw(): void {
		if (!gl || !prog || !canvas) return;
		const w = canvas.clientWidth, h = canvas.clientHeight;
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		gl.viewport(0, 0, w, h);
		gl.clearColor(0.09, 0.1, 0.12, 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		if (vertCount === 0) return;

		const cp = Math.cos(pitch), sp = Math.sin(pitch);
		const cy = Math.cos(yaw), sy = Math.sin(yaw);
		const eye = [
			center[0] + dist * cp * cy,
			center[1] + dist * cp * sy,
			center[2] + dist * sp
		];
		// look-at basis (z up-ish)
		let fx = center[0] - eye[0], fy = center[1] - eye[1], fz = center[2] - eye[2];
		const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
		let rx = fy * 1 - fz * 0, ry = fz * 0 - fx * 1, rz = fx * 0 - fy * 0; // f × (0,0,1)
		const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
		const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
		const near = dist / 100, far = dist * 10, f = 1 / Math.tan(0.4);
		const a = w / Math.max(h, 1);
		const tx = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
		const ty = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
		const tz = fx * eye[0] + fy * eye[1] + fz * eye[2];
		// column-major projection * view (clip w = dot(f, p − eye), positive in front)
		const k1 = (far + near) / (near - far), k2 = (2 * far * near) / (near - far);
		const mvp = [
			(f / a) * rx, f * ux, k1 * -fx, fx,
			(f / a) * ry, f * uy, k1 * -fy, fy,
			(f / a) * rz, f * uz, k1 * -fz, fz,
			(f / a) * tx, f * ty, k1 * tz + k2, -tz
		];

		gl.useProgram(prog);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		const stride = 9 * 4;
		for (const [name, off] of [['aPos', 0], ['aNrm', 12], ['aCol', 24]] as const) {
			const loc = gl.getAttribLocation(prog, name);
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, stride, off);
		}
		gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
		gl.uniform3fv(gl.getUniformLocation(prog, 'uEye'), eye);
		gl.drawArrays(gl.TRIANGLES, 0, vertCount);
	}

	$effect(() => {
		if (canvas && !gl) init(canvas);
		void positions;
		upload();
		draw();
	});

	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	function onpointerdown(e: PointerEvent): void {
		dragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onpointermove(e: PointerEvent): void {
		if (!dragging) return;
		yaw -= (e.clientX - lastX) * 0.01;
		pitch = Math.max(-1.5, Math.min(1.5, pitch + (e.clientY - lastY) * 0.01));
		lastX = e.clientX;
		lastY = e.clientY;
		draw();
	}
	function onwheel(e: WheelEvent): void {
		e.preventDefault();
		dist *= e.deltaY > 0 ? 1.1 : 0.9;
		draw();
	}
</script>

<canvas
	bind:this={canvas}
	class="vpe-canvas"
	{onpointerdown}
	{onpointermove}
	onpointerup={() => (dragging = false)}
	{onwheel}
></canvas>

<style>
	.vpe-canvas {
		width: 100%;
		height: 100%;
		display: block;
		border-radius: 4px;
		cursor: grab;
		touch-action: none;
	}
	.vpe-canvas:active {
		cursor: grabbing;
	}
</style>
