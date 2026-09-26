import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/users-ui',
  timeout: 180000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.cache/users-browser-results',
  use: { baseURL: 'http://127.0.0.1:18876', trace: 'off', screenshot: 'only-on-failure' },
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
