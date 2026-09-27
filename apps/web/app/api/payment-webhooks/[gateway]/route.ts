import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, context: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await context.params;
  if (!/^[a-f0-9-]{36}$/.test(gateway))
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const key = process.env.AUTH_INTERNAL_KEY,
    target = process.env.PAYMENT_SERVICE_URL;
  if (!key || !target) return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = req.body?.getReader();
  if (reader)
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      length += p.value.length;
      if (length > 1024 * 1024) {
        await reader.cancel();
        return NextResponse.json({ error: 'TOO_LARGE' }, { status: 413 });
      }
      chunks.push(p.value);
    }
  const names = [
    'stripe-signature',
    'x-nowpayments-sig',
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
  ];
  try {
    const response = await fetch(new URL('/internal/payment/webhook', target), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      body: JSON.stringify({
        gateway_id: gateway,
        raw: Buffer.concat(chunks).toString('base64'),
        headers: Object.fromEntries(names.map((n) => [n, req.headers.get(n) ?? ''])),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(55000),
    });
    return NextResponse.json(
      { accepted: response.ok },
      { status: response.status, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ accepted: false }, { status: 503 });
  }
}
