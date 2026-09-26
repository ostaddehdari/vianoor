import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
const fixture = () =>
  JSON.parse(readFileSync('.cache/users-browser-fixture.json', 'utf8')) as {
    admin: { email: string; password: string };
  };
async function login(page: Page, email: string, password: string) {
  await page.goto('/vianoor/en/auth/login');
  await page.locator('input[name=email]').fill(email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(password);
  await page.locator('button.auth-submit').click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.locator('.workspace-switch')).toBeVisible();
}
test('real invitation, profile wizard, avatar upload, form builder, role switching, revocation and responsive access', async ({
  page,
  browser,
}, testInfo) => {
  const admin = fixture().admin;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.name));
  await login(page, admin.email, admin.password);
  await page.locator('.workspace-switch').selectOption('admin|platform');
  await expect(page).toHaveURL(/\/en\/admin$/);
  await page.goto('/vianoor/en/admin/users');
  const email = `qa-browser-${randomUUID().slice(0, 8)}@example.test`;
  const password = 'Browser test only passphrase 2026!';
  await page.locator('.invite-user input[type=email]').fill(email);
  await page.getByRole('button', { name: 'Add and invite user', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Invitation queued.');
  let token = '';
  for (let i = 0; i < 60 && !token; i++) {
    const list = await page.request
      .get('http://127.0.0.1:18877/api/v1/messages')
      .then((r) => r.json());
    for (const message of list.messages ?? []) {
      if (!message.To?.some((to: { Address: string }) => to.Address === email)) continue;
      const detail = await page.request
        .get('http://127.0.0.1:18877/api/v1/message/' + message.ID)
        .then((r) => r.json());
      token = detail.Text?.match(/reset-password#token=([A-Za-z0-9_-]{43})/)?.[1] ?? '';
    }
    if (!token) await new Promise((r) => setTimeout(r, 300));
  }
  expect(Boolean(token)).toBeTruthy();
  const clientContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:18876',
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile ?? false,
    hasTouch: testInfo.project.use.hasTouch ?? false,
  });
  const client = await clientContext.newPage();
  client.on('pageerror', (e) => errors.push(e.name));
  await client.goto('http://127.0.0.1:18876/vianoor/en/auth/reset-password#token=' + token);
  await client.locator('input[name=password]').fill(password);
  await client.locator('input[name=confirm]').fill(password);
  await client.locator('button.auth-submit').click();
  await expect(client.locator('.auth-message.success')).toBeVisible();
  await login(client, email, password);
  await client.goto('http://127.0.0.1:18876/vianoor/en/account/profile');
  await client
    .getByLabel('Display name', { exact: true })
    .fill('Browser QA ' + testInfo.project.name);
  await expect(client.locator('.avatar-choices button')).toHaveCount(5);
  await client.getByRole('button', { name: 'Account image 4', exact: true }).click();
  await client.locator('#field-language').selectOption('en');
  await client.getByRole('button', { name: /Preferences/ }).click();
  await client.locator('#field-timezone').fill('Europe/London');
  await client
    .getByLabel('I agree to profile data storage and sharing the marked fields with site members.')
    .check();
  await client.getByRole('button', { name: 'Complete profile', exact: true }).click();
  await expect(client.getByRole('status')).toHaveText('Changes saved.');
  await client.reload();
  await expect(client.getByLabel('Display name', { exact: true })).toHaveValue(
    'Browser QA ' + testInfo.project.name,
  );
  await expect(
    client.getByRole('button', { name: 'Account image 4', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const buffer = await sharp({
    create: { width: 90, height: 90, channels: 3, background: '#386850' },
  })
    .png()
    .toBuffer();
  await client
    .locator('#avatar-upload')
    .setInputFiles({ name: 'qa-avatar.png', mimeType: 'image/png', buffer });
  await expect(client.locator('.profile-identity img.user-avatar')).toBeVisible();
  await client.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(client.getByRole('status')).toHaveText('Changes saved.');
  await client.reload();
  await expect(client.locator('.profile-identity img.user-avatar')).toBeVisible();
  expect(
    await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await client.screenshot({ path: `.cache/profile-${testInfo.project.name}.png`, fullPage: true });
  async function editClient() {
    await page.goto('/vianoor/en/admin/users');
    await page.getByPlaceholder('Email or user ID').fill(email);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const row = page.locator('tbody tr').filter({ hasText: email });
    await expect(row).toHaveCount(1);
    const code = (await row.locator('td').first().innerText()).trim();
    expect(code).toMatch(/^[A-Za-z0-9]{13}$/);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('User roles', { exact: true })).toBeVisible();
    return code;
  }
  const code = await editClient();
  await page.getByLabel('User roles', { exact: true }).selectOption('secretary');
  await page.getByRole('button', { name: 'Add role', exact: true }).click();
  await expect(page.locator('.grant-list li').filter({ hasText: 'Secretary' })).toBeVisible();
  await client.goto('http://127.0.0.1:18876/vianoor/en/account');
  await client.locator('.workspace-switch').selectOption('secretary|platform');
  await expect(client.getByRole('heading', { name: 'Secretary', exact: true })).toBeVisible();
  await page
    .locator('.grant-list li')
    .filter({ hasText: 'Secretary' })
    .getByRole('button', { name: 'Remove role' })
    .click();
  await client.reload();
  await expect(
    client.getByText('You do not have access to this workspace.', { exact: true }),
  ).toBeVisible();
  await page.goto('/vianoor/en/admin/forms');
  await page.getByRole('button', { name: 'New form', exact: true }).click();
  const title = 'Browser form ' + testInfo.project.name + ' ' + randomUUID().slice(0, 5);
  await page
    .getByRole('group', { name: 'Form title', exact: true })
    .getByLabel('English', { exact: true })
    .fill(title);
  await page
    .getByRole('group', { name: 'Form title', exact: true })
    .getByLabel('فارسی', { exact: true })
    .fill('فرم آزمایش مرورگر');
  await page
    .getByRole('group', { name: 'Section title', exact: true })
    .getByLabel('English', { exact: true })
    .fill('Basics');
  await page
    .locator('.field-palette')
    .getByRole('button', { name: /Short text/ })
    .click();
  await page
    .getByRole('group', { name: 'Field label', exact: true })
    .getByLabel('English', { exact: true })
    .fill('Favorite book');
  await page
    .getByRole('group', { name: 'Field label', exact: true })
    .getByLabel('فارسی', { exact: true })
    .fill('کتاب مورد علاقه');
  await page.getByLabel('Required', { exact: true }).check();
  await page
    .locator('.field-settings')
    .getByLabel('Access scope', { exact: true })
    .selectOption('members');
  await page
    .locator('.field-palette')
    .getByRole('button', { name: /Dropdown/ })
    .click();
  await page
    .getByRole('group', { name: 'Field label', exact: true })
    .getByLabel('English', { exact: true })
    .fill('Preferred time');
  await page
    .getByRole('group', { name: 'Options 1', exact: true })
    .getByLabel('English', { exact: true })
    .fill('Morning');
  await page.getByRole('button', { name: 'Add option', exact: true }).click();
  await page
    .getByRole('group', { name: 'Options 2', exact: true })
    .getByLabel('English', { exact: true })
    .fill('Evening');
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page
    .getByRole('group', { name: 'Section title', exact: true })
    .getByLabel('English', { exact: true })
    .fill('Preferences');
  await page.getByLabel('Form layout', { exact: true }).selectOption('tabs');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Publish form', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  await page.getByRole('button', { name: 'Basics', exact: true }).click();
  await page.screenshot({ path: `.cache/builder-${testInfo.project.name}.png`, fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await editClient();
  await page.getByLabel('Assigned profile form', { exact: true }).selectOption({ label: title });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Assign form', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Changes saved.');
  await client.goto('http://127.0.0.1:18876/vianoor/en/account/profile');
  await client.getByLabel(/Favorite book/).fill('A sample title');
  await client.getByLabel('Preferred time', { exact: true }).selectOption({ label: 'Morning' });
  await client.getByRole('button', { name: 'Complete profile', exact: true }).click();
  await expect(client.getByRole('status')).toHaveText('Changes saved.');
  await client.goto('http://127.0.0.1:18876/vianoor/en/members/' + code);
  await expect(client.getByText('A sample title', { exact: true })).toBeVisible();
  const denied = await client.request.post(
    'http://127.0.0.1:18876/vianoor/api/users/users/search',
    { headers: { origin: 'http://127.0.0.1:18876' }, data: { query: '', page: 0 } },
  );
  expect(denied.status()).toBe(403);
  await client.goto('http://127.0.0.1:18876/vianoor/fa/account');
  await expect(client.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(client.locator('html')).toHaveAttribute('lang', 'fa');
  expect(
    await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await client.screenshot({
    path: `.cache/workspace-fa-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await clientContext.close();
});
