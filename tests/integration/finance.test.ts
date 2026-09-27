import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHmac } from 'node:crypto';
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
test(
  'stage 11 server finance: provider contracts, 100 callbacks, concurrent booking, refunds and 1000 balanced journals',
  { skip: process.env.FINANCE_TEST !== '1', timeout: 600000 },
  async () => {
    const config = env('identity-auth');
    assert.equal(config.AUTH_DEVELOPMENT, '1');
    assert.equal(config.AUTH_PUBLIC_URL, 'http://127.0.0.1:18886/vianoor');
    const fixture = JSON.parse(readFileSync('/test-output/scholars-browser.json', 'utf8'));
    const headers = {
      'content-type': 'application/json',
      'x-internal-key': config.AUTH_INTERNAL_KEY!,
    };
    const call = async (port: number, path: string, token = '', method = 'GET', body?: unknown) => {
      const r = await fetch('http://127.0.0.1:' + port + path, {
        method,
        headers: { ...headers, authorization: 'Bearer ' + token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    };
    const api = (path: string, token = '', method = 'GET', body?: unknown) =>
      call(4100, '/api/v2/' + path, token, method, body);
    const ok = (r: { status: number; body: unknown }) =>
      assert.equal(r.status, 200, JSON.stringify(r.body));
    const login = async (account: unknown) => {
      const r = await fetch('http://127.0.0.1:4100/api/v1/auth/login', {
        method: 'POST',
        headers: { ...headers, 'x-auth-client': 'finance-' + randomUUID() },
        body: JSON.stringify(account),
      });
      assert.equal(r.status, 200);
      return (await r.json()).data.access as string;
    };
    const admin = await login(fixture.admin),
      expert = await login(fixture.expert),
      adminPrincipal = (await call(4101, '/internal/principal', admin)).body.data,
      expertPrincipal = (await call(4101, '/internal/principal', expert)).body.data;
    ok(
      await api('finance/settings', admin, 'POST', {
        commission_bps: 2000,
        release_hours: 0,
        max_hourly_attempts: 100,
        max_topup_minor: '1000000',
      }),
    );
    ok(await api('finance/risk', admin, 'POST', { review_spikes: false }));
    assert.equal((await api('finance/gateways', expert)).status, 403);
    assert.equal((await api('accounting/ledger', expert)).status, 403);
    const credentials: Record<string, Record<string, string>> = {
      stripe: { secret_key: 'sk_test_synthetic', webhook_secret: 'synthetic-stripe-secret' },
      paypal: {
        client_id: 'synthetic-client',
        client_secret: 'synthetic-secret',
        webhook_id: 'synthetic-webhook',
      },
      nowpayments: {
        api_key: 'synthetic-api',
        ipn_secret: 'synthetic-ipn',
        payout_email: 'test@example.invalid',
        payout_password: 'synthetic-password',
      },
    };
    const gatewayIds: Record<string, string> = {};
    for (const provider of ['stripe', 'paypal', 'nowpayments']) {
      const r = await api('finance/gateways', admin, 'POST', {
        provider,
        mode: 'TEST',
        enabled: false,
        currencies: ['USD', 'EUR', 'USDT', 'BTC', 'ETH'],
        countries: [],
        credentials: credentials[provider],
      });
      ok(r);
      gatewayIds[provider] = r.body.data.id;
      ok(await api('finance/gateways/' + r.body.data.id + '/test', admin, 'POST', {}));
      ok(
        await api('finance/gateways/' + r.body.data.id + '/toggle', admin, 'POST', {
          enabled: true,
        }),
      );
    }
    const visible = await api('finance/gateways', admin);
    ok(visible);
    assert.ok(!JSON.stringify(visible.body).includes('synthetic-secret'));
    const topupRequest = {
      request_key: randomUUID(),
      provider: 'stripe',
      amount: '100000',
      currency: 'USD',
    };
    const topup = await api('payments/create', admin, 'POST', topupRequest);
    ok(topup);
    const paid = await api('payments/' + topup.body.data.id + '/reconcile', admin, 'POST', {});
    ok(paid);
    assert.equal(paid.body.data.status, 'SUCCESS');
    assert.equal(
      (await api('payments/create', admin, 'POST', topupRequest)).body.data.id,
      topup.body.data.id,
    );
    const retryRequest = {
      request_key: randomUUID(),
      provider: 'stripe',
      amount: '100',
      currency: 'USD',
      locale: 'fa',
    };
    const retries = await Promise.all(
      Array.from({ length: 20 }, () => api('payments/create', admin, 'POST', retryRequest)),
    );
    retries.forEach(ok);
    assert.equal(new Set(retries.map((r) => r.body.data.id)).size, 1);
    console.log('PASS 20 concurrent retries reuse one payment.');
    const pool = new pg.Pool({ connectionString: env('accounting-service').DATABASE_URL }),
      payments = new pg.Pool({ connectionString: env('payment-service').DATABASE_URL }),
      bookingPool = new pg.Pool({ connectionString: env('booking-service').DATABASE_URL });
    try {
      const providerRef = (
          await payments.query('SELECT reference FROM payments WHERE id=$1', [topup.body.data.id])
        ).rows[0].reference,
        raw = JSON.stringify({
          id: 'evt_' + randomUUID(),
          type: 'checkout.session.completed',
          data: { object: { id: providerRef, object: 'checkout.session' } },
        }),
        timestamp = String(Math.floor(Date.now() / 1000)),
        signature = createHmac('sha256', credentials.stripe!.webhook_secret!)
          .update(timestamp + '.' + raw)
          .digest('hex'),
        event = {
          gateway_id: gatewayIds.stripe,
          raw: Buffer.from(raw).toString('base64'),
          headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
        };
      const callbacks = await Promise.all(
        Array.from({ length: 100 }, () =>
          call(4114, '/internal/payment/webhook', '', 'POST', event),
        ),
      );
      callbacks.forEach(ok);
      assert.equal(
        (
          await pool.query('SELECT count(*)::int AS n FROM journals WHERE reference=$1', [
            topup.body.data.id,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await payments.query(
            'SELECT count(*)::int AS n FROM payment_webhooks WHERE gateway_id=$1 AND event_id=$2',
            [gatewayIds.stripe, JSON.parse(raw).id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await call(4114, '/internal/payment/webhook', '', 'POST', {
            ...event,
            headers: { 'stripe-signature': 't=1,v1=bad' },
          })
        ).status,
        401,
      );
      console.log('PASS 100 duplicate signed callbacks: one payment and one journal.');
      const paypal = await api('payments/create', admin, 'POST', {
        request_key: randomUUID(),
        provider: 'paypal',
        amount: '1000',
        currency: 'USD',
      });
      ok(paypal);
      const pp = await api('payments/' + paypal.body.data.id + '/reconcile', admin, 'POST', {});
      ok(pp);
      assert.equal(pp.body.data.status, 'SUCCESS');
      const crypto = await api('payments/create', admin, 'POST', {
        request_key: randomUUID(),
        provider: 'nowpayments',
        amount: '1000',
        currency: 'USD',
        network: 'usdttrc20',
      });
      ok(crypto);
      const cref = (
        await payments.query('SELECT reference FROM payments WHERE id=$1', [crypto.body.data.id])
      ).rows[0].reference;
      const control = async (reference: string, change: Record<string, unknown>) => {
        const r = await fetch('http://127.0.0.1:4199/control', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reference, ...change }),
        });
        assert.equal(r.status, 200);
      };
      await control(cref, { payment_status: 'partially_paid' });
      const partial = await api(
        'payments/' + crypto.body.data.id + '/reconcile',
        admin,
        'POST',
        {},
      );
      ok(partial);
      assert.equal(partial.body.data.status, 'PARTIAL');
      assert.equal(
        (
          await pool.query('SELECT count(*)::int AS n FROM journals WHERE reference=$1', [
            crypto.body.data.id,
          ])
        ).rows[0].n,
        0,
      );
      await control(cref, { payment_status: 'expired' });
      assert.equal(
        (await api('payments/' + crypto.body.data.id + '/reconcile', admin, 'POST', {})).body.data
          .status,
        'EXPIRED',
      );
      await control(cref, { payment_status: 'finished' });
      const cryptoPaid = await api(
        'payments/' + crypto.body.data.id + '/reconcile',
        admin,
        'POST',
        {},
      );
      ok(cryptoPaid);
      assert.equal(cryptoPaid.body.data.status, 'SUCCESS');
      let scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
      if (scholar.status !== 'APPROVED') {
        for (const status of ['UNDER_REVIEW', 'APPROVED']) {
          ok(
            await api('experts/admin/' + fixture.scholarId + '/review', admin, 'POST', {
              status,
              revision: scholar.revision,
              reason: 'Synthetic finance fixture',
              internal_note: '',
              valid_until: null,
            }),
          );
          scholar = (await api('experts/admin/' + fixture.scholarId, admin)).body.data;
        }
      }
      const service = await api('experts/me/services', expert, 'POST', {
        title: 'Paid finance acceptance ' + randomUUID().slice(0, 6),
        summary: 'Synthetic fixture',
        description: 'Finance acceptance only',
        kind: 'VIDEO',
        specialty_id: scholar.profile.specialties[0],
        category_id: null,
        duration_minutes: 30,
        price_minor: 1000,
        currency: 'USD',
        booking_required: true,
        image_id: null,
        terms: 'Synthetic fixture',
      });
      ok(service);
      const serviceId = service.body.data.id;
      ok(await api('experts/me/services/' + serviceId + '/publish', expert, 'POST', {}));
      ok(
        await api(
          'experts/admin/' + fixture.scholarId + '/services/' + serviceId + '/review',
          admin,
          'POST',
          { status: 'PUBLISHED', reason: 'Test approval', revision: 1 },
        ),
      );
      const cal = (await api('availability/calendar', expert)).body.data;
      ok(
        await api('availability/calendar', expert, 'PUT', {
          timezone: 'UTC',
          weekly: Array.from({ length: 7 }, (_, i) => ({
            day: i + 1,
            start: '09:00',
            end: '18:00',
          })),
          breaks: [],
          buffer_before: 0,
          buffer_after: 0,
          min_notice_minutes: 0,
          horizon_days: 90,
          cancellation_hours: 0,
          revision: cal.revision,
        }),
      );
      const day = new Date();
      day.setUTCDate(day.getUTCDate() + 10);
      day.setUTCHours(0, 0, 0, 0);
      const slots = await api(
        'availability/slots?' +
          new URLSearchParams({
            expert: scholar.public_id,
            service: serviceId,
            from: day.toISOString(),
            to: new Date(+day + 86400000).toISOString(),
            timezone: 'UTC',
          }),
        admin,
      );
      ok(slots);
      assert.ok(slots.body.data.slots.length >= 3);
      const book = async (index: number) => {
        const r = await api('bookings/scheduled', admin, 'POST', {
          request_key: randomUUID(),
          expert: scholar.public_id,
          service: serviceId,
          start_at: slots.body.data.slots[index].start_at,
          timezone: 'UTC',
        });
        ok(r);
        assert.equal(r.body.data.status, 'BOOKING_PENDING_PAYMENT');
        return r.body.data;
      };
      const b = await book(0);
      assert.equal(
        (
          await api('bookings/scheduled/' + b.id + '/confirm', admin, 'POST', {
            request_key: randomUUID(),
            revision: b.revision,
          })
        ).body.error.code,
        'PAYMENT_REQUIRED',
      );
      const race = await Promise.all(
        Array.from({ length: 100 }, () =>
          api('payments/create', admin, 'POST', {
            request_key: randomUUID(),
            provider: 'wallet',
            booking_id: b.id,
          }),
        ),
      );
      assert.equal(
        race.filter((r) => r.status === 200).length,
        1,
        JSON.stringify(race.map((r) => ({ status: r.status, error: r.body.error }))),
      );
      assert.equal(race.filter((r) => r.body.error?.code === 'BOOKING_ALREADY_PAID').length, 99);
      const winning = race.find((r) => r.status === 200)!.body.data;
      assert.equal(winning.status, 'SUCCESS');
      const bs = await call(4109, '/internal/bookings/financial-state/' + b.id);
      assert.equal(bs.body.data.status, 'CONFIRMED');
      console.log('PASS 100 concurrent booking payments: one success, 99 BOOKING_ALREADY_PAID.');
      const refund = await api('payments/' + winning.id + '/refund', admin, 'POST', {
        target: 'WALLET',
        reason: 'CANCELLED',
      });
      ok(refund);
      const approved = await api(
        'finance/refunds/' + refund.body.data.id + '/approve',
        admin,
        'POST',
        {},
      );
      ok(approved);
      assert.equal(approved.body.data.status, 'COMPLETED');
      ok(await api('finance/refunds/' + refund.body.data.id + '/approve', admin, 'POST', {}));
      assert.equal(
        (await call(4109, '/internal/bookings/financial-state/' + b.id)).body.data.status,
        'CANCELLED',
      );
      const lateBooking = await book(1),
        late = await api('payments/create', admin, 'POST', {
          request_key: randomUUID(),
          provider: 'stripe',
          booking_id: lateBooking.id,
        });
      ok(late);
      await bookingPool.query(
        "UPDATE scheduled_bookings SET expires_at=now()-interval '1 second' WHERE id=$1",
        [lateBooking.id],
      );
      const latePaid = await api('payments/' + late.body.data.id + '/reconcile', admin, 'POST', {});
      ok(latePaid);
      assert.equal(latePaid.body.data.fulfillment, 'CREDITED_LATE');
      console.log('PASS late payment credited to wallet without resurrecting an expired booking.');
      const rate = await api('accounting/rates', admin, 'POST', {
        base: 'USD',
        quote: 'EUR',
        numerator: '9',
        denominator: '10',
        valid_until: new Date(Date.now() + 3600000).toISOString(),
        source: 'Synthetic acceptance rate',
      });
      ok(rate);
      const fx = await api('accounting/quotes', admin, 'POST', {
        base: 'USD',
        quote: 'EUR',
        amount: '100',
      });
      ok(fx);
      assert.equal(fx.body.data.target_minor, '90');
      ok(await api('wallet/exchange', admin, 'POST', { quote_id: fx.body.data.id }));
      ok(await api('wallet/exchange', admin, 'POST', { quote_id: fx.body.data.id }));
      const owner = randomUUID();
      for (let batch = 0; batch < 40; batch++) {
        const results = await Promise.all(
          Array.from({ length: 25 }, () => {
            const id = randomUUID();
            return call(4116, '/internal/accounting/post', '', 'POST', {
              key: 'load:' + id,
              reference: id,
              description: 'TOPUP',
              lines: [
                { owner: null, kind: 'PROVIDER', currency: 'USD', debit: '1', credit: '0' },
                { owner, kind: 'AVAILABLE', currency: 'USD', debit: '0', credit: '1' },
              ],
            });
          }),
        );
        results.forEach(ok);
      }
      assert.equal(
        (
          await pool.query(
            "SELECT balance::text FROM ledger_accounts WHERE owner_id=$1 AND currency='USD' AND kind='AVAILABLE'",
            [owner],
          )
        ).rows[0].balance,
        '1000',
      );
      const balances = await api('accounting/trial-balance', admin);
      ok(balances);
      for (const row of balances.body.data) assert.equal(row.debit, row.credit);
      console.log('PASS 1000 real ledger transactions: every currency balanced.');
      await assert.rejects(
        () =>
          pool.query(
            'UPDATE ledger_entries SET debit=debit+1 WHERE id=(SELECT min(id) FROM ledger_entries)',
          ),
        /IMMUTABLE_LEDGER/,
      );
      const unbalanced = await call(4116, '/internal/accounting/post', '', 'POST', {
        key: 'bad:' + randomUUID(),
        reference: randomUUID(),
        description: 'TOPUP',
        lines: [
          { owner: null, kind: 'PROVIDER', currency: 'USD', debit: '2', credit: '0' },
          { owner, kind: 'AVAILABLE', currency: 'USD', debit: '0', credit: '1' },
        ],
      });
      assert.equal(unbalanced.status, 400);
      const earnedBooking = await book(2),
        earned = await api('payments/create', admin, 'POST', {
          request_key: randomUUID(),
          provider: 'wallet',
          booking_id: earnedBooking.id,
        });
      ok(earned);
      await bookingPool.query(
        "UPDATE scheduled_bookings SET end_at=now()-interval '1 minute' WHERE id=$1",
        [earnedBooking.id],
      );
      const earnedState = (await api('bookings/scheduled?view=expert', expert)).body.data.find(
        (x: { id: string }) => x.id === earnedBooking.id,
      );
      ok(
        await api('bookings/scheduled/' + earnedBooking.id + '/complete', expert, 'POST', {
          request_key: randomUUID(),
          revision: earnedState.revision,
        }),
      );
      ok(await api('finance/reconcile', admin, 'POST', {}));
      assert.ok(
        (
          await payments.query('SELECT released_at FROM payments WHERE id=$1', [
            earned.body.data.id,
          ])
        ).rows[0].released_at,
      );
      const disputedBooking = await book(3),
        disputedPayment = await api('payments/create', admin, 'POST', {
          request_key: randomUUID(),
          provider: 'wallet',
          booking_id: disputedBooking.id,
        });
      ok(disputedPayment);
      const dispute = await api('disputes', admin, 'POST', {
        booking_id: disputedBooking.id,
        reason: 'QUALITY',
      });
      ok(dispute);
      ok(
        await api('disputes/' + dispute.body.data.id + '/messages', admin, 'POST', {
          message: 'Synthetic test evidence',
          attachments: [],
        }),
      );
      assert.equal(
        (await api('disputes/' + dispute.body.data.id + '/messages', expert)).body.data[0].message,
        'Synthetic test evidence',
      );
      ok(await api('finance/reconcile', admin, 'POST', {}));
      assert.equal(
        (
          await payments.query('SELECT released_at FROM payments WHERE id=$1', [
            disputedPayment.body.data.id,
          ])
        ).rows[0].released_at,
        null,
      );
      ok(
        await api('disputes/' + dispute.body.data.id + '/resolve', admin, 'POST', {
          decision: 'REFUND_WALLET',
        }),
      );
      assert.equal(
        (await api('payments/' + disputedPayment.body.data.id, admin)).body.data.status,
        'REFUNDED',
      );
      const originalRefund = await api(
        'payments/' + topup.body.data.id + '/refund',
        admin,
        'POST',
        { target: 'ORIGINAL', reason: 'OTHER' },
      );
      ok(originalRefund);
      ok(
        await api('finance/refunds/' + originalRefund.body.data.id + '/approve', admin, 'POST', {}),
      );
      console.log(
        'PASS earned funds release, dispute messages/escrow/refund and original-method card refund.',
      );
      const grant = await call(4115, '/internal/wallet/execute', '', 'POST', {
        key: 'expert-fixture:' + randomUUID(),
        reference: randomUUID(),
        action: 'TOPUP',
        account_id: expertPrincipal.id,
        amount: '1000',
        currency: 'USD',
      });
      ok(grant);
      const destination = await api('payouts/destinations', expert, 'POST', {
        method: 'PAYPAL',
        email: 'synthetic-payee@example.invalid',
      });
      ok(destination);
      const withdraw = await api('payouts/withdrawals', expert, 'POST', {
        request_key: randomUUID(),
        destination_id: destination.body.data.id,
        amount: '100',
        currency: 'USD',
      });
      ok(withdraw);
      const settled = await api(
        'payouts/admin/' + withdraw.body.data.id + '/approve',
        admin,
        'POST',
        {},
      );
      ok(settled);
      assert.equal(settled.body.data.status, 'COMPLETED');
      assert.equal(
        (await api('payouts/admin/' + withdraw.body.data.id + '/details', admin, 'POST', {})).body
          .data.email,
        'synthetic-payee@example.invalid',
      );
      assert.equal((await api('payouts/admin', expert)).status, 403);
      const bank = await api('payouts/destinations', admin, 'POST', {
        method: 'BANK',
        country: 'US',
        bank: 'Synthetic Bank',
        account: 'TEST000012345',
        holder: 'Synthetic fixture',
      });
      ok(bank);
      const bankWithdrawal = await api('payouts/withdrawals', admin, 'POST', {
        request_key: randomUUID(),
        destination_id: bank.body.data.id,
        amount: '10',
        currency: 'USD',
      });
      ok(bankWithdrawal);
      for (const action of ['approve', 'process'])
        ok(
          await api(
            'payouts/admin/' + bankWithdrawal.body.data.id + '/' + action,
            admin,
            'POST',
            {},
          ),
        );
      const bankDone = await api(
        'payouts/admin/' + bankWithdrawal.body.data.id + '/complete-bank',
        admin,
        'POST',
        { reference: 'synthetic-bank-receipt' },
      );
      ok(bankDone);
      assert.equal(bankDone.body.data.status, 'COMPLETED');
      ok(
        await call(4115, '/internal/wallet/execute', '', 'POST', {
          key: 'crypto-fixture:' + randomUUID(),
          reference: randomUUID(),
          action: 'TOPUP',
          account_id: adminPrincipal.id,
          amount: '2000000',
          currency: 'USDT',
        }),
      );
      const cryptoDestination = await api('payouts/destinations', admin, 'POST', {
        method: 'CRYPTO',
        network: 'usdttrc20',
        address: 'TSyntheticAddress123456789000000000',
      });
      ok(cryptoDestination);
      const cryptoWithdrawal = await api('payouts/withdrawals', admin, 'POST', {
        request_key: randomUUID(),
        destination_id: cryptoDestination.body.data.id,
        amount: '1000000',
        currency: 'USDT',
      });
      ok(cryptoWithdrawal);
      ok(
        await api('payouts/admin/' + cryptoWithdrawal.body.data.id + '/approve', admin, 'POST', {}),
      );
      ok(
        await api('payouts/admin/' + cryptoWithdrawal.body.data.id + '/verify', admin, 'POST', {
          code: '123456',
        }),
      );
      const cryptoDone = await api(
        'payouts/admin/' + cryptoWithdrawal.body.data.id + '/reconcile',
        admin,
        'POST',
        {},
      );
      ok(cryptoDone);
      assert.equal(cryptoDone.body.data.status, 'COMPLETED');
      console.log('PASS customer bank withdrawal and crypto payout/2FA contracts.');
      writeFileSync(
        '/test-output/finance-browser.json',
        JSON.stringify({
          admin: fixture.admin,
          expert: fixture.expert,
          payment_id: topup.body.data.id,
          account_id: adminPrincipal.id,
        }),
      );
      console.log(
        'PASS encrypted gateway/destination access, wallet, FX snapshot, refund and PayPal payout contracts. External network providers were simulated, not live.',
      );
    } finally {
      await Promise.all([pool.end(), payments.end(), bookingPool.end()]);
    }
  },
);
