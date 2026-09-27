import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
test('admin publishes a database translation and public locales render without a rebuild', async ({
  page,
}, info) => {
  const fixture = JSON.parse(readFileSync('.cache/stage10-browser-fixture.json', 'utf8'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await page.goto('/vianoor/en/auth/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name=email]').fill(fixture.admin.email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(fixture.admin.password);
  await page.locator('button.auth-submit').click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.goto('/vianoor/en/admin/localization');
  const panel = page.locator('.localization-manager');
  await expect(panel.getByRole('heading', { name: 'Languages and translations' })).toBeVisible();
  await expect(panel.locator('tbody tr')).toHaveCount(147);
  await panel.getByRole('button', { name: 'Page translations', exact: true }).click();
  await panel.getByRole('combobox').first().selectOption('fr');
  await panel.getByLabel('Filter', { exact: true }).fill('discoveryCopy.title');
  await panel.getByRole('button', { name: 'Filter', exact: true }).click();
  const row = panel.locator('tbody tr').filter({ hasText: 'discoveryCopy.title' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await panel.locator('form.scholar-form textarea').last().fill('Trouver un expert');
  await panel.getByRole('button', { name: 'Save draft', exact: true }).click();
  await row.getByRole('button', { name: 'Mark as reviewed', exact: true }).click();
  await row.getByRole('button', { name: 'Approve and publish', exact: true }).click();
  await expect(row).toContainText('APPROVED');
  const axe = await new AxeBuilder({ page })
    .include('.localization-manager')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  mkdirSync('.cache/stage10-evidence', { recursive: true });
  await page.screenshot({
    path: '.cache/stage10-evidence/admin-' + info.project.name + '.png',
    fullPage: true,
  });
  await page.goto('/vianoor/fr/experts');
  await expect(page.getByRole('heading', { name: 'Trouver un expert', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.goto('/vianoor/ar/experts');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.language-switcher option')).toHaveCount(147);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: '.cache/stage10-evidence/search-' + info.project.name + '.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
