import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
if (process.env.FINANCE_TEST !== '1') throw Error('Explicit isolated finance test required');
const base = 'http://127.0.0.1:18886/vianoor';
const fixture = JSON.parse(
  readFileSync(
    process.env.FINANCE_BROWSER_FIXTURE ?? '.cache/stage11-browser-fixture.json',
    'utf8',
  ),
);
const output = '.cache/stage11-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(30000);
try {
  await page.goto(base + '/en/auth/login');
  await page.locator('input[name=email]').fill(fixture.admin.email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(fixture.admin.password);
  await page.locator('button.auth-submit').click();
  await page.waitForURL('**/en/account');
  await page.goto(base + '/en/admin/finance');
  const panel = page.locator('.finance-workspace');
  await panel.getByRole('heading', { name: 'Finance management', exact: true }).waitFor();
  await panel.locator('tbody tr').nth(2).waitFor();
  for (const input of await panel.locator('input[type=password]').all())
    assert.equal(await input.inputValue(), '');
  assert.equal(await panel.locator('input[type=password]').count(), 2);
  const axe = await new AxeBuilder({ page })
    .include('.finance-workspace')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  assert.deepEqual(
    axe.violations.map((v) => v.id),
    [],
  );
  await page.screenshot({ path: output + '/admin-gateways-en.png', fullPage: true });
  for (const name of [
    'Payments',
    'Accounting ledger',
    'Refund requests',
    'Withdrawals',
    'Disputes',
    'Fees and limits',
    'Exchange rates',
    'Risk signals',
    'Reconciliation',
    'Financial reports',
  ]) {
    const button = panel.locator('nav').getByRole('button', { name, exact: true });
    assert.equal(await button.count(), 1);
    {
      await button.click();
      await page.waitForTimeout(250);
    }
  }
  await page.goto(base + '/fa/admin/finance');
  await panel.getByRole('heading', { name: 'مدیریت مالی', exact: true }).waitFor();
  await panel.locator('tbody tr').nth(2).waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  await page.screenshot({ path: output + '/admin-gateways-fa.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/fa/account/wallet');
  await panel.locator('nav button').nth(2).waitFor();
  await panel.getByRole('heading', { name: 'پرداخت و کیف پول', exact: true }).waitFor();
  await panel.locator('tbody tr').first().waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    'Mobile horizontal overflow',
  );
  await page.screenshot({ path: output + '/wallet-mobile-fa.png', fullPage: true });
  await panel.locator('nav button').nth(1).click();
  await panel.locator('select[name=destination_id]').waitFor();
  await page.screenshot({ path: output + '/withdraw-mobile-fa.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS admin finance, masked credential fields, fa/en RTL/LTR, wallet and withdrawals on mobile, WCAG AA panel, zero JavaScript errors.',
  );
} catch (error) {
  console.log('Failed URL:', page.url());
  await page.screenshot({ path: output + '/failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
}
