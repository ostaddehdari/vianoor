import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
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
  'stage 13 real owner HTTP and PostgreSQL: session uniqueness, access, text presence, private notes, completion and rating',
  { skip: process.env.SESSIONS_TEST !== '1', timeout: 120000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(config.AUTH_DEVELOPMENT, '1');
    assert.equal(config.AUTH_PUBLIC_URL, 'http://127.0.0.1:18886/vianoor');
    const fixture = JSON.parse(readFileSync('/test-output/communications-browser.json', 'utf8'));
    const call = async (port: number, path: string, token = '', method = 'GET', body?: unknown) => {
      const r = await fetch('http://127.0.0.1:' + port + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-internal-key': config.AUTH_INTERNAL_KEY!,
          authorization: 'Bearer ' + token,
          'x-auth-client': 'session-test-' + randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    };
    const api = (path: string, token = '', method = 'GET', body?: unknown) =>
      call(4100, '/api/v2/' + path, token, method, body);
    const ok = (r: { status: number; body: unknown }) =>
      assert.equal(r.status, 200, JSON.stringify(r.body));
    const login = async (account: unknown) => {
      const r = await call(4100, '/api/v1/auth/login', '', 'POST', account);
      ok(r);
      return r.body.data.access as string;
    };
    const admin = await login(fixture.admin),
      expert = await login(fixture.expert),
      client = await login(fixture.customer);
    const cp = (await call(4101, '/internal/principal', client)).body.data,
      ep = (await call(4101, '/internal/principal', expert)).body.data;
    const booking = new pg.Pool({ connectionString: env('booking-service').DATABASE_URL }),
      media = new pg.Pool({ connectionString: env('media-service').DATABASE_URL });
    const ids: string[] = [];
    const seed = async (status = 'CONFIRMED', offset = -60000, kind = 'TEXT') => {
      const id = randomUUID();
      ids.push(id);
      await booking.query(
        "INSERT INTO scheduled_bookings(id,client_id,client_code,expert_code,service_id,start_at,end_at,status,timezone,request_key,request_data,operation_id,snapshot) VALUES($1,$2,'TestClient001','TestExpert001',$3,$4,$5,$6,'UTC',$7,'{}',$8,$9)",
        [
          id,
          cp.id,
          randomUUID(),
          new Date(Date.now() + offset),
          new Date(Date.now() + offset + 3600000),
          status,
          randomUUID(),
          randomUUID(),
          {
            expert_id: ep.id,
            expert_code: 'TestExpert001',
            expert_name: 'Synthetic expert',
            kind,
            title: 'Synthetic stage 13 session',
            duration_minutes: 60,
            price_minor: 0,
            currency: 'USD',
            expert_timezone: 'UTC',
            cancellation_hours: 24,
            penalty_minor: 0,
            refund_mode: 'FULL',
            call_policy: { observer: 'WITH_BOTH_CONSENT', recording: 'BOTH_CONSENT' },
          },
        ],
      );
      return id;
    };
    try {
      const bookingId = await seed();
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          api('sessions', client, 'POST', { booking_id: bookingId }),
        ),
      );
      responses.forEach(ok);
      const id = responses[0]!.body.data.id;
      assert.equal(new Set(responses.map((r) => r.body.data.id)).size, 1);
      assert.equal(
        (await media.query('SELECT count(*) FROM session_members WHERE session_id=$1', [id]))
          .rows[0].count,
        '2',
      );
      assert.equal((await api('sessions/' + id, admin)).status, 403);
      assert.equal((await api('sessions/' + id + '/start', client, 'POST', {})).status, 403);
      assert.equal((await api('sessions/' + id + '/start', expert, 'POST', {})).status, 409);
      for (const token of [client, expert]) {
        ok(await api('sessions/' + id + '/waiting-room', token, 'POST', {}));
        ok(
          await api('sessions/' + id + '/device-check', token, 'POST', {
            microphone: false,
            camera: false,
            webrtc: true,
            latency_ms: 5,
            error: 'NONE',
          }),
        );
      }
      ok(await api('sessions/' + id + '/start', expert, 'POST', {}));
      for (const token of [client, expert])
        ok(await api('sessions/' + id + '/telemetry', token, 'POST', { event: 'HEARTBEAT' }));
      const running = await api('sessions/' + id, client);
      ok(running);
      assert.equal(running.body.data.state, 'IN_SESSION');
      assert.ok(running.body.data.actual_started_at);
      for (const visibility of ['PRIVATE_EXPERT_NOTE', 'SHARED_SESSION_NOTE'])
        ok(
          await api('sessions/' + id + '/notes', expert, 'POST', {
            visibility,
            body: 'Synthetic ' + visibility,
          }),
        );
      const notes = (await api('sessions/' + id, client)).body.data.notes;
      assert.equal(notes.length, 1);
      assert.equal(notes[0].visibility, 'SHARED_SESSION_NOTE');
      assert.ok(
        (
          await media.query('SELECT sealed_body FROM session_notes WHERE session_id=$1', [id])
        ).rows.every((r) => !r.sealed_body.includes('Synthetic')),
      );
      const rating = {
        session_id: id,
        overall: 5,
        punctuality: 4,
        communication: 5,
        technical: 4,
        technical_issues: [],
        review: 'Synthetic review',
      };
      assert.equal((await api('ratings', client, 'POST', rating)).status, 403);
      ok(await api('sessions/' + id + '/end', expert, 'POST', { outcome: 'COMPLETED' }));
      for (let i = 0; i < 30; i++) {
        if (
          (await booking.query('SELECT status FROM scheduled_bookings WHERE id=$1', [bookingId]))
            .rows[0].status === 'COMPLETED'
        )
          break;
        await pause(500);
      }
      assert.equal(
        (await booking.query('SELECT status FROM scheduled_bookings WHERE id=$1', [bookingId]))
          .rows[0].status,
        'COMPLETED',
      );
      ok(await api('ratings', client, 'POST', rating));
      assert.equal((await api('ratings', expert, 'POST', rating)).status, 403);
      assert.equal((await api('sessions/' + id + '/token', client, 'POST', {})).status, 403);
      for (const status of ['HELD', 'CANCELLED', 'EXPIRED'])
        assert.equal(
          (await api('sessions', client, 'POST', { booking_id: await seed(status) })).status,
          403,
        );
      const future = await api('sessions', client, 'POST', {
        booking_id: await seed('CONFIRMED', 3600000),
      });
      ok(future);
      assert.equal(
        (await api('sessions/' + future.body.data.id + '/waiting-room', client, 'POST', {})).status,
        403,
      );
      const videoBooking = await seed('CONFIRMED', -60000, 'VIDEO');
      const video = await api('sessions', client, 'POST', { booking_id: videoBooking });
      ok(video);
      writeFileSync(
        '/test-output/sessions-browser.json',
        JSON.stringify({ ...fixture, session: video.body.data.id, booking: videoBooking }),
      );
      console.log(
        'PASS real HTTP/DB: 20 concurrent provisions yield one session; owner checks, actual text presence, encrypted/private notes, completion outbox, verified ratings and invalid booking/window rejection. Media transport and payment were not simulated by this test.',
      );
    } finally {
      await Promise.all([booking.end(), media.end()]);
    }
  },
);
