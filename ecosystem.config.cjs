// pm2 deployment config for coDiagnostiX Web (production build, svelte-adapter-bun).
// Build first: `bun run build`  (produces build/index.js + static/cad-app).
// Start:       `bunx pm2 start ecosystem.config.cjs`
//
// The app needs the Bun runtime (bun:sqlite), so the interpreter is bun — not node.
// ORIGIN must match the URL the app is accessed by (CSRF for form POSTs / login);
// override it via the environment if you reach the server by a different host/domain.
// AI segmentation creds (CDX_AISEG_*) are NOT committed — if present in the
// environment when this config is evaluated they pass through, otherwise the app
// falls back to the local heuristic.

const { join } = require('node:path');

const aiseg = process.env.CDX_AISEG_EMAIL
	? {
			CDX_AISEG_URL: process.env.CDX_AISEG_URL || 'https://pbapi.becertain.ai',
			CDX_AISEG_EMAIL: process.env.CDX_AISEG_EMAIL,
			CDX_AISEG_PASSWORD: process.env.CDX_AISEG_PASSWORD
		}
	: {};

module.exports = {
	apps: [
		{
			name: 'codiagnostix',
			// Run the bun binary directly (interpreter: 'none') rather than letting
			// pm2 wrap the script in its Bun process-container — that wrapper sends a
			// spurious shutdown signal to the adapter under both fork and cluster mode.
			script: process.env.BUN_PATH || '/root/.bun/bin/bun',
			args: 'build/index.js',
			interpreter: 'none',
			exec_mode: 'fork',
			cwd: __dirname,
			instances: 1,
			autorestart: true,
			max_restarts: 10,
			env: {
				PORT: process.env.PORT || '8540',
				// accessed through the BunkerWeb reverse proxy at this domain (TLS
				// terminated there, forwarded as HTTP to 172.17.0.1:8540); ORIGIN must
				// match the browser-facing URL for SvelteKit's CSRF check on form POSTs
				ORIGIN: process.env.ORIGIN || 'https://cdx.surrey.ac',
				CDX_DATA_DIR: process.env.CDX_DATA_DIR || join(__dirname, 'data'),
				...aiseg
			}
		}
	]
};
