import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
for (const locale of ['fa', 'en']) {
  for (const action of [
    'login',
    'register',
    'forgot-password',
    'verify-email',
    'reset-password',
    'resend-verification',
  ]) {
    test(`${locale} ${action} accessible responsive identity form`, async ({ page }, info) => {
      await page.goto(`${prefix}/${locale}/auth/${action}`);
      await expect(page.locator('h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`auth-${action}-${locale}.png`),
        fullPage: true,
      });
      if (action === 'register') {
        await page.locator('input[name=email]').fill('sample@example.test');
        await page.locator('input[name=password]').fill('A valid long passphrase');
        await page.locator('input[name=confirm]').fill('Different long passphrase');
        await page.locator('button[type=submit]').click();
        await expect(page.locator('.auth-card [role=alert]')).not.toBeEmpty();
      }
      if (action === 'login') {
        await page.locator('input[name=email]').fill('sample@example.test');
        await page.locator('input[name=password]').fill('A valid long passphrase');
        await page.locator('button[type=submit]').click();
        // This workflow deliberately has no backend: show the honest configuration state.
        await expect(page.locator('.auth-card [role=alert]')).not.toBeEmpty();
      }
    });
  }
}
