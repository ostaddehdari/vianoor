import { test, expect } from '@playwright/test';

test('installed release, cache policy, role dropdown and protected workspace', async ({
  page,
}, info) => {
  const base = process.env.USERS_RELEASE_URL;
  test.skip(!base, 'Set USERS_RELEASE_URL to the installed site including its base path.');
  const version = await page.request.get(`${base}/api/version`);
  expect(version.status()).toBe(200);
  expect(await version.json()).toEqual({ version: 'V6.0.1', stage: 6 });
  expect(version.headers()['cache-control']).toContain('no-store');
  const home = await page.goto(`${base}/fa`);
  expect(home?.headers()['cache-control']).toContain('no-store');
  await expect(page.locator('.release-badge')).toHaveText('V6.0.1');
  await page.goto(`${base}/fa/preview/admin`);
  if (info.project.name === 'mobile') await page.locator('.workspace-heading button').click();
  await expect(page.locator('.sidebar nav a[href$="/preview/admin/users"]')).toBeVisible();
  await page.locator('.workspace-switch select').selectOption('expert');
  await expect(page).toHaveURL(/\/fa\/preview\/expert$/);
  if (info.project.name === 'mobile') await page.locator('.workspace-heading button').click();
  await expect(page.locator('.sidebar nav a[href$="/preview/expert/availability"]')).toBeVisible();
  await expect(page.locator('.sidebar nav a[href$="/preview/account/wallet"]')).toHaveCount(0);
  if (info.project.name === 'mobile') await page.locator('.sidebar-brand button').click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await page.screenshot({ path: `.cache/live-release-${info.project.name}.png`, fullPage: true });
  await page.goto(`${base}/fa/admin/users`);
  await expect(page.locator('.user-loading a[href$="/fa/auth/login"]')).toBeVisible();
});
