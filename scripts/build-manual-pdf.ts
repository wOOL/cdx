/**
 * Build docs/manual/coDiagnostiX-Web-Manual.pdf from the chapter markdown.
 *
 * Renders a standalone, light-themed print document (NOT the dark in-app /manual
 * route) so the PDF is clean in every viewer — the app theme's dark paint tree
 * otherwise leaks dark page fills into Chromium's page.pdf() output. App
 * screenshots stay dark (they are pictures of the dark-mode UI); only the
 * document chrome is light. Run: `bun run scripts/build-manual-pdf.ts`
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdown } from '../src/lib/server/markdown';

const DIR = join(import.meta.dir, '..', 'docs', 'manual');
const files = readdirSync(DIR)
	.filter((f) => /^\d{2}-.*\.md$/.test(f))
	.sort();

const chapters = files
	.map((f, i) => {
		const md = readFileSync(join(DIR, f), 'utf-8');
		// keep img/foo.png relative — the build HTML lives in docs/manual/
		const html = renderMarkdown(md);
		return `<section class="chapter"${i === 0 ? ' data-first' : ''}>${html}</section>`;
	})
	.join('\n');

const doc = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, system-ui, sans-serif; color: #1c1c1c;
         font-size: 10.5pt; line-height: 1.5; background: #fff; margin: 0; }
  .chapter { break-before: page; }
  .chapter[data-first] { break-before: avoid; }
  h1 { font-size: 21pt; color: #14506b; border-bottom: 2px solid #14506b;
       padding-bottom: 6px; margin: 0 0 16px; }
  h2 { font-size: 15pt; color: #14506b; margin: 22px 0 8px; }
  h3 { font-size: 12pt; color: #1c6a8c; margin: 16px 0 6px; }
  h4 { font-size: 11pt; color: #333; }
  p, li { orphans: 3; widows: 3; }
  a { color: #14506b; text-decoration: none; }
  strong { color: #111; }
  em { color: #333; }
  blockquote { background: #f4f6f8; border-left: 3px solid #d98c24; color: #1c1c1c;
               margin: 12px 0; padding: 8px 14px; border-radius: 0 4px 4px 0; break-inside: avoid; }
  blockquote p { margin: 4px 0; }
  code { background: #eef1f4; color: #b03a00; border: 1px solid #d4dae0;
         border-radius: 3px; padding: 0 4px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 9.5pt; }
  pre { background: #f4f6f8; border: 1px solid #d4dae0; border-radius: 4px;
        padding: 10px 14px; overflow-x: auto; break-inside: avoid; }
  pre code { background: none; border: none; color: #1c1c1c; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 9.5pt; break-inside: avoid; }
  th, td { border: 1px solid #c5ccd3; padding: 5px 9px; text-align: left; vertical-align: top; }
  th { background: #e7ebef; color: #111; }
  img { max-width: 100%; height: auto; border: 1px solid #c5ccd3; border-radius: 4px;
        margin: 10px 0; display: block; break-inside: avoid; }
  hr { border: none; border-top: 1px solid #d4dae0; margin: 16px 0; }
  ul, ol { padding-left: 22px; }
</style></head>
<body>${chapters}</body></html>`;

const buildPath = join(DIR, '.manual-build.html');
writeFileSync(buildPath, doc);

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	await page.goto(`file://${buildPath}`, { waitUntil: 'networkidle' });
	await page.pdf({
		path: join(DIR, 'coDiagnostiX-Web-Manual.pdf'),
		format: 'A4',
		printBackground: true,
		displayHeaderFooter: true,
		headerTemplate: '<div></div>',
		footerTemplate:
			'<div style="width:100%;font-size:8px;color:#888;text-align:center">coDiagnostiX Web — User Manual · page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
		margin: { top: '16mm', bottom: '14mm', left: '14mm', right: '14mm' }
	});
	console.log(`built ${join(DIR, 'coDiagnostiX-Web-Manual.pdf')}`);
} finally {
	rmSync(buildPath, { force: true });
	await browser.close();
}
