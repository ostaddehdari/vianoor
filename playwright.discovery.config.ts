import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/discovery-ui',
  timeout: 300000,
  expect: { timeout: 30000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.cache/discovery-browser-results',
  use: {
    baseURL: 'http://127.0.0.1:18886',
    actionTimeout: 45000,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1365, height: 900 } } },
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
