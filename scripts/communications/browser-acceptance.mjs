import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
if (process.env.COMMUNICATIONS_TEST !== '1')
  throw Error('Explicit isolated communication test required');
const base = 'http://127.0.0.1:18886/vianoor',
  fixture = JSON.parse(
    readFileSync(
      process.env.COMMUNICATIONS_BROWSER_FIXTURE ?? '.cache/communications-browser.json',
      'utf8',
    ),
  );
const output = '.cache/stage12-evidence';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  permissions: ['microphone'],
});
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(45000);
try {
  await page.goto(base + '/en/auth/login');
  await page.locator('input[name=email]').fill(fixture.customer.email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(fixture.customer.password);
  await page.locator('button.auth-submit').click();
  await page.waitForURL('**/en/account');
  await page.goto(base + '/en/account/messages?conversation=' + fixture.conversation);
  const panel = page.locator('.communication-workspace');
  await panel.locator('.communication-history li').first().waitFor();
  const body = 'Synthetic browser persistence ' + Date.now();
  await panel.getByLabel('Message', { exact: true }).fill(body);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await panel.getByText(body, { exact: true }).waitFor();
  await page.reload();
  await panel.getByText(body, { exact: true }).waitFor();
  const oldestSynthetic = panel.getByText('Synthetic concurrent message 0', { exact: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await oldestSynthetic.isVisible().catch(() => false)) break;
    const loadMore = panel.getByRole('button', { name: 'Load more', exact: true });
    if (!(await loadMore.isVisible().catch(() => false))) break;
    const count = await panel.locator('.communication-history li').count();
    await loadMore.click();
    await page
      .waitForFunction(
        (previous) =>
          document.querySelectorAll('.communication-workspace .communication-history li').length >
          previous,
        count,
        { timeout: 10000 },
      )
      .catch(() => {});
  }
  await oldestSynthetic.waitFor();
  await panel.getByRole('button', { name: 'Record voice', exact: true }).click();
  await panel.getByRole('button', { name: 'Stop recording', exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await panel.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await panel.getByRole('button', { name: 'Send', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('.communication-workspace button')].find(
      (x) => x.textContent === 'Send',
    );
    return b && !b.disabled;
  });
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await panel.getByRole('button', { name: 'Open attachment', exact: true }).last().click();
  await panel.locator('audio').last().waitFor();
  const axe = await new AxeBuilder({ page })
    .include('.communication-workspace')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  console.log('===== AXE COLOR CONTRAST DETAILS =====');
  for (const violation of axe.violations) {
    console.log('VIOLATION:', violation.id);
    console.log('IMPACT:', violation.impact);
    console.log('HELP:', violation.help);
    for (const node of violation.nodes) {
      console.log('TARGET:', JSON.stringify(node.target));
      console.log('HTML:', node.html);
      console.log('SUMMARY:', node.failureSummary);
      for (const check of [...node.any, ...node.all, ...node.none]) {
        if (check.data) console.log('DATA:', JSON.stringify(check.data));
        if (check.message) console.log('MESSAGE:', check.message);
      }
    }
  }
  console.log('===== END AXE DETAILS =====');
  assert.deepEqual(
    axe.violations.map((x) => x.id),
    [],
  );
  await page.screenshot({ path: output + '/messages-en.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/fa/account/messages?conversation=' + fixture.conversation);
  await panel.locator('.communication-history li').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: output + '/messages-mobile-fa.png', fullPage: true });
  await page.goto(base + '/fa/account/channels?channel=' + fixture.channel);
  await panel.getByRole('heading', { name: 'Synthetic channel' }).waitFor();
  await page.screenshot({ path: output + '/channel-mobile-fa.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS real browser: login, send, refresh, older history, microphone recording/upload/playback, channel, fa/en, mobile, accessibility.',
  );
} catch (error) {
  await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
