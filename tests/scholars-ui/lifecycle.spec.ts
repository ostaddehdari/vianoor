import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
type Fixture = {
  admin: { email: string; password: string };
  expert: { email: string; password: string };
  scholarId: string;
  slug: string;
  fileId: string;
};
async function login(page: Page, account: Fixture['admin']) {
  await page.goto('/vianoor/en/auth/login');
  await page.locator('input[name=email]').fill(account.email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(account.password);
  await page.locator('button.auth-submit').click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.locator('.workspace-switch')).toBeVisible();
}
test('real expert and reviewer interfaces publish a service; Persian RTL and public profile stay responsive', async ({
  page,
  browser,
}, info) => {
  const fixture = JSON.parse(readFileSync('.cache/scholars-browser.json', 'utf8')) as Fixture;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await login(page, fixture.admin);
  await page.locator('.workspace-switch').selectOption('admin|platform');
  await page.getByRole('link', { name: 'Experts and applications', exact: true }).click();
  await page.getByLabel('Search name, email or public ID').fill(fixture.expert.email);
  await page.locator('form.user-toolbar').getByRole('button').click();
  await page.getByRole('button', { name: /Stage 8 Test Expert/ }).click();
  const finalReview = page.locator('.scholar-workspace > .scholar-review');
  if (await finalReview.getByRole('option', { name: 'Under review', exact: true }).count()) {
    await finalReview
      .getByLabel('Reason visible to the expert')
      .fill('Browser qualification review');
    await finalReview.getByRole('button', { name: 'Save review' }).click();
    await expect(finalReview.getByRole('option', { name: 'Approved', exact: true })).toHaveCount(1);
    await finalReview.getByLabel('Status', { exact: true }).selectOption('APPROVED');
    await finalReview
      .getByLabel('Reason visible to the expert')
      .fill('Browser verification complete');
    await finalReview.getByRole('button', { name: 'Save review' }).click();
  }
  await expect(page.locator('.scholar-summary .user-badge')).toHaveText('Approved');
  await page.getByRole('tab', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test degree', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('review-documents.png'), fullPage: true });
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:18886',
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
  });
  const expert = await context.newPage();
  expert.on('pageerror', (e) => errors.push(e.name));
  await login(expert, fixture.expert);
  await expect(expert.locator('.workspace-switch option[value="expert|platform"]')).toHaveCount(1);
  await expert.goto('/vianoor/en/account/professional');
  await expert.getByRole('tab', { name: 'Services and pricing', exact: true }).click();
  const title = 'Browser service ' + randomUUID().slice(0, 8);
  await expert.getByLabel('Title', { exact: true }).fill(title);
  await expert
    .getByLabel('Short description', { exact: true })
    .fill('Verified through the real browser');
  await expert.getByLabel('Integer amount (rial/toman; cents for USD/EUR)').fill('450000');
  await expert.getByLabel('Related specialty').selectOption({ index: 1 });
  await expert.getByRole('button', { name: 'Save', exact: true }).click();
  const service = expert
    .locator('article')
    .filter({ has: expert.getByRole('heading', { name: title, exact: true }) });
  await expect(service).toBeVisible();
  await service.getByRole('button', { name: 'Request publication', exact: true }).click();
  await expect(service).toContainText('Pending publication');
  await page.getByRole('tab', { name: 'Services and pricing', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const reviewService = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await reviewService
    .getByLabel('Reason visible to the expert')
    .fill('Browser publication approved');
  await reviewService.getByRole('button', { name: 'Save review' }).click();
  await expect(reviewService).toContainText('Published');
  await expert.goto('/vianoor/fa/account/professional');
  await expect(expert.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(expert.getByRole('heading', { name: 'پروفایل حرفه‌ای', exact: true })).toBeVisible();
  expect(
    await expert.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await expert.screenshot({ path: info.outputPath('professional-fa.png'), fullPage: true });
  const accessibility = await new AxeBuilder({ page: expert })
    .include('.scholar-workspace')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await expert.goto('/vianoor/en/experts/' + fixture.slug);
  await expect(expert.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(expert.getByText('PRIVATE-TEST-NUMBER')).toHaveCount(0);
  await expect(expert.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    new RegExp('/en/experts/' + fixture.slug + '$'),
  );
  expect(
    await expert.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await expert.screenshot({ path: info.outputPath('public-expert.png'), fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
