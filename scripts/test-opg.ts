/** Verify OPG (ray-sum) pano mode + axial mirror + dblclick implant placement. */
import { chromium } from 'playwright';
import { ensureLoggedIn } from './pwlogin';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:5173/cases/1', { waitUntil: 'networkidle' });
await ensureLoggedIn(page);
if (!page.url().includes('/cases/1')) {
	await page.goto('http://localhost:5173/cases/1', { waitUntil: 'networkidle' });
}
await page.waitForTimeout(3000);

// OPG mode on the pano view
await page.locator('.pano-view').hover();
await page.locator('.xray-btn').evaluate((el) => (el as HTMLElement).click());
await page.waitForTimeout(1500);

// mirror the axial view
await page.locator('.slice-view').first().hover();
await page.locator('.mirror-btn').evaluate((el) => (el as HTMLElement).click());
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/opg-mirror.png' });

// dblclick implant placement (implant stage)
await page.getByRole('button', { name: 'Implants' }).first().click();
await page.waitForTimeout(1200);
const axial = page.locator('.view-grid .view').nth(1).locator('canvas').first();
const box = await axial.boundingBox();
if (box) {
	await axial.dblclick({ position: { x: box.width * 0.62, y: box.height * 0.68 } });
	await page.waitForTimeout(600);
}
const dialogVisible = await page.getByRole('button', { name: 'Place implant' }).isVisible();
console.log('implant dialog opened by dblclick:', dialogVisible);
if (dialogVisible) await page.getByRole('button', { name: 'Cancel' }).click();

console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(dialogVisible ? 0 : 1);
