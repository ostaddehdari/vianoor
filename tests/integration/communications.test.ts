import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { WebSocket } from 'ws';
const env = (name: string) =>
  Object.fromEntries(
    readFileSync('/run/vianoor/' + name + '.env', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
test(
  'stage 12 isolated communication permissions, durable ordering, realtime, channels, private files and publication',
  { skip: process.env.COMMUNICATIONS_TEST !== '1', timeout: 300000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(config.AUTH_DEVELOPMENT, '1');
    assert.equal(config.AUTH_PUBLIC_URL, 'http://127.0.0.1:18886/vianoor');
    const fixture = JSON.parse(readFileSync('/test-output/scholars-browser.json', 'utf8')),
      headers = { 'content-type': 'application/json', 'x-internal-key': config.AUTH_INTERNAL_KEY! };
    const call = async (port: number, path: string, token = '', method = 'GET', data?: unknown) => {
      const r = await fetch('http://127.0.0.1:' + port + path, {
        method,
        headers: {
          ...headers,
          authorization: 'Bearer ' + token,
          'x-auth-client': 'stage12-' + randomUUID(),
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: r.status, body: await r.json() };
    };
    const api = (path: string, token = '', method = 'GET', data?: unknown) =>
        call(4100, '/api/v2/' + path, token, method, data),
      auth = (action: string, data: unknown) =>
        call(4100, '/api/v1/auth/' + action, '', 'POST', data),
      ok = (r: { status: number; body: unknown }) =>
        assert.equal(r.status, 200, JSON.stringify(r.body));
    const login = async (account: unknown) => {
      const r = await auth('login', account);
      ok(r);
      return r.body.data.access as string;
    };
    const admin = await login(fixture.admin),
      expert = await login(fixture.expert),
      customer = {
        email: 'stage12-' + randomUUID() + '@example.test',
        password: fixture.expert.password,
      };
    ok(await auth('register', { ...customer, locale: 'en' }));
    let verify = '';
    for (let i = 0; i < 60 && !verify; i++) {
      const inbox = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
      for (const m of inbox.messages ?? []) {
        if (!m.To?.some((x: { Address: string }) => x.Address === customer.email)) continue;
        const full = await fetch('http://mailpit:8025/api/v1/message/' + m.ID).then((r) =>
          r.json(),
        );
        verify = full.Text?.match(/verify-email#token=([A-Za-z0-9_-]{43})/)?.[1] ?? '';
      }
      if (!verify) await pause(500);
    }
    assert.ok(verify, 'Verification email delivered to isolated Mailpit');
    ok(await auth('verify-email', { token: verify }));
    const client = await login(customer),
      clientPrincipal = (await call(4101, '/internal/principal', client)).body.data,
      expertPrincipal = (await call(4101, '/internal/principal', expert)).body.data;
    ok(await api('profiles/me', client));
    const pool = new pg.Pool({ connectionString: env('messaging-service').DATABASE_URL }),
      notifications = new pg.Pool({ connectionString: env('notification-service').DATABASE_URL });
    const sockets: WebSocket[] = [];
    try {
      assert.equal((await api('users/search', client, 'POST', { query: '' })).status, 403);
      assert.equal(
        (
          await api('communications/conversations', client, 'POST', {
            type: 'DIRECT',
            context_id: expertPrincipal.id,
            request_key: randomUUID(),
          })
        ).status,
        400,
      );
      const channel = await api('channels', expert, 'POST', {
        title: 'Synthetic channel',
        description: 'Acceptance only',
        comments_enabled: true,
      });
      ok(channel);
      const cid = channel.body.data.id;
      ok(await api('channels/' + cid + '/follow', client, 'POST', { follow: true }));
      const post = await api('channels/' + cid + '/posts', expert, 'POST', {
        request_key: randomUUID(),
        body: 'Synthetic public post',
        files: [],
      });
      ok(post);
      const comment = await api(
        'channels/posts/' + post.body.data.id + '/comments',
        client,
        'POST',
        { request_key: randomUUID(), body: 'Synthetic moderated comment' },
      );
      ok(comment);
      assert.equal(comment.body.data.state, 'PENDING');
      assert.equal(
        (await api('channels/posts/' + post.body.data.id + '/comments', admin)).body.data.length,
        0,
      );
      ok(
        await api('channels/comments/' + comment.body.data.id + '/review', expert, 'POST', {
          state: 'APPROVED',
        }),
      );
      assert.equal(
        (await api('channels/posts/' + post.body.data.id + '/comments', admin)).body.data.length,
        1,
      );
      const inbox = await api('communications/conversations', client, 'POST', {
        type: 'CHANNEL_INBOX',
        context_id: cid,
        request_key: randomUUID(),
      });
      ok(inbox);
      const conversation = inbox.body.data.id;
      assert.equal(
        (await api('communications/conversations/' + conversation + '/messages', expert)).status,
        404,
      );
      const messages = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          api('communications/conversations/' + conversation + '/messages', client, 'POST', {
            request_key: randomUUID(),
            type: 'TEXT',
            content: 'Synthetic concurrent message ' + i,
          }),
        ),
      );
      messages.forEach(ok);
      assert.equal(new Set(messages.map((x) => x.body.data.sequence)).size, 100);
      assert.deepEqual(
        messages.map((x) => Number(x.body.data.sequence)).sort((a, b) => a - b),
        Array.from({ length: 100 }, (_, i) => i + 1),
      );
      const stored = (
        await pool.query('SELECT * FROM messages WHERE conversation_id=$1', [conversation])
      ).rows;
      assert.equal(stored.length, 100);
      assert.ok(stored.every((x) => !x.sealed_content.includes('Synthetic')));
      const refresh = await api(
        'communications/conversations/' + conversation + '/messages?after=0&limit=100',
        client,
      );
      ok(refresh);
      assert.equal(refresh.body.data.messages.length, 100);
      console.log(
        'PASS 100 concurrent messages: no loss, unique order, encrypted storage and history reload.',
      );
      const retry = {
        request_key: randomUUID(),
        type: 'TEXT',
        content: 'Synthetic idempotent reply',
        reply_to: messages[0]!.body.data.id,
      };
      const repeated = await Promise.all(
        Array.from({ length: 10 }, () =>
          api('communications/conversations/' + conversation + '/messages', client, 'POST', retry),
        ),
      );
      repeated.forEach(ok);
      assert.equal(new Set(repeated.map((x) => x.body.data.id)).size, 1);
      assert.equal(
        (
          await api('communications/conversations/' + conversation + '/messages', client, 'POST', {
            ...retry,
            content: 'Changed retry',
          })
        ).status,
        409,
      );
      ok(
        await api('communications/admin/' + conversation + '/review', admin, 'POST', {
          action: 'CLAIM',
        }),
      );
      ok(
        await api('communications/admin/' + conversation + '/review', admin, 'POST', {
          action: 'CATEGORIZE',
          category: 'COURSE',
        }),
      );
      ok(
        await api('communications/admin/' + conversation + '/review', admin, 'POST', {
          action: 'FORWARD',
        }),
      );
      ok(await api('communications/conversations/' + conversation + '/messages', expert));
      const response = await api(
        'communications/conversations/' + conversation + '/messages',
        expert,
        'POST',
        {
          request_key: randomUUID(),
          type: 'TEXT',
          content: 'Synthetic expert answer',
          reply_to: retry.reply_to,
        },
      );
      ok(response);
      ok(
        await api('communications/conversations/' + conversation + '/receipt', client, 'POST', {
          sequence: response.body.data.sequence,
          state: 'READ',
        }),
      );
      assert.equal(
        (
          await api('communications/conversations/' + conversation + '/receipt', client, 'POST', {
            sequence: '999999',
            state: 'READ',
          })
        ).status,
        400,
      );
      console.log(
        'PASS channel follow grants no direct access; administrative review/forward/reply/read.',
      );
      const q = await api('questions', client, 'POST', {
        request_key: randomUUID(),
        question: 'Synthetic private question',
      });
      ok(q);
      ok(
        await api('questions/' + q.body.data.id + '/assign', admin, 'POST', {
          expert: expertPrincipal.public_id,
          revision: 1,
        }),
      );
      let questions = (await api('questions', expert)).body.data;
      const assigned = questions.find((x: { id: string }) => x.id === q.body.data.id);
      assert.ok(assigned);
      ok(
        await api('questions/' + q.body.data.id + '/answer', expert, 'POST', {
          answer: 'Synthetic private answer',
          revision: assigned.revision,
        }),
      );
      const qc = await api('questions/' + q.body.data.id + '/conversation', client, 'POST', {});
      ok(qc);
      assert.equal(
        (await api('communications/conversations/' + qc.body.data.id + '/messages', admin)).status,
        404,
      );
      assert.equal(
        (
          await api('communications/admin/' + qc.body.data.id + '/review', admin, 'POST', {
            action: 'CLAIM',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await api(
            'communications/conversations/' + qc.body.data.id + '/messages',
            client,
            'POST',
            {
              request_key: randomUUID(),
              type: 'TEXT',
              content: 'Bad cross-room reply',
              reply_to: response.body.data.id,
            },
          )
        ).status,
        400,
      );
      const pdf = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
      );
      const uploaded = await api('files/assets', client, 'POST', {
        name: 'synthetic.pdf',
        mime: 'application/pdf',
        purpose: 'communication',
        access: 'OWNER_ONLY',
        authorized_users: [],
        base64: pdf.toString('base64'),
      });
      ok(uploaded);
      let state = '';
      for (let i = 0; i < 65; i++) {
        const f = await api('files/assets/' + uploaded.body.data.id, client);
        ok(f);
        state = f.body.data.state;
        if (state === 'READY') break;
        await pause(1000);
      }
      assert.equal(state, 'READY');
      ok(
        await api('communications/conversations/' + qc.body.data.id + '/messages', client, 'POST', {
          request_key: randomUUID(),
          type: 'FILE',
          content: 'Synthetic private attachment',
          files: [uploaded.body.data.id],
        }),
      );
      ok(await api('files/assets/' + uploaded.body.data.id + '/link', expert, 'POST', {}));
      assert.equal(
        (await api('files/assets/' + uploaded.body.data.id + '/link', admin, 'POST', {})).status,
        403,
      );
      console.log(
        'PASS administrators cannot read private consultation or its scanned attachment.',
      );
      questions = (await api('questions', client)).body.data;
      const revision = questions.find((x: { id: string }) => x.id === q.body.data.id).revision;
      ok(
        await api('questions/' + q.body.data.id + '/visibility', client, 'POST', {
          visibility: 'ANONYMOUS',
          public_question: 'Sanitized public question',
          public_answer: 'Sanitized public answer',
          revision,
        }),
      );
      assert.ok(
        !(await api('questions/public')).body.data.some(
          (x: { id: string }) => x.id === q.body.data.id,
        ),
      );
      ok(
        await api('questions/' + q.body.data.id + '/review', admin, 'POST', {
          publish: true,
          revision: revision + 1,
        }),
      );
      const publicCopy = (await api('questions/public')).body.data.find(
        (x: { id: string }) => x.id === q.body.data.id,
      );
      assert.equal(publicCopy.author, null);
      assert.equal(publicCopy.question, 'Sanitized public question');
      assert.ok(!JSON.stringify(publicCopy).includes('Synthetic private'));
      console.log('PASS private Q&A, assignment, consent, moderated anonymous public copy.');
      const ticket = (await api('communications/realtime-ticket', client, 'POST', {})).body.data
        .ticket;
      const events: Record<string, unknown>[] = [];
      const ws = new WebSocket('ws://127.0.0.1:4112/realtime', {
        origin: 'http://127.0.0.1:18886',
      });
      sockets.push(ws);
      ws.on('message', (bytes) => events.push(JSON.parse(bytes.toString())));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('WebSocket ready timeout')), 10000);
        ws.on('error', reject);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'authenticate', ticket })));
        ws.on('message', (b) => {
          if (JSON.parse(b.toString()).type === 'ready') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const replay = new WebSocket('ws://127.0.0.1:4112/realtime', {
        origin: 'http://127.0.0.1:18886',
      });
      sockets.push(replay);
      await new Promise<void>((resolve, reject) => {
        replay.on('error', reject);
        replay.on('open', () => replay.send(JSON.stringify({ type: 'authenticate', ticket })));
        replay.on('close', (code) => {
          assert.equal(code, 1008);
          resolve();
        });
      });
      const realtimeMessage = await api(
        'communications/conversations/' + conversation + '/messages',
        expert,
        'POST',
        { request_key: randomUUID(), type: 'TEXT', content: 'Synthetic realtime answer' },
      );
      ok(realtimeMessage);
      for (let i = 0; i < 20 && !events.some((x) => x.type === 'message'); i++) await pause(100);
      assert.ok(
        events.some((x) => x.type === 'message' && x.message_id === realtimeMessage.body.data.id),
      );
      assert.equal(
        (await api('presence/' + conversation, expert)).body.data.find(
          (x: { account_id: string }) => x.account_id === clientPrincipal.id,
        ).state,
        'ONLINE',
      );
      console.log('PASS real WebSocket delivery, one-use ticket and scoped presence.');
      for (let i = 0; i < 30; i++) {
        const n = await api('notifications', client);
        ok(n);
        if (n.body.data.items.some((x: { event: string }) => x.event === 'NEW_MESSAGE')) break;
        await pause(500);
      }
      const n = await api('notifications', client);
      assert.ok(n.body.data.items.some((x: { event: string }) => x.event === 'NEW_MESSAGE'));
      const notice = n.body.data.items[0];
      ok(await api('notifications/read', expert, 'POST', { ids: [notice.id] }));
      assert.equal(
        (await notifications.query('SELECT read_at FROM notifications WHERE id=$1', [notice.id]))
          .rows[0].read_at,
        null,
      );
      ok(await api('notifications/read', client, 'POST', { ids: [notice.id] }));
      assert.ok(
        (await notifications.query('SELECT read_at FROM notifications WHERE id=$1', [notice.id]))
          .rows[0].read_at,
      );
      console.log('PASS durable notification inbox and recipient-scoped read status.');
      writeFileSync(
        '/test-output/communications-browser.json',
        JSON.stringify({
          admin: fixture.admin,
          expert: fixture.expert,
          customer,
          conversation,
          question_conversation: qc.body.data.id,
          channel: cid,
        }),
      );
    } finally {
      for (const ws of sockets) ws.close();
      await Promise.all([pool.end(), notifications.end()]);
    }
  },
);
