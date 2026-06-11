/** Verify view maximize/restore + 3D perspective preset. */
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

// maximize the panoramic view (pano stage, 3rd cell)
await page.locator('.view').nth(2).hover();
await page.locator('.view').nth(2).locator('.max-btn').evaluate((el) => (el as HTMLElement).click());
await page.waitForTimeout(800);
const visibleViews = await page.locator('.view:visible').count();
console.log('visible views while maximized:', visibleViews);
await page.screenshot({ path: '/tmp/maximized.png' });

// restore via Esc
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const restored = await page.locator('.view:visible').count();
console.log('visible views after Esc:', restored);

// 3D superior perspective
await page.locator('.volume-view').hover();
await page.locator('.vol-controls select').first().selectOption('superior');
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/superior.png' });

console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(visibleViews === 1 && restored > 1 ? 0 : 1);
