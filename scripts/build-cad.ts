/**
 * Build the vendored chili3d CAD application and stage the result for serving
 * at /cad-app/. Run via `bun run build:cad`.
 *
 * NOTE: vendor/chili3d is no longer pristine upstream — it is a maintained fork.
 * The coDiagnostiX bridge (cdx-* postMessage protocol, render-mesh STL import,
 * telemetry removal) and the dental restoration layer are committed directly
 * into the vendored tree. The former patches/chili3d-bridge.patch has been
 * retired; its changes now live in source. (Still AGPL-3.0, like chili3d.)
 */
import { $ } from 'bun';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const VENDOR = join(ROOT, 'vendor', 'chili3d');
const OUT = join(ROOT, 'static', 'cad-app');

if (!existsSync(join(VENDOR, 'package.json'))) {
	console.error('vendor/chili3d is missing — the vendored CAD source should be part of this repository checkout');
	process.exit(1);
}

// Sanity guard: the bridge must be present in the vendored source. It lives in
// the tree directly now (no patch step); a missing marker means the working
// tree was clobbered or checked out wrong, so fail loudly before building.
const MARKER = 'cdx-cad-ready';
const entry = await Bun.file(join(VENDOR, 'packages', 'chili-web', 'src', 'index.ts')).text();
if (!entry.includes(MARKER)) {
	console.error('bridge marker missing from vendored entry — vendor/chili3d source is not the coDiagnostiX fork');
	process.exit(1);
}

if (!existsSync(join(VENDOR, 'node_modules'))) {
	console.log('installing chili3d dependencies…');
	await $`bun install --cwd ${VENDOR}`;
	// chili3d's simple-git-hooks postinstall walks up to the enclosing .git —
	// since vendoring, that is the HOST repository. Remove any hook it planted
	// (it would run npx lint-staged, which doesn't exist in a bun-only setup).
	const hook = join(ROOT, '.git', 'hooks', 'pre-commit');
	if (existsSync(hook)) {
		const body = await Bun.file(hook).text();
		if (body.includes('SIMPLE_GIT_HOOKS')) {
			rmSync(hook);
			console.log('removed foreign pre-commit hook (simple-git-hooks)');
		}
	}
}

console.log('building chili3d (rspack)…');
await $`bun run --cwd ${VENDOR} build`;

// verify the bridge made it into the build output before staging
const distFiles = (await $`grep -rl ${'cdx-cad-ready'} ${join(VENDOR, 'dist')}`.nothrow().quiet()).exitCode;
if (distFiles !== 0) {
	console.error('bridge marker missing from the build output — refusing to stage a stock build');
	process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
cpSync(join(VENDOR, 'dist'), OUT, { recursive: true });
console.log(`staged to static/cad-app`);
