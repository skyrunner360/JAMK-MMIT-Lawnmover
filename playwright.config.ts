import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.pw.ts',
	workers: 1,
	fullyParallel: false,
	use: {
		baseURL: process.env.MOWER_TEST_URL ?? 'http://localhost:5173',
		headless: true,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure'
	},
	reporter: 'list'
});
