import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { roles } from '../../packages/ui/src/catalog';
const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
for (const locale of ['fa', 'en'] as const) {
  test(`${locale}: home, fonts, links and accessibility`, async ({ page }, info) => {
    await page.goto(`${prefix}/${locale}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await page.evaluate(() => document.fonts.ready);
    if (locale === 'fa')
      expect(await page.evaluate(() => document.fonts.check('16px Vazir'))).toBeTruthy();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`home-${locale}-${info.project.name}.png`),
      fullPage: true,
    });
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
    const broken = await page
      .locator('a[href^="/"]')
      .evaluateAll(
        (links, prefix) =>
          links
            .map((e) => e.getAttribute('href')!)
            .filter((h) => !h.startsWith(`${prefix}/fa`) && !h.startsWith(`${prefix}/en`)),
        prefix,
      );
    expect(broken).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Enter');
    if (info.project.name === 'mobile') {
      await page
        .getByRole('button', { name: locale === 'fa' ? 'فهرست' : 'Menu', exact: true })
        .click();
      await expect(page.locator('#mobile-navigation')).toBeVisible();
    }
  });
  for (const role of roles) {
    test(`${locale}: ${role.id} responsive dashboard`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${prefix}/${locale}/preview/${role.id}`);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBeTruthy();
      await expect(page.locator('h1')).toBeVisible();
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        })),
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`${role.id}-${locale}-${info.project.name}.png`),
        fullPage: true,
      });
      await page.locator('.segmented button').last().click();
      await expect(page.locator('.segmented button').last()).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.locator('.record .icon-button').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.record .icon-button').first()).toBeFocused();
      await page.locator('.record-filters input').fill('zzzz-no-match');
      await expect(page.locator('.record-list .empty-state')).toBeVisible();
      await page.locator('.record-list .empty-state button').click();
      await expect(page.locator('.record')).toHaveCount(3);
      if (info.project.name === 'mobile') {
        await page.locator('.workspace-heading button').click();
        await expect(page.locator('.sidebar.open')).toBeVisible();
        await page.locator('.sidebar-brand button').click();
        await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
      }
      expect(errors).toEqual([]);
    });
  }
  test(`${locale}: directory filter and language preservation`, async ({ page }) => {
    await page.goto(`${prefix}/${locale}/experts`);
    await page.locator('.filter-bar select').selectOption('family');
    await expect(page.locator('.expert-card')).toHaveCount(1);
    await page.locator('.filter-bar input').fill('zz-no-match');
    await expect(page.locator('.empty-state')).toBeVisible();
    await page.locator('.empty-state button').click();
    await expect(page.locator('.expert-card')).toHaveCount(3);
    await page.locator('.header-actions .language').click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/${locale === 'fa' ? 'en' : 'fa'}/experts$`));
  });
}
test('unknown route is a real 404', async ({ page }) => {
  const r = await page.goto(`${prefix}/fa/not-a-real-page`);
  expect(r?.status()).toBe(404);
});

test('small phone and tablet layouts stay within the viewport', async ({ page }) => {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ['fa', 'en'])
      for (const route of ['', '/preview/account', '/preview/finance']) {
        await page.goto(`${prefix}/${locale}${route}`);
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${locale}${route} at ${width}px`,
        ).toBeTruthy();
      }
  }
});
