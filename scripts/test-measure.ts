/** Measure tool smoke test: distance between two points on the axial view. */
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
await page.waitForTimeout(2500);

// distance tool (ruler button in the View panel)
await page.locator('.measure-row .btn').first().click();
await page.waitForTimeout(300);

// axial view in pano stage = first grid view (area-ax)
const axial = page.locator('.view-grid .view').first().locator('canvas');
const box = await axial.boundingBox();
if (!box) throw new Error('axial canvas not found');
await axial.click({ position: { x: box.width * 0.35, y: box.height * 0.55 } });
await page.waitForTimeout(300);
await axial.click({ position: { x: box.width * 0.65, y: box.height * 0.55 } });
await page.waitForTimeout(1000);

await page.screenshot({ path: '/tmp/measure.png' });
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
