// Explicit test double for provider contract tests. Never imported in the deployed services.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
export async function startProviderFixture() {
  if (process.env.FINANCE_ADAPTER_TEST !== '1' || process.env.AUTH_DEVELOPMENT !== '1')
    throw Error('Isolated adapter test only');
  const payments = new Map(),
    idempotency = new Map(),
    refunds = new Map(),
    payouts = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    let body = {};
    try {
      body = raw
        ? req.headers['content-type']?.includes('urlencoded')
          ? Object.fromEntries(new URLSearchParams(raw))
          : JSON.parse(raw)
        : {};
    } catch {
      res.writeHead(400).end();
      return;
    }
    const path = req.url.split('?')[0];
    const send = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    };
    if (path === '/control') {
      const p = payments.get(body.reference);
      if (!p) return send({ error: 'missing' }, 404);
      Object.assign(p, body);
      return send({ ok: true });
    }
    if (path === '/stripe/v1/account') return send({ charges_enabled: true, country: 'US' });
    if (path === '/stripe/v1/checkout/sessions' && req.method === 'POST') {
      const key = req.headers['idempotency-key'];
      if (idempotency.has(key)) return send(idempotency.get(key));
      const id = 'cs_' + randomUUID(),
        p = {
          id,
          object: 'checkout.session',
          amount_total: Number(body['line_items[0][price_data][unit_amount]']),
          currency: body['line_items[0][price_data][currency]'],
          client_reference_id: body.client_reference_id,
          url: 'https://checkout.stripe.com/test/' + id,
          status: 'complete',
          payment_intent: { id: 'pi_' + randomUUID(), status: 'requires_capture' },
        };
      payments.set(id, p);
      idempotency.set(key, p);
      return send(p);
    }
    if (path.startsWith('/stripe/v1/checkout/sessions/'))
      return send(payments.get(path.split('/').at(-1)) ?? {}, 200);
    if (path.startsWith('/stripe/v1/payment_intents/')) {
      const id = path.split('/')[4],
        p = [...payments.values()].find((x) => x.payment_intent?.id === id);
      if (!p) return send({}, 404);
      p.payment_intent.status = 'succeeded';
      return send(p.payment_intent);
    }
    if (path === '/stripe/v1/refunds') {
      const key = req.headers['idempotency-key'];
      if (!refunds.has(key)) refunds.set(key, { id: 're_' + randomUUID(), status: 'succeeded' });
      return send(refunds.get(key));
    }
    if (path === '/paypal/v1/oauth2/token') return send({ access_token: 'isolated-test-token' });
    if (path === '/paypal/v1/notifications/verify-webhook-signature')
      return send({
        verification_status: body.transmission_sig === 'test-signature' ? 'SUCCESS' : 'FAILURE',
      });
    if (path === '/paypal/v2/checkout/orders' && req.method === 'POST') {
      const key = req.headers['paypal-request-id'];
      if (idempotency.has(key)) return send(idempotency.get(key));
      const id = 'ORDER-' + randomUUID(),
        p = {
          id,
          status: 'APPROVED',
          purchase_units: body.purchase_units,
          links: [
            { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id },
          ],
        };
      payments.set(id, p);
      idempotency.set(key, p);
      return send(p);
    }
    if (path.startsWith('/paypal/v2/checkout/orders/')) {
      const id = path.split('/')[5],
        p = payments.get(id);
      if (!p) return send({}, 404);
      if (path.endsWith('/capture')) {
        p.status = 'COMPLETED';
        p.purchase_units[0].payments = {
          captures: [{ id: 'CAP-' + id, status: 'COMPLETED', amount: p.purchase_units[0].amount }],
        };
      }
      return send(p);
    }
    if (path.startsWith('/paypal/v2/payments/captures/') && path.endsWith('/refund'))
      return send({ id: 'RF-' + req.headers['paypal-request-id'], status: 'COMPLETED' });
    if (path === '/paypal/v1/payments/payouts' && req.method === 'POST') {
      const id = body.sender_batch_header.sender_batch_id;
      payouts.set(id, { items: [{ transaction_status: 'SUCCESS' }] });
      return send({ batch_header: { payout_batch_id: id } });
    }
    if (path.startsWith('/paypal/v1/payments/payouts/'))
      return send(payouts.get(path.split('/').at(-1)) ?? {});
    if (path === '/nowpayments/v1/balance') return send({ btc: { amount: 1 } });
    if (path === '/nowpayments/v1/payment' && req.method === 'POST') {
      const id = String(Date.now()) + String(payments.size),
        p = {
          payment_id: id,
          payment_status: 'waiting',
          price_amount: body.price_amount,
          price_currency: body.price_currency,
          pay_address: 'SyntheticAddressDoNotSendRealFunds',
          pay_amount: '1.000000',
          pay_currency: body.pay_currency,
          order_id: body.order_id,
        };
      payments.set(id, p);
      return send(p);
    }
    if (path.startsWith('/nowpayments/v1/payment/'))
      return send(payments.get(path.split('/').at(-1)) ?? {}, 200);
    if (path === '/nowpayments/v1/auth') return send({ token: 'test-payout-token' });
    if (path === '/nowpayments/v1/payout/validate-address') return send({ status: true });
    if (path === '/nowpayments/v1/payout' && req.method === 'POST') {
      const id = randomUUID(),
        item = randomUUID();
      payouts.set(item, { status: 'waiting' });
      payouts.set(id, { item });
      return send({ id, withdrawals: [{ id: item }] });
    }
    if (path.startsWith('/nowpayments/v1/payout/') && path.endsWith('/verify')) {
      const batch = payouts.get(path.split('/').at(-2));
      if (batch?.item) payouts.set(batch.item, { status: 'finished' });
      return send({ ok: true });
    }
    if (path.startsWith('/nowpayments/v1/payout/'))
      return send(payouts.get(path.split('/').at(-1)) ?? {});
    return send({ error: 'TEST_ENDPOINT_NOT_IMPLEMENTED' }, 404);
  });
  await new Promise((resolve) => server.listen(4199, '127.0.0.1', resolve));
  return server;
}
