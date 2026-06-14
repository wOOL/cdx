import type { RequestHandler } from './$types';

/**
 * AGPL-3.0 §13 corresponding-source offer for the embedded Chili3D build.
 * The embedded application is a modified fork of Chili3D (baselined at upstream
 * release 0.6.1). The complete, buildable corresponding source — including all
 * coDiagnostiX modifications — is vendored in this repository at
 * vendor/chili3d and builds reproducibly via `bun run build:cad`.
 */
export const GET: RequestHandler = async () => {
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Embedded CAD — corresponding source</title>
<style>body{font-family:system-ui;max-width:840px;margin:40px auto;padding:0 16px;background:#1a1e25;color:#d8dce4}
a{color:#45b8e0}code{background:#12151a;padding:1px 4px;border-radius:3px}ul{line-height:1.7}</style>
</head><body>
<h1>Corresponding source — embedded CAD workstation</h1>
<p>The CAD workstation embedded at <code>/cad</code> is a modified fork of
<strong>Chili3D</strong>, © its authors, licensed under the
<a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</a>.
It is baselined at upstream release <strong>0.6.1</strong> and carries
coDiagnostiX modifications committed directly into the vendored source tree.</p>
<ul>
<li>Complete corresponding source (the modified fork, as built): vendored in this
repository at <code>vendor/chili3d</code>; it builds reproducibly with
<code>bun run build:cad</code> and no external fetch.</li>
<li>Upstream baseline (for comparison): <a href="https://github.com/xiangechen/chili3d/tree/0.6.1">github.com/xiangechen/chili3d @ 0.6.1</a></li>
<li>Upstream license: <a href="https://github.com/xiangechen/chili3d/blob/0.6.1/LICENSE">LICENSE (AGPL-3.0)</a></li>
</ul>
<h2>Summary of modifications</h2>
<ul>
<li>Same-origin <code>postMessage</code> host-integration bridge (the <code>cdx-*</code>
protocol) for loading meshes and exporting designs.</li>
<li>Binary-STL import as a render mesh (bypasses OCCT's per-triangle sewing, which
hangs on large organic scan meshes).</li>
<li>Removal of the upstream third-party analytics snippet.</li>
<li>A dental restoration design layer (mesh-based stations) built on top of the
upstream CAD shell.</li>
</ul>
<p>The exact, authoritative changes are the contents of <code>vendor/chili3d</code> in
this repository's source.</p>
</body></html>`;
	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
};
