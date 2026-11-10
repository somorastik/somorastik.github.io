// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;

module.exports = defineConfig({
  // Where the tests live, and how long a single test may take.
  testDir: './tests',
  timeout: 30_000,

  // Run test files in parallel; each test still gets its own fresh browser context.
  fullyParallel: true,
  // On CI, fail the build if someone left a `test.only` in the code.
  forbidOnly: !!process.env.CI,
  // Retry flaky tests on CI only, so local failures show up straight away.
  retries: process.env.CI ? 2 : 0,
  // Use fewer workers on CI's small machines.
  workers: process.env.CI ? 2 : undefined,

  // A list in the terminal, plus an HTML report (playwright-report/) you can open with `npm run report`.
  reporter: [['list'], ['html', { open: 'never' }]],

  // Settings shared by every test.
  use: {
    // page.goto('/') resolves against this.
    baseURL: `http://localhost:${PORT}/`,
    // Record a trace when a test fails and is retried: open it with `npx playwright show-trace`.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // The same tests run in three browser engines and on a phone-sized screen.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  // Start the app before the tests and stop it afterwards.
  webServer: {
    command: 'node serve.js',
    url: `http://localhost:${PORT}/`,
    env: { PORT: String(PORT) },
    // Locally, reuse a server you already started with `npm start`.
    reuseExistingServer: !process.env.CI,
  },
});
