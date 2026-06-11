/** Verify 3D clip planes + plan compare dialog. */
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

// toggle the horizontal clip in the 3D view (hover first so controls appear)
await page.locator('.volume-view').hover();
await page.locator('.clip-btn').first().evaluate((el) => (el as HTMLElement).click());
await page.waitForTimeout(800);
const cls = await page.locator('.clip-btn').first().getAttribute('class');
console.log('clip button class after click:', cls);
await page.screenshot({ path: '/tmp/clip-on.png' });

// plan compare dialog
await page.locator('.plan-chip').click();
await page.waitForTimeout(300);
const compare = page.getByRole('button', { name: 'Compare plans…' });
if (await compare.count()) {
	await compare.click();
	await page.waitForTimeout(800);
	await page.screenshot({ path: '/tmp/compare.png' });
}

console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
