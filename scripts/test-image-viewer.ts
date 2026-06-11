/** Image viewer page: filmstrip, layout switching, pane loading. */
import { chromium } from 'playwright';
import { ensureLoggedIn } from './pwlogin';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:5173/patients/1/images', { waitUntil: 'networkidle' });
await ensureLoggedIn(page);
if (!page.url().includes('/patients/1/images')) {
	await page.goto('http://localhost:5173/patients/1/images', { waitUntil: 'networkidle' });
}
await page.waitForTimeout(1000);

let ok = true;

const thumbs = await page.locator('.film-thumb').count();
console.log('thumbnails:', thumbs);
if (thumbs < 1) {
	console.log('FAIL: expected at least 1 thumbnail');
	ok = false;
}

// switch to 4-pane layout
await page.click('button[data-layout="4"]');
await page.waitForTimeout(300);
const panes = await page.locator('.pane').count();
console.log('panes:', panes);
if (panes !== 4) {
	console.log('FAIL: expected 4 panes');
	ok = false;
}

// click a thumbnail → it loads into the active pane
await page.locator('.film-thumb').first().click();
await page.waitForTimeout(500);
const activeImgs = await page.locator('.pane.active img').count();
console.log('images in active pane:', activeImgs);
if (activeImgs < 1) {
	console.log('FAIL: thumbnail did not load into the active pane');
	ok = false;
}

await page.screenshot({ path: '/tmp/image-viewer.png' });
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(ok && errors.length === 0 ? 0 : 1);
