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
      .map((line) => {
        const i = line.indexOf('=');
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
test(
  'stage 9 real 100-way race, holds, cancellation, atomic moves, UTC cache and durable recovery',
  { skip: process.env.SCHEDULING_TEST !== '1', timeout: 600000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(config.AUTH_DEVELOPMENT, '1');
    assert.equal(config.AUTH_PUBLIC_URL, 'http://127.0.0.1:18886/vianoor');
    const fixture = JSON.parse(readFileSync('/test-output/scholars-browser.json', 'utf8'));
    const api = async (path: string, token: string, method = 'GET', data?: unknown) => {
      const response = await fetch('http://api-gateway:4100/api/v2/' + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-internal-key': config.AUTH_INTERNAL_KEY!,
          authorization: 'Bearer ' + token,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const login = async (account: { email: string; password: string }) => {
      const response = await fetch('http://api-gateway:4100/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': config.AUTH_INTERNAL_KEY!,
          'x-auth-client': 'stage09-' + randomUUID(),
        },
        body: JSON.stringify(account),
      });
      assert.equal(response.status, 200);
      return (await response.json()).data.access as string;
    };
    const admin = await login(fixture.admin),
      expert = await login(fixture.expert),
      outsider = await login({
        ...fixture.expert,
        email: fixture.expert.email.replace('-expert@', '-outsider@'),
      });
    const expectOK = (r: { status: number; body: unknown }) =>
      assert.equal(r.status, 200, JSON.stringify(r.body));
    let scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
    for (const status of ['UNDER_REVIEW', 'APPROVED']) {
      if (scholar.status === 'APPROVED') break;
      expectOK(
        await api('experts/admin/' + fixture.scholarId + '/review', admin, 'POST', {
          status,
          revision: scholar.revision,
          reason: 'Stage 9 qualification fixture',
          internal_note: '',
          valid_until: null,
        }),
      );
      scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
    }
    const offering = {
      title: 'Free scheduling test ' + randomUUID().slice(0, 6),
      summary: 'Stage 9 free service',
      description: 'Synthetic scheduling acceptance',
      kind: 'VIDEO',
      specialty_id: scholar.profile.specialties[0],
      category_id: null,
      duration_minutes: 30,
      price_minor: 0,
      currency: 'IRR',
      booking_required: true,
      image_id: null,
      terms: 'Test only',
    };
    const created = await api('experts/me/services', expert, 'POST', offering);
    expectOK(created);
    const serviceId = created.body.data.id;
    expectOK(await api('experts/me/services/' + serviceId + '/publish', expert, 'POST', {}));
    expectOK(
      await api(
        'experts/admin/' + fixture.scholarId + '/services/' + serviceId + '/review',
        admin,
        'POST',
        { status: 'PUBLISHED', reason: 'Free test service approved', revision: 1 },
      ),
    );
    const expertCode = scholar.public_id;
    assert.equal((await api('availability/calendar', outsider)).status, 403);
    assert.equal((await api('availability/settings', expert)).status, 403);
    expectOK(await api('profiles/timezone', admin, 'PUT', { timezone: 'Europe/Berlin' }));
    assert.equal((await api('profiles/timezone', admin)).body.data.timezone, 'Europe/Berlin');
    assert.equal(
      (await api('profiles/timezone', admin, 'PUT', { timezone: '+03:30' })).status,
      400,
    );
    assert.equal(
      (
        await api('availability/resolve', admin, 'POST', {
          local: '2026-03-08T02:30',
          timezone: 'America/New_York',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await api('availability/resolve', admin, 'POST', {
          local: '2026-10-01T18:00',
          timezone: 'Asia/Tehran',
        })
      ).body.data.utc,
      '2026-10-01T14:30:00Z',
    );
    let calendar = (await api('availability/calendar', expert)).body.data;
    const working = {
      timezone: 'UTC',
      weekly: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, start: '09:00', end: '18:00' })),
      breaks: [{ day: 1, start: '12:00', end: '13:00' }],
      buffer_before: 0,
      buffer_after: 15,
      min_notice_minutes: 0,
      horizon_days: 90,
      cancellation_hours: 0,
      revision: calendar.revision,
    };
    expectOK(await api('availability/calendar', expert, 'PUT', working));
    assert.equal((await api('availability/calendar', expert, 'PUT', working)).status, 409);
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 3);
    day.setUTCHours(0, 0, 0, 0);
    const from = day.toISOString(),
      to = new Date(day.getTime() + 86400000).toISOString();
    const slotsPath =
      'availability/slots?' +
      new URLSearchParams({
        expert: expertCode,
        service: serviceId,
        from,
        to,
        timezone: 'Europe/Berlin',
      });
    const initial = await api(slotsPath, admin);
    expectOK(initial);
    const slots = initial.body.data.slots as { start_at: string; end_at: string }[];
    assert.ok(slots.length >= 8);
    const make = (start_at: string, request_key = randomUUID()) => ({
      expert: expertCode,
      service: serviceId,
      start_at,
      timezone: 'Europe/Berlin',
      request_key,
    });
    const attempts = Array.from({ length: 100 }, () => make(slots[0]!.start_at));
    const results = await Promise.all(
      attempts.map((input) => api('bookings/scheduled', admin, 'POST', input)),
    );
    assert.equal(
      results.filter((r) => r.status === 200).length,
      1,
      JSON.stringify(results.map((r) => ({ status: r.status, error: r.body.error }))),
    );
    assert.equal(
      results.filter((r) => r.status === 409 && r.body.error?.code === 'SLOT_ALREADY_RESERVED')
        .length,
      99,
    );
    const winner = results.findIndex((r) => r.status === 200);
    let booking = results[winner]!.body.data;
    console.log('Concurrency: 100 requests, 1 HELD, 99 SLOT_ALREADY_RESERVED.');
    const retry = await api('bookings/scheduled', admin, 'POST', attempts[winner]);
    expectOK(retry);
    assert.equal(retry.body.data.id, booking.id);
    assert.equal(
      (
        await api('bookings/scheduled', admin, 'POST', {
          ...attempts[winner],
          start_at: slots[1]!.start_at,
        })
      ).status,
      409,
    );
    assert.ok(
      !(await api(slotsPath, admin)).body.data.slots.some(
        (s: { start_at: string }) => s.start_at === slots[0]!.start_at,
      ),
    );
    assert.equal(
      (
        await api('bookings/scheduled/' + booking.id + '/cancel', outsider, 'POST', {
          revision: booking.revision,
          request_key: randomUUID(),
        })
      ).status,
      403,
    );
    let action = await api('bookings/scheduled/' + booking.id + '/confirm', admin, 'POST', {
      revision: booking.revision,
      request_key: randomUUID(),
    });
    expectOK(action);
    booking = action.body.data;
    assert.equal(booking.status, 'CONFIRMED');
    let second = (await api('bookings/scheduled', admin, 'POST', make(slots[1]!.start_at))).body
      .data;
    second = (
      await api('bookings/scheduled/' + second.id + '/confirm', admin, 'POST', {
        revision: second.revision,
        request_key: randomUUID(),
      })
    ).body.data;
    assert.equal(second.status, 'CONFIRMED');
    action = await api('bookings/scheduled/' + booking.id + '/reschedule', admin, 'POST', {
      revision: booking.revision,
      request_key: randomUUID(),
      start_at: slots[1]!.start_at,
    });
    assert.equal(action.status, 409);
    assert.equal(action.body.error.code, 'SLOT_ALREADY_RESERVED');
    booking = (await api('bookings/scheduled?period=future', admin)).body.data.find(
      (b: { id: string }) => b.id === booking.id,
    );
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal(booking.start_at, slots[0]!.start_at);
    assert.ok(
      !(await api(slotsPath, admin)).body.data.slots.some(
        (s: { start_at: string }) => s.start_at === slots[0]!.start_at,
      ),
    );
    const moveKey = randomUUID();
    action = await api('bookings/scheduled/' + booking.id + '/reschedule', admin, 'POST', {
      revision: booking.revision,
      request_key: moveKey,
      start_at: slots[2]!.start_at,
    });
    expectOK(action);
    booking = action.body.data;
    assert.equal(booking.status, 'RESCHEDULED');
    assert.equal(booking.start_at, slots[2]!.start_at);
    expectOK(
      await api('bookings/scheduled/' + booking.id + '/reschedule', admin, 'POST', {
        revision: booking.revision - 1,
        request_key: moveKey,
        start_at: slots[2]!.start_at,
      }),
    );
    assert.ok(
      (await api(slotsPath, admin)).body.data.slots.some(
        (s: { start_at: string }) => s.start_at === slots[0]!.start_at,
      ),
    );
    action = await api('bookings/scheduled/' + booking.id + '/cancel', admin, 'POST', {
      revision: booking.revision,
      request_key: randomUUID(),
    });
    expectOK(action);
    assert.equal(action.body.data.status, 'CANCELLED');
    // Lease expiry is exercised with real database time, not an in-memory fake clock.
    expectOK(await api('availability/settings', admin, 'PUT', { hold_seconds: 30 }));
    const expiring = (await api('bookings/scheduled', admin, 'POST', make(slots[3]!.start_at))).body
      .data;
    await new Promise((resolve) => setTimeout(resolve, 31000));
    const expired = await api('bookings/scheduled/' + expiring.id + '/confirm', admin, 'POST', {
      revision: expiring.revision,
      request_key: randomUUID(),
    });
    assert.ok([409].includes(expired.status));
    assert.ok(
      (await api(slotsPath, admin)).body.data.slots.some(
        (s: { start_at: string }) => s.start_at === slots[3]!.start_at,
      ),
    );
    expectOK(await api('availability/settings', admin, 'PUT', { hold_seconds: 300 }));
    // Simulate process loss after a durable confirmation intent, using only the owning database in this test fixture.
    let recovery = (await api('bookings/scheduled', admin, 'POST', make(slots[4]!.start_at))).body
      .data;
    const db = new pg.Pool({ connectionString: env('booking-service').DATABASE_URL });
    try {
      await db.query(
        "UPDATE scheduled_bookings SET pending_action='CONFIRM',operation_id=$2,updated_at=now()-interval '10 seconds' WHERE id=$1",
        [recovery.id, randomUUID()],
      );
    } finally {
      await db.end();
    }
    for (let i = 0; i < 30; i++) {
      recovery = (await api('bookings/scheduled?period=future', admin)).body.data.find(
        (b: { id: string }) => b.id === recovery.id,
      );
      if (recovery.status === 'CONFIRMED') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(recovery.status, 'CONFIRMED');
    console.log('Durable confirmation intent recovered by worker.');
    // Calendar cache invalidates for holidays and exceptions without cancelling existing reservations.
    const holiday = await api('availability/holidays', admin, 'POST', {
      title: 'Test closure',
      timezone: 'UTC',
      calendar: 'iso8601',
      start_date: from.slice(0, 10),
      end_date: from.slice(0, 10),
      annual: false,
    });
    expectOK(holiday);
    assert.equal((await api(slotsPath, admin)).body.data.slots.length, 0);
    expectOK(
      await api('availability/holidays/' + holiday.body.data.id + '/remove', admin, 'POST', {}),
    );
    assert.ok((await api(slotsPath, admin)).body.data.slots.length > 0);
    const exception = await api('availability/exceptions', expert, 'POST', {
      kind: 'UNAVAILABLE',
      title: 'Test personal time',
      start_at: slots[5]!.start_at,
      end_at: slots[6]!.end_at,
    });
    expectOK(exception);
    assert.ok(
      !(await api(slotsPath, admin)).body.data.slots.some(
        (s: { start_at: string }) => s.start_at === slots[5]!.start_at,
      ),
    );
    expectOK(
      await api(
        'availability/exceptions/' + exception.body.data.id + '/remove',
        expert,
        'POST',
        {},
      ),
    );
    const search = await api(
      'availability/search?' +
        new URLSearchParams({ at: slots[5]!.start_at, timezone: 'Asia/Tehran' }),
      admin,
    );
    expectOK(search);
    assert.ok(search.body.data.some((s: { service_id: string }) => s.service_id === serviceId));
    calendar = (await api('availability/calendar', expert)).body.data;
    expectOK(
      await api('availability/calendar', expert, 'PUT', {
        ...working,
        revision: calendar.revision,
        cancellation_hours: 720,
      }),
    );
    let protectedBooking = (
      await api('bookings/scheduled', admin, 'POST', make(slots[5]!.start_at))
    ).body.data;
    protectedBooking = (
      await api('bookings/scheduled/' + protectedBooking.id + '/confirm', admin, 'POST', {
        revision: protectedBooking.revision,
        request_key: randomUUID(),
      })
    ).body.data;
    assert.equal(
      (
        await api('bookings/scheduled/' + protectedBooking.id + '/cancel', admin, 'POST', {
          revision: protectedBooking.revision,
          request_key: randomUUID(),
        })
      ).body.error.code,
      'CANCELLATION_CUTOFF',
    );
    expectOK(
      await api('bookings/scheduled/' + protectedBooking.id + '/cancel', expert, 'POST', {
        revision: protectedBooking.revision,
        request_key: randomUUID(),
      }),
    );
    const auditDb = new pg.Pool({ connectionString: env('booking-service').DATABASE_URL });
    try {
      const actor = (
        await auditDb.query(
          "SELECT actor_id FROM booking_events WHERE booking_id=$1 AND event='CANCELLED' ORDER BY created_at DESC LIMIT 1",
          [protectedBooking.id],
        )
      ).rows[0];
      assert.equal(
        actor.actor_id,
        scholar.account_id,
        'Expert initiated cancellation retains the expert actor',
      );
    } finally {
      await auditDb.end();
    }
    calendar = (await api('availability/calendar', expert)).body.data;
    expectOK(
      await api('availability/calendar', expert, 'PUT', {
        ...working,
        revision: calendar.revision,
      }),
    );
    const notes = await api('bookings/notifications', admin);
    expectOK(notes);
    assert.ok(notes.body.data.some((n: { event: string }) => n.event === 'CONFIRMED'));
    let sent = false;
    for (let i = 0; i < 180 && !sent; i++) {
      const mail = await fetch('http://mailpit:8025/api/v1/messages?limit=500').then((r) =>
        r.json(),
      );
      sent = mail.messages?.some(
        (m: { Subject: string; To: { Address: string }[] }) =>
          m.Subject?.includes('Booking confirmed') &&
          m.To?.some((to) => to.Address === fixture.admin.email),
      );
      if (!sent) await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(sent, 'Booking confirmation delivered through real SMTP');
    writeFileSync(
      '/test-output/scheduling-browser.json',
      JSON.stringify({
        admin: fixture.admin,
        expert: fixture.expert,
        expertCode,
        serviceId,
        serviceTitle: offering.title,
        date: from.slice(0, 10),
        recoveryId: recovery.id,
      }),
      { mode: 0o600 },
    );
  },
);
