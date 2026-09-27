import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/scholars-ui',
  timeout: 420000,
  expect: { timeout: 60000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.cache/scholars-browser-results',
  use: {
    baseURL: 'http://127.0.0.1:18886',
    actionTimeout: 60000,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
