import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
if (process.env.SESSIONS_TEST !== '1') throw Error('Explicit isolated media test required');
const fixture = JSON.parse(readFileSync('.cache/sessions-browser.json', 'utf8')),
  base = 'http://127.0.0.1:18886/vianoor';
mkdirSync('.cache/stage13-evidence', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors = [];
async function actor(account) {
  const context = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on('pageerror', (e) =>
    errors.push(e.message.replace(/access_token=[^&\s]+/g, 'access_token=REDACTED')),
  );
  await page.goto(base + '/en/auth/login');
  await page.locator('input[name=email]').fill(account.email);
  await page.locator('button.auth-submit').click();
  await page.locator('input[name=password]').fill(account.password);
  await page.locator('button.auth-submit').click();
  await page.waitForURL('**/en/account');
  await page.goto(base + '/en/account/sessions?session=' + fixture.session + '&relay=1');
  const panel = page.locator('.session-workspace');
  await panel
    .getByRole('heading', { name: 'Synthetic stage 13 session · Synthetic expert' })
    .waitFor();
  return { context, page, panel };
}
try {
  const client = await actor(fixture.customer),
    expert = await actor(fixture.expert);
  for (const a of [client, expert]) {
    await a.panel.getByText('Check devices', { exact: true }).click();
    await a.panel.getByRole('button', { name: 'Start device preview', exact: true }).click();
    await a.panel.getByRole('button', { name: 'Confirm device check', exact: true }).click();
  }
  await expert.panel.getByRole('button', { name: 'Open session', exact: true }).click();
  for (const a of [expert, client])
    await a.panel.getByRole('button', { name: 'Join call', exact: true }).click();
  for (const a of [client, expert]) {
    await a.page.waitForFunction(
      () =>
        [...document.querySelectorAll('.session-media video')].length >= 2 &&
        [...document.querySelectorAll('.session-media video')].every((v) => v.readyState >= 2),
      {},
      { timeout: 60000 },
    );
    await a.panel.getByText(/Media relay verified/).waitFor({ timeout: 60000 });
  }
  console.log(
    'PASS two Chromium contexts transmit synthetic camera/microphone over real LiveKit with forced TURN relay.',
  );
  await client.page.screenshot({
    path: '.cache/stage13-evidence/forced-relay-call.png',
    fullPage: true,
  });
  await client.context.setOffline(true);
  await client.page.waitForTimeout(7000);
  await client.context.setOffline(false);
  await client.panel.getByText(/Connected · Connection quality/).waitFor({ timeout: 60000 });
  await client.page.reload();
  await client.panel.getByRole('button', { name: 'Join call', exact: true }).click();
  await client.page.waitForFunction(
    () => document.querySelectorAll('.session-media video').length >= 2,
    {},
    { timeout: 60000 },
  );
  const state = await client.page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('session');
    return (await (await fetch('/vianoor/api/users/sessions/' + id)).json()).data;
  });
  assert.equal(state.state, 'IN_SESSION');
  assert.ok(state.actual_started_at);
  console.log(
    'PASS signaling interruption recovery, page refresh/rejoin and authoritative session start.',
  );
  await client.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await client.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
  );
  await client.page.screenshot({ path: '.cache/stage13-evidence/call-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
