import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const actions = new Set([
  'register',
  'login',
  'forgot-password',
  'resend-verification',
  'verify-email',
  'reset-password',
  'refresh',
  'logout',
  'session',
  'revoke',
]);
const error = (code: string, status: number) =>
  NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!actions.has(action) || req.method !== (action === 'session' ? 'GET' : 'POST'))
    return error('NOT_FOUND', 404);
  const base = process.env.AUTH_PUBLIC_URL,
    upstream = process.env.AUTH_GATEWAY_URL,
    key = process.env.AUTH_INTERNAL_KEY;
  if (!base || !upstream || !key || key.length < 48) return error('NOT_CONFIGURED', 503);
  const publicUrl = new URL(base),
    secure = publicUrl.protocol === 'https:';
  if (
    !secure &&
    !(
      process.env.AUTH_DEVELOPMENT === '1' &&
      ['localhost', '127.0.0.1'].includes(publicUrl.hostname)
    )
  )
    return error('NOT_CONFIGURED', 503);
  if (
    req.method === 'POST' &&
    (req.headers.get('origin') !== publicUrl.origin ||
      req.headers.get('content-type')?.split(';')[0] !== 'application/json')
  )
    return error('FORBIDDEN', 403);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return error('FORBIDDEN', 403);
  const prefix = secure ? '__Secure-vianoor-' : 'vianoor-';
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: publicUrl.pathname.replace(/\/$/, '') || '/',
  };
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    // Bound the stream, including requests without Content-Length.
    const reader = req.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 8192) {
          await reader.cancel();
          return error('INVALID_INPUT', 413);
        }
        chunks.push(part.value);
      }
    }
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
    } catch {
      return error('INVALID_INPUT', 400);
    }
  }
  if (action === 'refresh' || action === 'logout')
    body = { refresh: req.cookies.get(prefix + 'refresh')?.value };
  const access = req.cookies.get(prefix + 'access')?.value ?? '';
  // Enable only behind an ingress that OVERWRITES this header; otherwise use a shared limiter bucket.
  const client =
    process.env.AUTH_TRUST_PROXY === '1'
      ? (req.headers.get('x-real-ip') ?? 'unknown')
      : 'shared-ingress';
  try {
    const response = await fetch(new URL(`/api/v1/auth/${action}`, upstream), {
      method: req.method,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        'content-type': 'application/json',
        'x-internal-key': key,
        'x-auth-client': createHmac('sha256', key).update(client).digest('hex'),
        authorization: `Bearer ${access}`,
      },
      ...(req.method === 'POST' ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    const result = NextResponse.json(
      response.ok && ['login', 'refresh'].includes(action) ? { data: { ok: true } } : payload,
      {
        status: response.status,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      },
    );
    const retry = response.headers.get('retry-after');
    if (retry) result.headers.set('Retry-After', retry);
    if (response.ok && ['login', 'refresh'].includes(action)) {
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(payload.data?.access ?? '') ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.data?.refresh ?? '')
      )
        return error('UNAVAILABLE', 503);
      result.cookies.set(prefix + 'access', payload.data.access, { ...cookieOptions, maxAge: 300 });
      result.cookies.set(prefix + 'refresh', payload.data.refresh, {
        ...cookieOptions,
        maxAge: 7 * 86400,
      });
    }
    if ((action === 'logout' && response.ok) || (action === 'refresh' && response.status === 401)) {
      for (const name of ['access', 'refresh'])
        result.cookies.set(prefix + name, '', { ...cookieOptions, maxAge: 0 });
    }
    return result;
  } catch {
    return error('UNAVAILABLE', 503);
  }
}
export { handle as GET, handle as POST };
