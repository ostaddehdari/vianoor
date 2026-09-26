import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
const enabled = process.env.USERS_TEST === '1';
const env = (file: string) =>
  Object.fromEntries(
    readFileSync(`/run/vianoor/${file}.env`, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
test(
  'stage 6 real services: registration, IDs, profile forms, avatars, permissions, tenant isolation, consent, session requests and revocation',
  { skip: !enabled, timeout: 240000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(
      config.AUTH_DEVELOPMENT,
      '1',
      'This suite must only run against an isolated development installation',
    );
    assert.ok(new URL(config.AUTH_PUBLIC_URL!).hostname === '127.0.0.1');
    assert.equal(new URL(config.AUTH_PUBLIC_URL!).port, '18876');
    const key = config.AUTH_INTERNAL_KEY!;
    const suffix = randomUUID().slice(0, 8);
    const password = 'Stage06 test only passphrase 2026!';
    const auth = async (action: string, body: unknown, access = '') => {
      const response = await fetch('http://api-gateway:4100/api/v1/auth/' + action, {
        method: action === 'session' ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          'x-auth-client': 'stage06-' + suffix,
          authorization: 'Bearer ' + access,
        },
        ...(action === 'session' ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const api = async (path: string, access: string, method = 'GET', data?: unknown) => {
      const response = await fetch('http://api-gateway:4100/api/v2/' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          authorization: 'Bearer ' + access,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, body: await response.json() };
    };
    async function account(label: string) {
      const email = `qa-${suffix}-${label}@example.test`;
      assert.equal((await auth('register', { email, password, locale: 'en' })).status, 200);
      let token = '';
      for (let i = 0; i < 80 && !token; i++) {
        const list = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
        for (const message of list.messages ?? []) {
          if (!message.To?.some((to: { Address: string }) => to.Address === email)) continue;
          const detail = await fetch('http://mailpit:8025/api/v1/message/' + message.ID).then((r) =>
            r.json(),
          );
          token = detail.Text?.match(/verify-email#token=([A-Za-z0-9_-]{43})/)?.[1] ?? '';
        }
        if (!token) await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(token, 'Verification email must arrive through SMTP');
      assert.equal((await auth('verify-email', { token })).status, 200);
      const login = await auth('login', { email, password });
      assert.equal(login.status, 200);
      const session = await auth('session', {}, login.body.data.access);
      assert.equal(session.status, 200);
      const user = session.body.data.user;
      assert.match(user.public_id, /^[A-Za-z0-9]{13}$/);
      return { ...user, ...login.body.data, email };
    }
    const admin = await account('admin'),
      client = await account('client'),
      expert = await account('expert'),
      outsider = await account('outsider'),
      manager = await account('manager'),
      auditor = await account('auditor');
    const organization = new pg.Pool({
      connectionString: env('organization-service').DATABASE_URL,
    });
    try {
      // Only this isolated fixture seeds a grant directly into its owner database.
      await organization.query("DELETE FROM role_grants WHERE role='admin'");
      await organization.query(
        "INSERT INTO role_grants(account_id,public_id,role,scope) VALUES($1,$2,'admin','platform')",
        [admin.id, admin.public_id],
      );
      assert.equal(
        (await api('users/search', client.access, 'POST', { query: '', page: 0 })).status,
        403,
      );
      assert.equal((await api('profiles/forms', outsider.access)).status, 403);
      assert.equal(
        (await api('users/search', admin.access, 'POST', { query: 'qa-' + suffix, page: 0 })).body
          .data.total,
        6,
      );
      const grant = async (
        public_id: string,
        role: string,
        scope = 'platform',
        enabled = true,
        access = admin.access,
      ) => api('access/grants', access, 'POST', { public_id, role, scope, enabled });
      assert.equal((await grant(expert.public_id, 'expert')).status, 200);
      assert.equal((await grant(auditor.public_id, 'auditor')).status, 200);
      assert.equal((await api('access/audit', auditor.access)).status, 200);
      assert.equal(
        (await api('users/search', auditor.access, 'POST', { query: '', page: 0 })).status,
        403,
      );
      assert.equal((await grant(admin.public_id, 'admin', 'platform', false)).status, 409);
      assert.equal(
        (await api('users/' + admin.public_id, admin.access, 'PATCH', { disabled: true })).status,
        409,
      );
      const mine = (await api('access/me', admin.access)).body.data.workspaces;
      assert.ok(mine.some((w: { role: string }) => w.role === 'account'));
      assert.ok(mine.some((w: { role: string }) => w.role === 'admin'));
      const a = (
        await api('access/organizations', admin.access, 'POST', { name: 'QA organization A' })
      ).body.data.id;
      const b = (
        await api('access/organizations', admin.access, 'POST', { name: 'QA organization B' })
      ).body.data.id;
      assert.equal((await grant(manager.public_id, 'organization', a)).status, 200);
      assert.equal(
        (await grant(outsider.public_id, 'expert', a, true, manager.access)).status,
        200,
      );
      assert.equal(
        (await grant(outsider.public_id, 'expert', b, true, manager.access)).status,
        403,
      );
      assert.equal(
        (await grant(outsider.public_id, 'expert', 'platform', true, manager.access)).status,
        403,
      );
      assert.equal(
        (await grant(outsider.public_id, 'organization', a, true, manager.access)).status,
        403,
      );
      assert.equal((await api('access/members?scope=' + b, manager.access)).status, 403);
      assert.equal((await api('access/members?scope=' + a, manager.access)).status, 200);
      const managerOrganizations = (await api('access/organizations', manager.access)).body.data;
      assert.equal(managerOrganizations.length, 1);
      let profile = (await api('profiles/me', client.access)).body.data;
      assert.equal(profile.complete, false);
      const initial = {
        display_name: 'QA Client',
        avatar: { kind: 'preset', value: '3' },
        answers: {
          bio: 'Public sample biography',
          language: 'en',
          timezone: 'Private sample time zone',
        },
        version: profile.form.version,
        revision: profile.revision,
        complete: true,
      };
      assert.equal(
        (await api('profiles/me', client.access, 'PUT', { ...initial, answers: {} })).status,
        400,
      );
      assert.equal(
        (
          await api('profiles/me', client.access, 'PUT', {
            ...initial,
            answers: { ...initial.answers, admin: true },
          })
        ).status,
        400,
      );
      assert.equal((await api('profiles/me', client.access, 'PUT', initial)).status, 200);
      assert.equal(
        (await api('consents/profile', client.access, 'POST', { version: 1, accepted: true }))
          .status,
        200,
      );
      const publicProfile = (await api('profiles/member/' + client.public_id, outsider.access)).body
        .data;
      assert.equal(publicProfile.display_name, 'QA Client');
      assert.ok(publicProfile.fields.some((f: { id: string }) => f.id === 'bio'));
      assert.ok(!publicProfile.fields.some((f: { id: string }) => f.id === 'timezone'));
      assert.ok(!('email' in publicProfile));
      const image = await sharp({
        create: { width: 60, height: 60, channels: 3, background: '#42664b' },
      })
        .png()
        .toBuffer();
      const uploaded = await api('files/images', client.access, 'POST', {
        kind: 'avatar',
        base64: image.toString('base64'),
      });
      assert.equal(uploaded.status, 200);
      const imageId = uploaded.body.data.id;
      assert.equal((await api('files/images/' + imageId, outsider.access)).status, 200);
      const other = (await api('profiles/me', outsider.access)).body.data;
      assert.equal(
        (
          await api('profiles/me', outsider.access, 'PUT', {
            ...initial,
            avatar: { kind: 'upload', value: imageId },
            revision: other.revision,
            version: other.form.version,
          })
        ).status,
        403,
      );
      const attachment = (
        await api('files/images', client.access, 'POST', {
          kind: 'attachment',
          base64: image.toString('base64'),
        })
      ).body.data.id;
      assert.equal((await api('files/images/' + attachment, outsider.access)).status, 403);
      profile = (await api('profiles/me', client.access)).body.data;
      assert.equal(
        (
          await api('profiles/me', client.access, 'PUT', {
            ...initial,
            avatar: { kind: 'upload', value: imageId },
            revision: profile.revision,
          })
        ).status,
        200,
      );
      assert.equal(
        (await api('profiles/me', client.access, 'PUT', { ...initial, revision: profile.revision }))
          .status,
        409,
      );
      const definition = {
        title: { fa: 'فرم آزمایش', en: 'Test form' },
        layout: 'tabs',
        sections: [
          {
            id: 'first',
            title: { fa: 'یک', en: 'One' },
            fields: [
              {
                id: 'choice',
                type: 'select',
                label: { fa: 'انتخاب', en: 'Choice' },
                required: true,
                visibility: 'private',
                options: [
                  { value: 'yes', label: { fa: 'بله', en: 'Yes' } },
                  { value: 'no', label: { fa: 'خیر', en: 'No' } },
                ],
              },
            ],
          },
          {
            id: 'second',
            title: { fa: 'دو', en: 'Two' },
            fields: [
              {
                id: 'details',
                type: 'text',
                label: { fa: 'توضیح', en: 'Details' },
                required: true,
                visibility: 'members',
                options: [],
                showWhen: { field: 'choice', equals: 'yes' },
              },
            ],
          },
        ],
      };
      const created = await api('profiles/forms', admin.access, 'POST', definition);
      assert.equal(created.status, 200);
      const formId = created.body.data.id;
      assert.equal(
        (
          await api('profiles/assign', admin.access, 'POST', {
            public_id: client.public_id,
            form_id: formId,
          })
        ).status,
        409,
      );
      assert.equal(
        (await api('profiles/forms/' + formId + '/publish', admin.access, 'POST', { revision: 1 }))
          .status,
        200,
      );
      assert.equal(
        (
          await api('profiles/assign', admin.access, 'POST', {
            public_id: client.public_id,
            form_id: formId,
          })
        ).status,
        200,
      );
      profile = (await api('profiles/me', client.access)).body.data;
      assert.equal(profile.complete, false);
      const saved = {
        ...initial,
        answers: { choice: 'no', details: 'hidden value' },
        version: profile.form.version,
        revision: profile.revision,
      };
      const completed = await api('profiles/me', client.access, 'PUT', saved);
      assert.equal(completed.status, 200);
      assert.equal(completed.body.data.complete, true);
      assert.equal('details' in completed.body.data.answers, false);
      assert.equal(
        (await api('profiles/forms/' + formId + '/publish', admin.access, 'POST', { revision: 2 }))
          .status,
        200,
      );
      assert.equal(
        (
          await api('profiles/me', client.access, 'PUT', {
            ...saved,
            revision: completed.body.data.revision,
          })
        ).status,
        409,
      );
      profile = (await api('profiles/me', client.access)).body.data;
      assert.equal(
        (
          await api('profiles/me', client.access, 'PUT', {
            ...saved,
            version: profile.form.version,
            revision: profile.revision,
          })
        ).status,
        200,
      );
      const preferred_date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      assert.equal(
        (
          await api('bookings/requests', outsider.access, 'POST', {
            expert: expert.public_id,
            preferred_date,
          })
        ).status,
        409,
      );
      const request = await api('bookings/requests', client.access, 'POST', {
        expert: expert.public_id,
        preferred_date,
      });
      assert.equal(request.status, 200);
      const requestId = request.body.data.id;
      assert.equal((await api('bookings/requests?view=mine', outsider.access)).body.data.length, 0);
      assert.ok(
        (await api('bookings/requests?view=expert', expert.access)).body.data.some(
          (r: { id: string }) => r.id === requestId,
        ),
      );
      assert.equal(
        (
          await api('bookings/requests/' + requestId, outsider.access, 'PATCH', {
            status: 'cancelled',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await api('bookings/requests/' + requestId, client.access, 'PATCH', {
            status: 'reviewed',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await api('bookings/requests/' + requestId, expert.access, 'PATCH', {
            status: 'reviewed',
          })
        ).status,
        200,
      );
      assert.equal(
        (await api('consents/profile', client.access, 'POST', { version: 1, accepted: false }))
          .status,
        200,
      );
      assert.equal(
        (await api('profiles/member/' + client.public_id, outsider.access)).body.data.fields.length,
        0,
      );
      assert.equal((await api('files/images/' + imageId, outsider.access)).status, 403);
      assert.equal(
        (
          await api('bookings/requests', client.access, 'POST', {
            expert: expert.public_id,
            preferred_date,
          })
        ).status,
        409,
      );
      assert.equal((await grant(expert.public_id, 'expert', 'platform', false)).status, 200);
      assert.equal((await api('bookings/requests?view=expert', expert.access)).status, 403);
      assert.equal(
        (await api('users/' + client.public_id, admin.access, 'PATCH', { disabled: true })).status,
        200,
      );
      assert.equal((await api('profiles/me', client.access)).status, 401);
      assert.equal((await auth('refresh', { refresh: client.refresh })).status, 401);
      assert.equal((await auth('login', { email: client.email, password })).status, 401);
      const noKey = await fetch('http://api-gateway:4100/api/v2/access/me');
      assert.equal(noKey.status, 401);
      const noOrigin = await fetch('http://web:3000/vianoor/api/users/users/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: '{}',
      });
      assert.equal(noOrigin.status, 403);
      writeFileSync(
        '/test-output/browser-fixture.json',
        JSON.stringify({
          admin: { email: admin.email, password, public_id: admin.public_id },
          client: { email: outsider.email, password, public_id: outsider.public_id },
        }),
        { mode: 0o600 },
      );
    } finally {
      await organization.end();
    }
  },
);
