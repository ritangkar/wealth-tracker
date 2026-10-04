import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use a pre-installed Chromium only if one exists (e.g. the dev sandbox); on CI Playwright uses its own downloaded browser.
const preinstalled = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOptions = { executablePath: existsSync(preinstalled) ? preinstalled : undefined, args: ['--no-sandbox'] };
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', launchOptions, serviceWorkers: 'allow', trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: { command: 'node scripts/build-e2e.mjs && node scripts/serve-pages.mjs dist 4173 /wealth-tracker', url: 'http://localhost:4173/wealth-tracker/', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
