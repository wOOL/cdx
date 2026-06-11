/**
 * Stage-3 evidence screenshots: implant toolbar (color/lock/fine), fine-position
 * panel, plan-copy dialog, settings view prefs.
 *   bun run scripts/shot-stage3.ts
 */
import { chromium } from 'playwright';
import { ensureLoggedIn } from './pwlogin';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180_000);

async function skipTour() {
	const skip = page.getByRole('button', { name: 'Skip tour' });
	if (await skip.isVisible().catch(() => false)) await skip.click();
}

await page.goto(`${BASE}/cases/2?plan=3`, { waitUntil: 'domcontentloaded' });
await ensureLoggedIn(page);
if (!page.url().includes('/cases/2')) {
	await page.goto(`${BASE}/cases/2?plan=3`, { waitUntil: 'domcontentloaded' });
}
await page.waitForTimeout(4000);
await skipTour();

// implant stage, select an implant via the tree
await page.getByRole('button', { name: 'Implants', exact: true }).first().click();
await page.waitForTimeout(2500);
const implantGroup = page.locator('.tree-group', { hasText: 'Implants' });
const treeImplant = implantGroup.locator('.tree-item').first();
if (await treeImplant.isVisible().catch(() => false)) {
	await treeImplant.click();
	await page.waitForTimeout(1000);
}
// show tooth-number tags in the views
const toothCb = page.locator('label:has-text("Tooth numbers on implants") input');
if (await toothCb.isVisible().catch(() => false)) await toothCb.check();

// open the fine-position panel if the button is there
const fineBtn = page.getByRole('button', { name: 'Fine…' });
if (await fineBtn.isVisible().catch(() => false)) {
	await fineBtn.click();
	await page.waitForTimeout(800);
}
await page.screenshot({ path: 'docs/video-coverage/img/yt-implant-toolbar.png' });
console.log('saved yt-implant-toolbar.png');

// plan copy dialog
const planBtn = page.getByRole('button', { name: /^Plan\b|Plan ▾|Plans/ }).first();
if (await planBtn.isVisible().catch(() => false)) {
	await planBtn.click();
	await page.waitForTimeout(600);
	const dup = page.getByRole('button', { name: /Duplicate|Copy plan/ }).first();
	if (await dup.isVisible().catch(() => false)) {
		await dup.click();
		await page.waitForTimeout(800);
		await page.screenshot({ path: 'docs/video-coverage/img/yt-plan-copy.png' });
		console.log('saved yt-plan-copy.png');
		const cancel = page.getByRole('button', { name: 'Cancel' }).first();
		if (await cancel.isVisible().catch(() => false)) await cancel.click();
	} else {
		await page.keyboard.press('Escape');
	}
}

// settings views tab
await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const viewsTab = page.getByRole('button', { name: 'Views' }).first();
if (await viewsTab.isVisible().catch(() => false)) {
	await viewsTab.click();
	await page.waitForTimeout(600);
}
await page.screenshot({ path: 'docs/video-coverage/img/yt-settings-views.png' });
console.log('saved yt-settings-views.png');

await browser.close();
