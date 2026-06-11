import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

/**
 * AGPL-3.0 §13 corresponding-source offer for the embedded Chili3D build.
 * The embedded application is Chili3D pinned at release 0.6.1 plus one
 * bridge patch; both are fully reproducible from the links below.
 */
export const GET: RequestHandler = async () => {
	let patch = '';
	try {
		patch = readFileSync(join(process.cwd(), 'patches', 'chili3d-bridge.patch'), 'utf-8');
	} catch {
		patch = '(patch file not present on this deployment — see the repository)';
	}
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Embedded CAD — corresponding source</title>
<style>body{font-family:system-ui;max-width:840px;margin:40px auto;padding:0 16px;background:#1a1e25;color:#d8dce4}
a{color:#45b8e0}pre{background:#12151a;border:1px solid #3a4150;padding:12px;overflow-x:auto;font-size:12px}</style>
</head><body>
<h1>Corresponding source — embedded CAD workstation</h1>
<p>The CAD workstation embedded at <code>/cad</code> is
<strong>Chili3D</strong>, © its authors, licensed under the
<a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</a>.
This deployment runs the upstream release <strong>0.6.1</strong> with one modification
(a host-integration bridge and removal of the upstream analytics snippet).</p>
<ul>
<li>Upstream source (pinned release): <a href="https://github.com/xiangechen/chili3d/tree/0.6.1">github.com/xiangechen/chili3d @ 0.6.1</a></li>
<li>Upstream license: <a href="https://github.com/xiangechen/chili3d/blob/0.6.1/LICENSE">LICENSE (AGPL-3.0)</a></li>
<li>Host repository: the <code>vendor/chili3d</code> submodule plus <code>patches/chili3d-bridge.patch</code> reproduce this exact build (<code>bun run build:cad</code>).</li>
</ul>
<h2>Modification (chili3d-bridge.patch, AGPL-3.0)</h2>
<pre>${esc(patch)}</pre>
</body></html>`;
	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
