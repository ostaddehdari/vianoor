import { defineConfig } from '@playwright/test';
const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export default defineConfig({
  testDir: './tests/ui',
  timeout: 45000,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:15400',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
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
  webServer: {
    command: 'node node_modules/next/dist/bin/next start apps/web -H 127.0.0.1 -p 15400',
    url: `http://127.0.0.1:15400${prefix}/fa`,
    reuseExistingServer: false,
    timeout: 60000,
  },
});
