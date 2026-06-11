/** E2E: voxel segmentation editor — init from threshold, brush, build model. */
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

await page.getByRole('button', { name: 'Align' }).first().click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Edit segmentation' }).click();
await page.waitForTimeout(400);

// init mask from teeth threshold (1500 HU)
await page.locator('.stage-tools input[type=number]').first().fill('1500');
await page.getByRole('button', { name: 'Init ≥' }).click();
await page.waitForTimeout(1500);

// brush a stroke on the axial view (2nd cell in align grid)
const axial = page.locator('.view-grid .view').nth(1).locator('canvas').first();
const box = await axial.boundingBox();
if (!box) throw new Error('axial canvas missing');
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/segedit-painted.png' });

// build model from mask
await page.getByRole('button', { name: 'Build 3D model' }).click();
await page.waitForTimeout(4000);
const treeHasCustom = await page.getByText('Custom segmentation').first().isVisible().catch(() => false);
console.log('custom segmentation in tree:', treeHasCustom);
await page.screenshot({ path: '/tmp/segedit-model.png' });

console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(treeHasCustom ? 0 : 1);
