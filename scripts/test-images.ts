/** Snapshot → image library flow. */
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

// snapshot the axial view (pano stage: first view)
const axial = page.locator('.slice-view').first();
await axial.hover();
await page.locator('.snap-btn').first().evaluate((el) => (el as HTMLElement).click());
await page.waitForTimeout(1500);

// check the library on the patient page
await page.goto('http://localhost:5173/?sel=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const count = await page.locator('.image-tile').count();
console.log('image tiles in library:', count);
await page.screenshot({ path: '/tmp/image-library.png' });
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(count > 0 ? 0 : 1);
