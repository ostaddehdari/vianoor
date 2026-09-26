import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const enabled = process.env.AUTH_TEST === '1';
const env = (file: string) =>
  Object.fromEntries(
    readFileSync(`/run/vianoor/${file}.env`, 'utf8')
      .trim()
      .split('\n')
      .map((s) => {
        const i = s.indexOf('=');
        return [s.slice(0, i), s.slice(i + 1)];
      }),
  );
test(
  'real identity lifecycle, email, rotation, revocation, enumeration and throttling',
  { skip: !enabled, timeout: 120000 },
  async () => {
    const config = env('identity-auth'),
      database = env('identity-service');
    const pool = new pg.Pool({ connectionString: database.DATABASE_URL });
    const key = config.AUTH_INTERNAL_KEY!,
      email = `identity-${randomUUID()}@example.test`,
      password = 'A unique test passphrase 2026!';
    const base = 'http://api-gateway:4100/api/v1/auth/';
    async function api(action: string, data: unknown = {}, access = '', client = 'test') {
      const r = await fetch(base + action, {
        method: action === 'session' ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          'x-auth-client': client,
          authorization: `Bearer ${access}`,
        },
        ...(action === 'session' ? {} : { body: JSON.stringify(data) }),
      });
      return { status: r.status, body: await r.json() };
    }
    async function mailToken(recipient: string, purpose: string) {
      for (let i = 0; i < 80; i++) {
        const list = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
        for (const m of list.messages ?? []) {
          if (!m.To?.some((x: { Address: string }) => x.Address === recipient)) continue;
          const detail = await fetch(`http://mailpit:8025/api/v1/message/${m.ID}`).then((r) =>
            r.json(),
          );
          const match = detail.Text?.match(new RegExp(`${purpose}#token=([A-Za-z0-9_-]{43})`));
          if (match) return match[1] as string;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw Error('Expected email did not arrive');
    }
    try {
      assert.equal((await fetch(base + 'session')).status, 401);
      assert.equal(
        (await api('register', { email, password, locale: 'en', role: 'admin' })).status,
        400,
      );
      const created = await api('register', { email, password, locale: 'en' });
      assert.equal(created.status, 200);
      const repeated = await api('register', {
        email,
        password: 'different but long password',
        locale: 'en',
      });
      assert.deepEqual(created.body.data, repeated.body.data);
      assert.equal((await api('login', { email, password })).status, 401);
      const verify = await mailToken(email, 'verify-email');
      assert.equal((await api('verify-email', { token: verify })).status, 200);
      assert.equal((await api('verify-email', { token: verify })).status, 400);
      const login = await api('login', { email: email.toUpperCase(), password });
      assert.equal(login.status, 200);
      const first = login.body.data;
      assert.equal((await api('session', {}, first.access)).status, 200);
      const rotated = await api('refresh', { refresh: first.refresh });
      assert.equal(rotated.status, 200);
      assert.equal((await api('session', {}, first.access)).status, 401);
      assert.equal((await api('refresh', { refresh: first.refresh })).status, 401);
      assert.equal((await api('session', {}, rotated.body.data.access)).status, 401);
      const second = (await api('login', { email, password })).body.data;
      const sessionData = (await api('session', {}, second.access)).body.data;
      assert.equal(sessionData.user.email, email);
      assert.equal(sessionData.sessions.length, 1);
      const another = (await api('login', { email, password })).body.data;
      await api('revoke', {}, second.access);
      assert.equal((await api('session', {}, another.access)).status, 401);
      const third = (await api('login', { email, password })).body.data;
      const resetRequest = await api('forgot-password', { email, locale: 'en' });
      const unknown = await api('forgot-password', {
        email: `unknown-${randomUUID()}@example.test`,
        locale: 'en',
      });
      assert.deepEqual(resetRequest.body.data, unknown.body.data);
      const reset = await mailToken(email, 'reset-password');
      const newPassword = 'A completely new passphrase 2026!';
      assert.equal(
        (await api('reset-password', { token: reset, password: newPassword })).status,
        200,
      );
      assert.equal(
        (await api('reset-password', { token: reset, password: newPassword })).status,
        400,
      );
      assert.equal((await api('session', {}, third.access)).status, 401);
      assert.equal((await api('login', { email, password })).status, 401);
      const fresh = await api('login', { email, password: newPassword });
      assert.equal(fresh.status, 200);
      await api('logout', { refresh: fresh.body.data.refresh });
      assert.equal((await api('session', {}, fresh.body.data.access)).status, 401);
      // A caller cannot revoke a session owned by another account.
      const otherEmail = `owner-${randomUUID()}@example.test`;
      await api('register', { email: otherEmail, password, locale: 'en' });
      await pool.query('UPDATE identity_accounts SET verified_at=now() WHERE email=$1', [
        otherEmail,
      ]);
      const other = (await api('login', { email: otherEmail, password })).body.data;
      const otherSessions = (await api('session', {}, other.access)).body.data;
      const own = (await api('login', { email, password: newPassword })).body.data;
      await api('revoke', { id: otherSessions.sessions[0].id }, own.access);
      assert.equal((await api('session', {}, other.access)).status, 200);
      // Concurrent refresh requests cannot both rotate successfully; replay revokes the family.
      const race = await Promise.all([
        api('refresh', { refresh: other.refresh }),
        api('refresh', { refresh: other.refresh }),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 401]);
      assert.equal(
        (await api('session', {}, race.find((r) => r.status === 200)!.body.data.access)).status,
        401,
      );
      await pool.query(
        "UPDATE identity_sessions SET access_expires_at=now()-interval '1 second' WHERE account_id=(SELECT id FROM identity_accounts WHERE email=$1)",
        [email],
      );
      assert.equal((await api('session', {}, own.access)).status, 401);
      const recovered = await api('refresh', { refresh: own.refresh });
      assert.equal(recovered.status, 200);
      await pool.query(
        "UPDATE identity_sessions SET absolute_expires_at=now()-interval '1 second' WHERE account_id=(SELECT id FROM identity_accounts WHERE email=$1)",
        [email],
      );
      assert.equal((await api('refresh', { refresh: recovered.body.data.refresh })).status, 401);
      // Expiry is enforced by database time, independently of browser state.
      await api('forgot-password', { email: otherEmail, locale: 'en' });
      const expired = await mailToken(otherEmail, 'reset-password');
      await pool.query(
        "UPDATE identity_tokens SET expires_at=now()-interval '1 second' WHERE account_id=(SELECT id FROM identity_accounts WHERE email=$1)",
        [otherEmail],
      );
      assert.equal(
        (await api('reset-password', { token: expired, password: newPassword })).status,
        400,
      );
      const target = `limit-${randomUUID()}@example.test`;
      for (let i = 0; i < 8; i++)
        assert.equal((await api('login', { email: target, password })).status, 401);
      assert.equal((await api('login', { email: target, password })).status, 429);
      const account = (
        await pool.query('SELECT id,password_hash FROM identity_accounts WHERE email=$1', [email])
      ).rows[0];
      assert.match(account.password_hash, /^\$argon2id\$/);
      const records = await pool.query('SELECT hash FROM identity_tokens WHERE account_id=$1', [
        account.id,
      ]);
      assert.ok(records.rows.every((r) => r.hash !== verify && r.hash !== reset));
      const audit = await pool.query(
        "SELECT action FROM identity_audit WHERE account_id=$1 AND action='refresh_reuse'",
        [account.id],
      );
      assert.equal(audit.rowCount, 1);
      const outbox = await pool.query(
        "SELECT envelope FROM infra_outbox WHERE envelope->>'aggregate_id'=$1",
        [account.id],
      );
      assert.equal(outbox.rowCount, 1);
      assert.equal(JSON.stringify(outbox.rows).includes(email), false);
    } finally {
      await pool.end();
    }
  },
);
test(
  'web BFF enforces origin, strips credentials and keeps cookies HttpOnly',
  { skip: !enabled, timeout: 30000 },
  async () => {
    const base = 'http://web:3000/vianoor/api/auth/';
    let r = await fetch(base + 'register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(r.status, 403);
    r = await fetch(base + 'login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'http://127.0.0.1:15400' },
      body: '{}',
    });
    assert.equal(r.status, 403);
    r = await fetch(base + 'session');
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    r = await fetch(base + 'register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:15400' },
      body: JSON.stringify({
        email: `bff-${randomUUID()}@example.test`,
        password: 'Long enough test passphrase',
        locale: 'en',
      }),
    });
    assert.equal(r.status, 200);
    // Test accounts are verified by DB only in this BFF plumbing test; lifecycle above uses actual SMTP.
    const cfg = env('identity-service'),
      pool = new pg.Pool({ connectionString: cfg.DATABASE_URL });
    const email = `cookie-${randomUUID()}@example.test`,
      password = 'A separate cookie test phrase';
    const headers = { 'content-type': 'application/json', origin: 'http://127.0.0.1:15400' };
    try {
      await fetch(base + 'register', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password, locale: 'en' }),
      });
      await pool.query('UPDATE identity_accounts SET verified_at=now() WHERE email=$1', [email]);
      r = await fetch(base + 'login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password }),
      });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { data: { ok: true } });
      const cookies = r.headers.getSetCookie();
      assert.equal(cookies.length, 2);
      for (const c of cookies) {
        assert.match(c, /HttpOnly/i);
        assert.match(c, /SameSite=lax/i);
        assert.match(c, /Path=\/vianoor/i);
      }
      const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
      r = await fetch(base + 'session', { headers: { cookie } });
      assert.equal(r.status, 200);
      r = await fetch(base + 'logout', {
        method: 'POST',
        headers: { ...headers, cookie },
        body: '{}',
      });
      assert.equal(r.status, 200);
      r = await fetch(base + 'session', { headers: { cookie } });
      assert.equal(r.status, 401);
    } finally {
      await pool.end();
    }
  },
);
