/**
 * Stage-3 evidence: Mesh Editor (new tools incl. Subtract/view types) and the
 * Create-merged-model dialog. Uses case 2 (models: Bone segmentation + guide).
 *   bun run scripts/shot-stage3b.ts
 */
import { chromium } from 'playwright';
import { ensureLoggedIn } from './pwlogin';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(30_000);

await page.goto(`${BASE}/cases/2?plan=3`, { waitUntil: 'domcontentloaded' });
await ensureLoggedIn(page);
if (!page.url().includes('/cases/2')) {
	await page.goto(`${BASE}/cases/2?plan=3`, { waitUntil: 'domcontentloaded' });
}
await page.waitForTimeout(10000);
for (let i = 0; i < 3; i++) {
	const skip = page.getByRole('button', { name: 'Skip tour' });
	if (await skip.isVisible().catch(() => false)) {
		await skip.click().catch(() => {});
		break;
	}
	await page.waitForTimeout(2000);
}

// merge-models dialog from the tree
const mergeBtn = page.locator('button[title^="Create a merged model"]');
if (await mergeBtn.isVisible().catch(() => false)) {
	try {
	await mergeBtn.click({ timeout: 20000 });
	await page.waitForTimeout(800);
	await page.screenshot({ path: 'docs/video-coverage/img/yt-merge-models.png' });
	console.log('saved yt-merge-models.png');
	await page.getByRole('button', { name: 'Cancel' }).first().click({ timeout: 10000 }).catch(() => {});
	} catch (e) { console.log('merge shot failed:', String(e).slice(0, 120)); }
}

// open the Mesh Editor on the Bone model via the tree (expand model props first)
const boneRow = page.locator('.tree-item button.tree-label-btn', { hasText: 'Bone (300 HU)' }).first();
await boneRow.click({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(600);
const editMesh = page.locator('button[title="Open this model in the Mesh Editor"]').first();
if (await editMesh.isVisible().catch(() => false)) {
	await editMesh.click();
	await page.waitForTimeout(12000); // mesh load + first render can be slow on software GL
	await page.screenshot({ path: 'docs/video-coverage/img/yt-mesh-editor-tools.png' });
	console.log('saved yt-mesh-editor-tools.png');
	// open the Combine tool to show Merge/Subtract modes
	const combine = page.getByRole('button', { name: 'Combine' }).first();
	if (await combine.isVisible().catch(() => false)) {
		await combine.click();
		await page.waitForTimeout(1500);
		await page.screenshot({ path: 'docs/video-coverage/img/yt-mesh-subtract.png' });
		console.log('saved yt-mesh-subtract.png');
	}
}
await browser.close();
