import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ServiceError } from '@vianoor/service-runtime';
export type Gateway = {
  id: string;
  provider: 'stripe' | 'paypal' | 'nowpayments';
  mode: 'TEST' | 'LIVE';
  countries?: string[];
  credentials: Record<string, string>;
};
export type PaymentRequest = {
  id: string;
  amount: string;
  currency: string;
  decimals: number;
  return_url: string;
  callback_url: string;
  network?: string;
};
export type ProviderResult = {
  reference: string;
  state: 'PENDING' | 'AUTHORIZED' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PARTIAL' | 'EXPIRED';
  amount: string;
  currency: string;
  capture_reference?: string;
  checkout_url?: string;
  address?: string;
  crypto_amount?: string;
  network?: string;
  payment_id?: string;
  country?: string;
  card_country?: string;
};
export function decimal(minor: string, places: number) {
  const s = minor.padStart(places + 1, '0');
  return places ? s.slice(0, -places) + '.' + s.slice(-places) : s;
}
export function toMinor(value: string, places: number) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new ServiceError(502, 'PROVIDER_AMOUNT_INVALID');
  const [whole, part = ''] = value.split('.');
  if (part.length > places && /[1-9]/.test(part.slice(places)))
    throw new ServiceError(502, 'PROVIDER_AMOUNT_INVALID');
  return (
    BigInt(whole!) * 10n ** BigInt(places) +
    BigInt(part.slice(0, places).padEnd(places, '0') || '0')
  ).toString();
}
const object = z.record(z.string(), z.unknown());
const text = (x: unknown) => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '');
const rec = (x: unknown): Record<string, unknown> => object.parse(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const networkCodes: Record<string, { coin: string; network: string }> = {
  usdttrc20: { coin: 'USDT', network: 'TRON' },
  usdterc20: { coin: 'USDT', network: 'Ethereum' },
  usdtbsc: { coin: 'USDT', network: 'BSC' },
  usdtmatic: { coin: 'USDT', network: 'Polygon' },
  usdcmatic: { coin: 'USDC', network: 'Polygon' },
  usdc: { coin: 'USDC', network: 'Ethereum' },
  btc: { coin: 'BTC', network: 'Bitcoin' },
  eth: { coin: 'ETH', network: 'Ethereum' },
};
function base(g: Gateway) {
  if (
    process.env.FINANCE_ADAPTER_TEST === '1' &&
    process.env.AUTH_DEVELOPMENT === '1' &&
    process.env.FINANCE_TEST_PROVIDER_URL?.startsWith('http://127.0.0.1:')
  )
    return process.env.FINANCE_TEST_PROVIDER_URL + '/' + g.provider;
  return g.provider === 'stripe'
    ? 'https://api.stripe.com'
    : g.provider === 'paypal'
      ? g.mode === 'TEST'
        ? 'https://api-m.sandbox.paypal.com'
        : 'https://api-m.paypal.com'
      : g.mode === 'TEST'
        ? 'https://api-sandbox.nowpayments.io'
        : 'https://api.nowpayments.io';
}
async function request(
  g: Gateway,
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extra };
  let payload: string | undefined;
  if (g.provider === 'stripe') {
    headers.authorization = 'Bearer ' + g.credentials.secret_key;
    if (key) headers['Idempotency-Key'] = key;
    headers['Stripe-Version'] = '2025-06-30.basil';
    if (body) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body as Record<string, string>).toString();
    }
  } else {
    headers['content-type'] = 'application/json';
    if (g.provider === 'nowpayments') headers['x-api-key'] = g.credentials.api_key!;
    if (key && g.provider === 'paypal') headers['PayPal-Request-Id'] = key;
    if (body) payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(base(g) + path, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
      redirect: 'error',
      signal: AbortSignal.timeout(18000),
    });
  } catch {
    throw new ServiceError(503, 'PROVIDER_UNCERTAIN');
  }
  if (!response.ok)
    throw new ServiceError(
      response.status === 401 || response.status === 403 ? 422 : 503,
      response.status === 401 || response.status === 403
        ? 'PROVIDER_CREDENTIALS_REJECTED'
        : 'PROVIDER_UNCERTAIN',
    );
  return rec(await response.json());
}
async function paypalToken(g: Gateway) {
  let response: Response;
  try {
    response = await fetch(base(g) + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        authorization:
          'Basic ' +
          Buffer.from(g.credentials.client_id + ':' + g.credentials.client_secret).toString(
            'base64',
          ),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    throw new ServiceError(503, 'PROVIDER_UNCERTAIN');
  }
  if (!response.ok) throw new ServiceError(422, 'PROVIDER_CREDENTIALS_REJECTED');
  const token = text(rec(await response.json()).access_token);
  if (!token) throw new ServiceError(502, 'PROVIDER_INVALID_RESPONSE');
  return { authorization: 'Bearer ' + token };
}
export async function checkGateway(g: Gateway) {
  if (g.provider === 'stripe') {
    const a = await request(g, '/v1/account');
    return {
      connected: true,
      charges_enabled: a.charges_enabled === true,
      country: text(a.country),
    };
  }
  if (g.provider === 'paypal') {
    await paypalToken(g);
    return { connected: true, charges_enabled: true };
  }
  await request(g, '/v1/balance');
  return { connected: true, charges_enabled: true };
}
export async function createProviderPayment(
  g: Gateway,
  p: PaymentRequest,
): Promise<ProviderResult> {
  if (g.provider === 'stripe') {
    const d = await request(
      g,
      '/v1/checkout/sessions',
      'POST',
      {
        mode: 'payment',
        success_url: p.return_url,
        cancel_url: p.return_url,
        client_reference_id: p.id,
        'metadata[payment_id]': p.id,
        'payment_intent_data[metadata][payment_id]': p.id,
        'payment_intent_data[capture_method]': 'manual',
        'line_items[0][price_data][currency]': p.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': p.amount,
        'line_items[0][price_data][product_data][name]': 'Vianoor',
        'line_items[0][quantity]': '1',
      },
      'create-' + p.id,
    );
    return {
      reference: text(d.id),
      state: 'PENDING',
      amount: p.amount,
      currency: p.currency,
      checkout_url: text(d.url),
    };
  }
  if (g.provider === 'paypal') {
    const d = await request(
      g,
      '/v2/checkout/orders',
      'POST',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: p.id,
            custom_id: p.id,
            amount: { currency_code: p.currency, value: decimal(p.amount, p.decimals) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: p.return_url,
              cancel_url: p.return_url,
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
            },
          },
        },
      },
      p.id,
      await paypalToken(g),
    );
    const link = arr(d.links)
      .map(rec)
      .find((x) => ['payer-action', 'approve'].includes(text(x.rel)));
    return {
      reference: text(d.id),
      state: 'PENDING',
      amount: p.amount,
      currency: p.currency,
      checkout_url: text(link?.href),
    };
  }
  if (!p.network || !networkCodes[p.network]) throw new ServiceError(400, 'NETWORK_REQUIRED');
  const d = await request(
    g,
    '/v1/payment',
    'POST',
    {
      price_amount: decimal(p.amount, p.decimals),
      price_currency: p.currency.toLowerCase(),
      pay_currency: p.network,
      order_id: p.id,
      order_description: 'Vianoor',
      ipn_callback_url: p.callback_url,
      is_fixed_rate: true,
      is_fee_paid_by_user: false,
    },
    p.id,
  );
  return {
    reference: text(d.payment_id),
    state: 'PENDING',
    amount: p.amount,
    currency: p.currency,
    address: text(d.pay_address),
    crypto_amount: text(d.pay_amount),
    network: p.network,
  };
}
export async function verifyProviderPayment(
  g: Gateway,
  reference: string,
  decimals: number,
  capture = false,
): Promise<ProviderResult> {
  const ref = encodeURIComponent(reference);
  if (g.provider === 'stripe') {
    const d = await request(
      g,
      '/v1/checkout/sessions/' + ref + '?expand[]=payment_intent.latest_charge',
    );
    let intent =
      typeof d.payment_intent === 'object' && d.payment_intent ? rec(d.payment_intent) : {};
    if (capture && intent.status === 'requires_capture')
      intent = await request(
        g,
        '/v1/payment_intents/' + encodeURIComponent(text(intent.id)) + '/capture',
        'POST',
        {},
        'capture-' + reference,
      );
    const state =
      intent.status === 'succeeded'
        ? 'SUCCESS'
        : intent.status === 'requires_capture'
          ? 'AUTHORIZED'
          : d.status === 'expired' || intent.status === 'canceled'
            ? 'CANCELLED'
            : 'PENDING';
    const charge =
        intent.latest_charge && typeof intent.latest_charge === 'object'
          ? rec(intent.latest_charge)
          : {},
      card = charge.payment_method_details
        ? rec(rec(charge.payment_method_details).card ?? {})
        : {},
      address = charge.billing_details ? rec(rec(charge.billing_details).address ?? {}) : {};
    return {
      reference,
      state,
      country: text(address.country),
      card_country: text(card.country),
      amount: text(d.amount_total),
      currency: text(d.currency).toUpperCase(),
      payment_id: text(d.client_reference_id),
      capture_reference: text(intent.id),
    };
  }
  if (g.provider === 'paypal') {
    const auth = await paypalToken(g);
    let d = await request(g, '/v2/checkout/orders/' + ref, 'GET', undefined, undefined, auth);
    if (capture && d.status === 'APPROVED')
      d = await request(
        g,
        '/v2/checkout/orders/' + ref + '/capture',
        'POST',
        {},
        'capture-' + reference,
        auth,
      );
    const unit = rec(arr(d.purchase_units)[0]),
      payment = unit.payments ? rec(unit.payments) : {},
      captures = arr(payment.captures).map(rec),
      successful = captures.find((x) => x.status === 'COMPLETED'),
      money = rec(successful?.amount ?? unit.amount);
    return {
      reference,
      state: successful
        ? 'SUCCESS'
        : d.status === 'APPROVED'
          ? 'AUTHORIZED'
          : d.status === 'VOIDED'
            ? 'CANCELLED'
            : 'PENDING',
      amount: toMinor(text(money.value), decimals),
      currency: text(money.currency_code),
      payment_id: text(unit.reference_id || unit.custom_id),
      capture_reference: text(successful?.id),
    };
  }
  const d = await request(g, '/v1/payment/' + ref);
  const state =
    d.payment_status === 'finished'
      ? 'SUCCESS'
      : d.payment_status === 'partially_paid'
        ? 'PARTIAL'
        : d.payment_status === 'failed'
          ? 'FAILED'
          : d.payment_status === 'expired'
            ? 'EXPIRED'
            : 'PENDING';
  return {
    reference,
    state,
    amount: toMinor(text(d.price_amount), decimals),
    currency: text(d.price_currency).toUpperCase(),
    payment_id: text(d.order_id),
    capture_reference: reference,
    address: text(d.pay_address),
    crypto_amount: text(d.pay_amount),
    network: text(d.pay_currency),
  };
}
export async function refundProvider(
  g: Gateway,
  captureReference: string,
  amount: string,
  currency: string,
  decimals: number,
  key: string,
  reference?: string,
) {
  if (g.provider === 'stripe') {
    const d = reference
      ? await request(g, '/v1/refunds/' + encodeURIComponent(reference))
      : await request(g, '/v1/refunds', 'POST', { payment_intent: captureReference, amount }, key);
    return {
      reference: text(d.id),
      state:
        d.status === 'succeeded' ? 'COMPLETED' : d.status === 'failed' ? 'FAILED' : 'PROCESSING',
    };
  }
  if (g.provider === 'paypal') {
    const d = reference
      ? await request(
          g,
          '/v2/payments/refunds/' + encodeURIComponent(reference),
          'GET',
          undefined,
          undefined,
          await paypalToken(g),
        )
      : await request(
          g,
          '/v2/payments/captures/' + encodeURIComponent(captureReference) + '/refund',
          'POST',
          { amount: { value: decimal(amount, decimals), currency_code: currency } },
          key,
          await paypalToken(g),
        );
    return {
      reference: text(d.id),
      state:
        d.status === 'COMPLETED' ? 'COMPLETED' : d.status === 'FAILED' ? 'FAILED' : 'PROCESSING',
    };
  }
  throw new ServiceError(409, 'CRYPTO_REFUND_REQUIRES_PAYOUT');
}
export async function sendPayout(
  g: Gateway,
  d: {
    id: string;
    destination: string;
    amount: string;
    currency: string;
    decimals: number;
    network?: string | undefined;
  },
) {
  if (g.provider === 'paypal') {
    const result = await request(
      g,
      '/v1/payments/payouts',
      'POST',
      {
        sender_batch_header: { sender_batch_id: d.id, email_subject: 'Vianoor payout' },
        items: [
          {
            recipient_type: 'EMAIL',
            receiver: d.destination,
            amount: { value: decimal(d.amount, d.decimals), currency: d.currency },
            sender_item_id: d.id,
          },
        ],
      },
      d.id,
      await paypalToken(g),
    );
    const header = rec(result.batch_header);
    return { reference: text(header.payout_batch_id), item_reference: '', status: 'PROCESSING' };
  }
  if (g.provider !== 'nowpayments' || !d.network || networkCodes[d.network]?.coin !== d.currency)
    throw new ServiceError(400, 'PAYOUT_CURRENCY_MISMATCH');
  await request(g, '/v1/payout/validate-address', 'POST', {
    address: d.destination,
    currency: d.network,
  });
  const auth = await request(g, '/v1/auth', 'POST', {
    email: g.credentials.payout_email,
    password: g.credentials.payout_password,
  });
  const result = await request(
    g,
    '/v1/payout',
    'POST',
    {
      withdrawals: [
        { address: d.destination, currency: d.network, amount: decimal(d.amount, d.decimals) },
      ],
    },
    undefined,
    { authorization: 'Bearer ' + text(auth.token) },
  );
  const item = rec(arr(result.withdrawals)[0]);
  return { reference: text(result.id), item_reference: text(item.id), status: 'PROCESSING' };
}
export async function verifyPayoutCode(g: Gateway, reference: string, code: string) {
  if (g.provider !== 'nowpayments') throw new ServiceError(400, 'INVALID_PROVIDER');
  const auth = await request(g, '/v1/auth', 'POST', {
    email: g.credentials.payout_email,
    password: g.credentials.payout_password,
  });
  await request(
    g,
    '/v1/payout/' + encodeURIComponent(reference) + '/verify',
    'POST',
    { verification_code: code },
    undefined,
    { authorization: 'Bearer ' + text(auth.token) },
  );
  return { ok: true };
}
export async function payoutStatus(g: Gateway, reference: string, itemReference: string) {
  if (g.provider === 'paypal') {
    const d = await request(
      g,
      '/v1/payments/payouts/' + encodeURIComponent(reference),
      'GET',
      undefined,
      undefined,
      await paypalToken(g),
    );
    const item = rec(arr(d.items)[0]);
    const status = text(item.transaction_status);
    return {
      status:
        status === 'SUCCESS'
          ? 'COMPLETED'
          : ['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED'].includes(status)
            ? 'FAILED'
            : 'PROCESSING',
    };
  }
  const d = await request(g, '/v1/payout/' + encodeURIComponent(itemReference || reference));
  const state = text(d.status || d.payout_status).toLowerCase();
  return {
    status:
      state === 'finished'
        ? 'COMPLETED'
        : ['failed', 'rejected', 'cancelled', 'rejected_not_checked'].includes(state)
          ? 'FAILED'
          : 'PROCESSING',
  };
}
function equal(a: string, b: string) {
  return (
    /^[a-f0-9]+$/i.test(a) &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a.toLowerCase()), Buffer.from(b.toLowerCase()))
  );
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)]),
    );
  return value;
}
export async function verifyWebhook(g: Gateway, raw: string, headers: Record<string, string>) {
  const body = rec(JSON.parse(raw));
  if (g.provider === 'stripe') {
    const parts = (headers['stripe-signature'] ?? '').split(',').map((s) => s.split('='));
    const time = parts.find((p) => p[0] === 't')?.[1] ?? '';
    if (!/^\d+$/.test(time) || Math.abs(Date.now() / 1000 - Number(time)) > 300)
      throw new ServiceError(401, 'INVALID_SIGNATURE');
    const h = createHmac('sha256', g.credentials.webhook_secret!)
      .update(time + '.' + raw)
      .digest('hex');
    if (!parts.some((p) => p[0] === 'v1' && equal(p[1] ?? '', h)))
      throw new ServiceError(401, 'INVALID_SIGNATURE');
  } else if (g.provider === 'nowpayments') {
    const h = createHmac('sha512', g.credentials.ipn_secret!)
      .update(JSON.stringify(sorted(body)))
      .digest('hex');
    if (!equal(headers['x-nowpayments-sig'] ?? '', h))
      throw new ServiceError(401, 'INVALID_SIGNATURE');
  } else {
    const d = await request(
      g,
      '/v1/notifications/verify-webhook-signature',
      'POST',
      {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: g.credentials.webhook_id,
        webhook_event: body,
      },
      undefined,
      await paypalToken(g),
    );
    if (d.verification_status !== 'SUCCESS') throw new ServiceError(401, 'INVALID_SIGNATURE');
  }
  const resource =
    g.provider === 'stripe'
      ? rec(rec(body.data).object)
      : g.provider === 'paypal'
        ? rec(body.resource)
        : body;
  const related =
    g.provider === 'paypal' && resource.supplementary_data
      ? rec(rec(resource.supplementary_data).related_ids)
      : {};
  return {
    event_id:
      text(body.id) ||
      [text(body.payment_id), text(body.payment_status), text(body.updated_at)].join(':'),
    reference:
      g.provider === 'stripe'
        ? text(resource.object) === 'checkout.session'
          ? text(resource.id)
          : text(resource.payment_intent) || text(resource.id)
        : g.provider === 'paypal'
          ? text(related.order_id) || text(resource.id)
          : text(body.payment_id),
    type: text(body.type) || text(body.event_type) || text(body.payment_status),
  };
}
