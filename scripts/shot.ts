/**
 * UI screenshot helper:
 *   bun run scripts/shot.ts <url> <outfile> [clickText ...]
 * Clicks each button containing the given text (in order), waits, screenshots.
 */
import { chromium } from 'playwright';
import { ensureLoggedIn } from './pwlogin';

const [url, out, ...clicks] = process.argv.slice(2);
if (!url || !out) {
	console.error('usage: bun run scripts/shot.ts <url> <outfile> [clickText ...]');
	process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (msg) => {
	if (msg.type() === 'error') console.error('[console.error]', msg.text());
});
page.on('pageerror', (err) => console.error('[pageerror]', err.message));

await page.goto(url, { waitUntil: 'networkidle' });
await ensureLoggedIn(page);
if (!page.url().startsWith(url)) await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

for (const text of clicks) {
	await page.getByRole('button', { name: text }).first().click();
	await page.waitForTimeout(1200);
}

await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
