import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/vianoor/en/auth/login');
  await page.locator('input[name=email]').fill(account.email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(account.password);
  await page.locator('button.auth-submit').click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.locator('.workspace-switch')).toBeVisible();
}
test('real calendar editing, client hold and confirmation, reschedule and cancellation in both layouts', async ({
  page,
  browser,
}, info) => {
  const fixture = JSON.parse(readFileSync('.cache/scheduling-browser.json', 'utf8'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await login(page, fixture.expert);
  await page.locator('.workspace-switch').selectOption('expert|platform');
  await page.getByRole('link', { name: 'Working calendar', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Working calendar', exact: true })).toBeVisible();
  const calendar = page.locator('.triple-calendar');
  await expect(calendar).toHaveAttribute('data-primary-calendar', 'gregory');
  await calendar
    .getByRole('combobox', { name: 'Primary calendar', exact: true })
    .selectOption('islamic-umalqura');
  await expect(calendar).toHaveAttribute('data-primary-calendar', 'islamic-umalqura');
  await calendar.getByRole('button', { name: 'Next month', exact: true }).click();
  await calendar.getByRole('button', { name: 'Go to today', exact: true }).click();
  await page.getByLabel('Buffer after (minutes)', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.goto('/vianoor/fa/expert/calendar');
  await expect(page.getByRole('heading', { name: 'تقویم کاری', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ذخیره', exact: true })).toBeVisible();
  await expect(calendar).toHaveAttribute('data-primary-calendar', 'persian');
  await expect(calendar.locator('.triple-calendar-secondary').first().locator('small')).toHaveCount(
    2,
  );
  const keyboardDay = calendar.locator('.triple-calendar-days button[tabindex="0"]');
  const beforeKeyboard = await keyboardDay.getAttribute('data-date');
  await keyboardDay.focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.locator(':focus').getAttribute('data-date')).not.toBe(beforeKeyboard);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  const axe = await new AxeBuilder({ page })
    .include('.schedule-workspace')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await page.screenshot({ path: info.outputPath('calendar-fa.png'), fullPage: true });
  await calendar.screenshot({ path: info.outputPath('three-calendar-fa.png') });
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:18886',
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
  });
  context.setDefaultTimeout(60000);
  const client = await context.newPage();
  client.on('pageerror', (e) => errors.push(e.name));
  await login(client, fixture.admin);
  await client.goto(
    '/vianoor/en/account/book?expert=' + fixture.expertCode + '&service=' + fixture.serviceId,
  );
  await expect(client.getByRole('combobox', { name: 'Expert', exact: true })).toHaveValue(
    fixture.expertCode,
  );
  await expect(client.getByRole('combobox', { name: 'Service', exact: true })).toHaveValue(
    fixture.serviceId,
  );
  const date = new Date(fixture.date + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + 1);
  await client
    .getByLabel('Date (Gregorian)', { exact: true })
    .fill(date.toISOString().slice(0, 10));
  await client.locator(`.triple-calendar [data-date="${date.toISOString().slice(0, 10)}"]`).click();
  await client.getByRole('button', { name: 'Find available times', exact: true }).click();
  const response = client.waitForResponse(
    (r) => r.url().endsWith('/api/users/bookings/scheduled') && r.request().method() === 'POST',
  );
  await client.locator('.schedule-slots button').first().click();
  const hold = await (await response).json();
  expect(hold.data.status).toBe('HELD');
  const id = hold.data.id;
  await expect(
    client.getByRole('heading', { name: 'Temporarily held', exact: true }),
  ).toBeVisible();
  await client.getByRole('button', { name: 'Confirm free booking', exact: true }).click();
  await expect(client.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
  await client.screenshot({ path: info.outputPath('confirmed-booking.png'), fullPage: true });
  await client.goto('/vianoor/en/account/bookings');
  const row = client.locator(`[data-booking-id="${id}"]`);
  await expect(row).toContainText('Confirmed');
  await client.locator('.triple-calendar .triple-calendar-today').click();
  await expect(row).toHaveCount(0);
  await client.getByRole('button', { name: 'Show all dates', exact: true }).click();
  await expect(row).toContainText('Confirmed');
  await row.getByRole('button', { name: 'Reschedule', exact: true }).click();
  date.setUTCDate(date.getUTCDate() + 1);
  await client
    .getByLabel('Date (Gregorian)', { exact: true })
    .fill(date.toISOString().slice(0, 10));
  await client.getByRole('button', { name: 'Find available times', exact: true }).click();
  await client.locator('.schedule-slots button').first().click();
  await expect(row).toContainText('Rescheduled');
  await row.getByRole('button', { name: 'Cancel booking', exact: true }).click();
  await expect(row).toContainText('Cancelled');
  await client.goto('/vianoor/fa/account/bookings');
  await expect(client.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    client.getByRole('heading', { name: 'رزروها و تقویم من', exact: true }),
  ).toBeVisible();
  expect(
    await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await client.screenshot({ path: info.outputPath('bookings-fa.png'), fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
