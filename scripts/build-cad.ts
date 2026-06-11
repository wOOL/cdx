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
	console.error('vendor/chili3d is missing — run: git submodule update --init');
	process.exit(1);
}

// apply the bridge patch (idempotent: skip when already applied)
const check = await $`git -C ${VENDOR} apply --check ${PATCH}`.nothrow().quiet();
if (check.exitCode === 0) {
	await $`git -C ${VENDOR} apply ${PATCH}`;
	console.log('bridge patch applied');
} else {
	const reverse = await $`git -C ${VENDOR} apply --reverse --check ${PATCH}`.nothrow().quiet();
	if (reverse.exitCode === 0) console.log('bridge patch already applied');
	else {
		console.error('patch neither applies nor is applied — vendor tree diverged');
		process.exit(1);
	}
}

if (!existsSync(join(VENDOR, 'node_modules'))) {
	console.log('installing chili3d dependencies…');
	await $`bun install --cwd ${VENDOR}`;
}

console.log('building chili3d (rspack)…');
await $`bun run --cwd ${VENDOR} build`;

rmSync(OUT, { recursive: true, force: true });
cpSync(join(VENDOR, 'dist'), OUT, { recursive: true });
console.log(`staged to static/cad-app`);

// restore the vendored tree to pristine upstream state
await $`git -C ${VENDOR} checkout -- .`;
console.log('vendor tree restored to pristine');
