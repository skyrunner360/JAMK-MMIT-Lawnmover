import { test, expect } from '@playwright/test';
for (const viewport of [
	{ width: 1440, height: 1050 },
	{ width: 390, height: 844 }
]) {
	test(`property and engineer workflows at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'A better view of every mow.' })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Zone \d+,/ })).toHaveCount(60);
		await page.getByRole('button', { name: /^Zone 60,/ }).click();
		await expect(page.getByRole('button', { name: /^Zone 60,/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(page.getByText('Dashboard connected', { exact: true })).toBeVisible({
			timeout: 15000
		});
		await page.getByRole('button', { name: 'Start new mowing cycle', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Complete cycle', exact: true })).toBeEnabled();
		const start = page.getByRole('button', { name: 'Start simulation', exact: true });
		if (await start.isVisible()) await start.click();
		await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeEnabled();
		await page.getByRole('button', { name: 'Engineer', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Fleet health', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
		await expect(page.locator('.session-link').first()).toBeVisible({ timeout: 15000 });
		await page.locator('.session-link').first().click();
		await expect(page.getByRole('heading', { name: 'Session details', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeEnabled();
		await page.getByLabel('Chart sample window').selectOption('30');
		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
		expect((await download).suggestedFilename()).toBe('mower-telemetry.csv');
		await page.getByRole('button', { name: 'Seasonal trends', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'A season in perspective' })).toBeVisible();
		await expect(page.locator('.season-chart')).toBeVisible();
		await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
		await expect(start).toBeVisible();
		await page.reload();
		await expect(page.getByText('Dashboard connected', { exact: true })).toBeVisible();
		await expect(start).toBeVisible();
		expect((await (await page.request.get('/api/simulator')).json()).data.running).toBe(false);
		await page.getByRole('button', { name: 'Start new mowing cycle', exact: true }).click();
		await expect(page.getByText('Cycle active', { exact: true })).toBeVisible();
		await start.click();
		await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		expect(errors).toEqual([]);
		await page.screenshot({ path: `/tmp/fleet-dashboard-${viewport.width}.png`, fullPage: true });
	});
}

test('trend response retains its requested dates when controls change', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Engineer', exact: true }).click();
	await expect(page.locator('.machine-card').first()).toBeVisible();
	await page.route('**/api/trends?**', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.fulfill({
			json: {
				data: [
					{
						day: '2026-01-01',
						sample_count: 1,
						motor_current_mean: 2,
						anomaly_rate: 0,
						temperature_max: 30
					}
				]
			}
		});
	});
	await page.getByRole('button', { name: 'Seasonal trends', exact: true }).click();
	await expect(page.locator('.season-chart')).toBeVisible();
	await page.getByLabel('From', { exact: true }).fill('2026-01-01');
	await page.getByLabel('To', { exact: true }).fill('2026-01-02');
	await page.getByRole('button', { name: 'Load trends', exact: true }).click();
	await page.getByLabel('From', { exact: true }).fill('2026-02-01');
	await page.getByLabel('To', { exact: true }).fill('2026-02-02');
	await expect(page.locator('.season-chart')).toBeVisible();
	await expect(page.locator('.season-axis')).toContainText('2026-01-01');
	await expect(page.locator('.season-axis')).toContainText('2026-01-02');
});

test('completed cycle cannot be resumed by the demo', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByText('Dashboard connected', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Start new mowing cycle', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Complete cycle', exact: true })).toBeEnabled();
	if (await page.getByRole('button', { name: 'Start simulation', exact: true }).isVisible())
		await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Pause simulation', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Complete cycle', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Start simulation', exact: true })).toBeVisible();
	const result = await page.request.post('/api/simulator', { data: { action: 'start' } });
	expect(result.status()).toBe(409);
	await page.getByRole('button', { name: 'Start new mowing cycle', exact: true }).click();
	await expect(page.getByText('Cycle active', { exact: true })).toBeVisible();
});

test('buffered telemetry shows capture time and becomes disconnected when polling fails', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: /^Zone \d+,/ })).toHaveCount(60);
	const fleet = await (await page.request.get('/api/fleet')).json();
	const captured = '2026-01-01T10:00:00.000Z';
	const received = new Date().toISOString();
	const machine = {
		...fleet.machines[0],
		last_received_at: received,
		last_observed_at: captured,
		connected: true,
		fresh: false
	};
	await page.route('**/api/fleet?**', (route) =>
		route.fulfill({ json: { ...fleet, machines: [machine] } })
	);
	await page.getByRole('button', { name: 'Engineer', exact: true }).click();
	await expect(page.locator('.machine-card').first()).toContainText(
		'Last captured 01/01/2026, 10:00:00 UTC',
		{ timeout: 10000 }
	);
	await expect(page.locator('.machine-card').first()).toContainText('Receiving');
	await expect(page.locator('.machine-card').first()).toContainText('Stale');
	await expect(page.locator('.machine-card').first()).toContainText('Last received');
	await page.route('**/api/fleet?**', (route) => route.abort());
	await page.clock.install();
	await page.clock.fastForward(70000);
	await expect(page.locator('.machine-card').first()).toContainText('Disconnected');
	await expect(page.locator('.machine-card').first()).toContainText(
		'Last captured 01/01/2026, 10:00:00 UTC'
	);
});
