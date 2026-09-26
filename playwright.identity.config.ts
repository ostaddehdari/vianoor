import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/identity-ui',
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:15400', trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 }, browserName: 'chromium' } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        browserName: 'chromium',
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
