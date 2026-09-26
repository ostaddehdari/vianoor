import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
async function mailLink(request: APIRequestContext, email: string, route: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const list = await request.get('http://127.0.0.1:18025/api/v1/messages').then((r) => r.json());
    for (const m of list.messages ?? []) {
      if (!m.To?.some((x: { Address: string }) => x.Address === email)) continue;
      const detail = await request
        .get(`http://127.0.0.1:18025/api/v1/message/${m.ID}`)
        .then((r) => r.json());
      const match = detail.Text?.match(
        new RegExp(
          `http://127.0.0.1:15400/vianoor/(?:fa|en)/auth/${route}#token=[A-Za-z0-9_-]{43}`,
        ),
      );
      if (match) return match[0] as string;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error('Expected test email was not delivered');
}
for (const locale of ['fa', 'en'])
  test(`${locale} complete account journey with real backend`, async ({
    page,
    request,
    context,
  }, info) => {
    const email = `browser-${randomUUID()}@example.test`,
      password = 'A browser test passphrase 2026!',
      newPassword = 'A changed browser passphrase 2026!';
    const base = `/vianoor/${locale}`;
    await page.goto(`${base}/auth/register`);
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.locator('input[name=confirm]').fill(password);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-message.success')).toBeVisible();
    await page.goto(await mailLink(request, email, 'verify-email'));
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-message.success')).toBeVisible();
    await page.goto(`${base}/auth/login`);
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await expect(page).toHaveURL(new RegExp(`${base}/account/security$`));
    await expect(page.locator('.auth-account')).toContainText(email);
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const c of (await context.cookies()).filter((c) => c.name.startsWith('vianoor-'))) {
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe('Lax');
    }
    expect(await page.evaluate(() => document.cookie.includes('vianoor-'))).toBe(false);
    await page.screenshot({
      path: info.outputPath(`account-security-${locale}.png`),
      fullPage: true,
    });
    await page.locator('.auth-submit').click();
    await expect(page).toHaveURL(new RegExp(`${base}/auth/login$`));
    await page.goto(`${base}/auth/forgot-password`);
    await page.locator('input[name=email]').fill(email);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-message.success')).toBeVisible();
    await page.goto(await mailLink(request, email, 'reset-password'));
    await page.locator('input[name=password]').fill(newPassword);
    await page.locator('input[name=confirm]').fill(newPassword);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-message.success')).toBeVisible();
    await page.goto(`${base}/auth/login`);
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(newPassword);
    await page.locator('button[type=submit]').click();
    await expect(page.locator('.auth-account')).toContainText(email);
  });
