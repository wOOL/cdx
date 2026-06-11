import type { Page } from 'playwright';

export const DEV_EMAIL = 'cdx@surrey.ac';
export const DEV_PASSWORD = 'devpassword1';

/** If the page landed on /login, sign in with the dev account (register first if needed). */
export async function ensureLoggedIn(page: Page): Promise<void> {
	if (!page.url().includes('/login')) return;
	await page.fill('#email', DEV_EMAIL);
	await page.fill('#password', DEV_PASSWORD);
	await page.click('button[type=submit]');
	await page.waitForTimeout(1200);
	if (page.url().includes('/login')) {
		// account missing — register it
		await page.goto(page.url().replace(/\/login.*/, '/register'));
		await page.fill('#name', 'Dev Admin');
		await page.fill('#email', DEV_EMAIL);
		await page.fill('#password', DEV_PASSWORD);
		await page.click('button[type=submit]');
		await page.waitForTimeout(1200);
	}
}
