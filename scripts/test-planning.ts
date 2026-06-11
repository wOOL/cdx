/**
 * Interactive smoke test: draw a nerve in the pano view, place an implant,
 * drag it in the cross view, screenshot each step.
 *   bun run scripts/test-planning.ts [caseUrl]
 */
import { chromium } from 'playwright';
import { ensureLoggedIn } from './pwlogin';

const url = process.argv[2] ?? 'http://localhost:5173/cases/1';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180_000); // patient under software-GL rendering on small hosts
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await ensureLoggedIn(page);
if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// ---- nerve stage ----
await page.getByRole('button', { name: 'Nerve' }).first().click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Add right nerve' }).click();
await page.waitForTimeout(800);

// pano view = 3rd view in the 2x2 grid
const pano = page.locator('.view-grid .view').nth(2).locator('canvas');
const pbox = await pano.boundingBox();
if (!pbox) throw new Error('pano canvas not found');

// click along the lower band (nerve canal area, z≈14-22mm of 64mm → lower third)
for (const [fx, fy] of [
	[0.3, 0.62],
	[0.38, 0.66],
	[0.46, 0.7],
	[0.54, 0.7],
	[0.62, 0.66],
	[0.7, 0.62]
]) {
	await pano.click({ position: { x: pbox.width * fx, y: pbox.height * fy } });
	await page.waitForTimeout(150);
}
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/nerve-drawn.png' });

// ---- implant stage ----
await page.getByRole('button', { name: 'Implants' }).first().click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Add implant' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Place implant' }).click();
await page.waitForTimeout(1000);

// drag implant downward in the cross view (4th view) to push it toward the nerve
const cross = page.locator('.view-grid .view').nth(3).locator('canvas');
const cbox = await cross.boundingBox();
if (cbox) {
	const cx = cbox.x + cbox.width / 2;
	const cy = cbox.y + cbox.height / 2;
	await page.mouse.move(cx, cy - 30);
	await page.mouse.down();
	await page.mouse.move(cx, cy + 40, { steps: 8 });
	await page.mouse.up();
}
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/implant-placed.png' });

console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
