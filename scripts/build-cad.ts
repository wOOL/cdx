/**
 * Build the vendored chili3d CAD application (pinned release, see vendor/chili3d)
 * with the coDiagnostiX bridge patch applied, and stage the result for serving
 * at /cad-app/. Run via `bun run build:cad`; the patch keeps the submodule
 * pristine — modifications live in patches/chili3d-bridge.patch (AGPL-3.0,
 * like chili3d itself).
 */
import { $ } from 'bun';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const VENDOR = join(ROOT, 'vendor', 'chili3d');
const PATCH = join(ROOT, 'patches', 'chili3d-bridge.patch');
const OUT = join(ROOT, 'static', 'cad-app');

if (!existsSync(join(VENDOR, 'package.json'))) {
	console.error('vendor/chili3d is missing — the vendored CAD source should be part of this repository checkout');
	process.exit(1);
}

// Apply the bridge patch (idempotent: skip when already applied).
// IMPORTANT: run from the repo root with --directory. `git apply` resolves
// patch paths relative to the repository root and SILENTLY IGNORES paths
// outside the current directory — running it inside vendor/chili3d would
// exit 0 without changing anything now that the vendor tree is part of the
// host repository (it only worked before because the directory was its own
// submodule repo).
const APPLY = ['git', '-C', ROOT, 'apply', `--directory=vendor/chili3d`];
const check = await $`${APPLY} --check ${PATCH}`.nothrow().quiet();
if (check.exitCode === 0) {
	await $`${APPLY} ${PATCH}`;
	console.log('bridge patch applied');
} else {
	const reverse = await $`${APPLY} --reverse --check ${PATCH}`.nothrow().quiet();
	if (reverse.exitCode === 0) console.log('bridge patch already applied');
	else {
		console.error('patch neither applies nor is applied — vendor tree diverged');
		process.exit(1);
	}
}

// verify the patch is really in the source — a path-resolution no-op must fail loudly
const MARKER = 'cdx-cad-ready';
const entry = await Bun.file(join(VENDOR, 'packages', 'chili-web', 'src', 'index.ts')).text();
if (!entry.includes(MARKER)) {
	console.error('bridge marker missing from patched entry — patch application was a no-op');
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

// restore the vendored tree to pristine upstream state
await $`git -C ${VENDOR} checkout -- .`;
console.log('vendor tree restored to pristine');
