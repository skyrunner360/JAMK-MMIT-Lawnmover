import { test, expect } from '@playwright/test';
for (const viewport of [
	{ width: 1440, height: 1050 },
	{ width: 390, height: 844 }
]) {
	test(`dashboard works without auth at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'A better view of every mow.' })).toBeVisible();
		await expect(page.getByText('Live connection', { exact: true })).toBeVisible({
			timeout: 15000
		});
		const start = page.getByRole('button', { name: 'Start simulation', exact: true });
		if (await start.isVisible()) await start.click();
		await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeEnabled();
		await expect(page.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
		await page.getByLabel('Chart sample window').selectOption('30');
		await expect(page.getByLabel('Chart sample window')).toHaveValue('30');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export CSV' }).click();
		expect((await downloadPromise).suggestedFilename()).toBe('mower-telemetry.csv');
		await page.getByRole('button', { name: /^Zone 1,/ }).click();
		await expect(page.getByRole('button', { name: /^Zone 1,/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await page.getByLabel('Filter activity').selectOption('warnings');
		await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
		await expect(start).toBeVisible();
		await page.reload();
		await expect(page.getByText('Live connection', { exact: true })).toBeVisible();
		await expect(start).toBeVisible();
		expect((await (await page.request.get('/api/simulator')).json()).data.running).toBe(false);
		await start.click();
		await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeVisible();
		await page.locator('.session-link').first().click();
		await expect(page.getByText('Session details', { exact: true })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		expect(errors).toEqual([]);
		await page.screenshot({ path: `/tmp/mower-dashboard-${viewport.width}.png`, fullPage: true });
	});
}
