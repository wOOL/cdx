/**
 * CAD-bridge regression: boots the embedded Chili3D at /cad, loads a case
 * model through the postMessage bridge, exports the design back and verifies
 * the wax-up model row is created — then cleans up.
 *
 * Requires the dev server on :5173 and a built static/cad-app (bun run build:cad).
 */
import { chromium } from 'playwright';
import { Database } from 'bun:sqlite';
import { ensureLoggedIn } from './pwlogin';

const BASE = process.argv[2] ?? 'http://localhost:5173';
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failed++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let createdId: number | null = null;
try {
	await page.goto(`${BASE}/cad?case=2`);
	await ensureLoggedIn(page);
	await page.goto(`${BASE}/cad?case=2`);

	await page.locator('.status.ok', { hasText: 'CAD ready' }).waitFor({ timeout: 180000 });
	check('bridge handshake (cdx-cad-ready)', true);

	await page.locator('.model-row', { hasText: 'Bone' }).first().click();
	await page.locator('.status', { hasText: /Model loaded|Load failed/ }).waitFor({ timeout: 180000 });
	const loadStatus = await page.locator('.status').innerText();
	check('full-resolution model load (MeshNode path)', loadStatus.includes('Model loaded'), loadStatus);

	await page.locator('input#design-name').fill('cad-bridge-regression');
	await page.locator('button', { hasText: 'Attach CAD design to case' }).click();
	await page.locator('.status', { hasText: /Design attached|failed/ }).waitFor({ timeout: 180000 });
	const attachStatus = await page.locator('.status').innerText();
	check('design export + attach', attachStatus.includes('Design attached'), attachStatus);

	const db = new Database('data/codiagnostix.db');
	const row = db
		.query(`SELECT id, kind, file_path FROM models WHERE case_id = 2 AND name LIKE '%cad-bridge-regression%'`)
		.get() as { id: number; kind: string; file_path: string } | null;
	check('wax-up model row created', !!row && row.kind === 'waxup');
	if (row) {
		createdId = row.id;
		const f = Bun.file(`data/${row.file_path}`);
		check('design STL non-empty', (await f.exists()) && f.size > 84, `${f.size} bytes`);
	}

	const src = await page.evaluate(async () => (await fetch('/cad/source')).status);
	check('AGPL corresponding-source page', src === 200);
} finally {
	if (createdId) {
		await page.evaluate(async (id) => {
			await fetch(`/api/models/${id}`, { method: 'DELETE' });
		}, createdId);
	}
	await browser.close();
}

console.log(failed ? `${failed} checks FAILED` : 'All CAD-bridge checks passed');
process.exit(failed ? 1 : 0);
