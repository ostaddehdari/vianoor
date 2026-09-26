import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fail = (code: string, status: number) =>
  NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (
    !path.length ||
    path.some((p) => !/^[A-Za-z0-9-]+$/.test(p)) ||
    !['users', 'access', 'profiles', 'files', 'consents', 'bookings'].includes(path[0]!)
  )
    return fail('NOT_FOUND', 404);
  const base = process.env.AUTH_PUBLIC_URL,
    key = process.env.AUTH_INTERNAL_KEY,
    upstream = process.env.AUTH_GATEWAY_URL;
  if (!base || !key || key.length < 48 || !upstream) return fail('NOT_CONFIGURED', 503);
  const publicUrl = new URL(base);
  const secure = publicUrl.protocol === 'https:';
  if (
    !secure &&
    !(
      process.env.AUTH_DEVELOPMENT === '1' &&
      ['localhost', '127.0.0.1'].includes(publicUrl.hostname)
    )
  )
    return fail('NOT_CONFIGURED', 503);
  if (req.headers.get('sec-fetch-site') === 'cross-site') return fail('FORBIDDEN', 403);
  if (
    req.method !== 'GET' &&
    (req.headers.get('origin') !== publicUrl.origin ||
      req.headers.get('content-type')?.split(';')[0] !== 'application/json')
  )
    return fail('FORBIDDEN', 403);
  const access = req.cookies.get((secure ? '__Secure-vianoor-' : 'vianoor-') + 'access')?.value;
  if (!access) return fail('UNAUTHORIZED', 401);
  let body: string | undefined;
  if (req.method !== 'GET') {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = req.body?.getReader();
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 3 * 1024 * 1024) {
          await reader.cancel();
          return fail('INVALID_INPUT', 413);
        }
        chunks.push(part.value);
      }
    try {
      body = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(body);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error();
    } catch {
      return fail('INVALID_INPUT', 400);
    }
  }
  try {
    const response = await fetch(
      new URL('/api/v2/' + path.join('/') + req.nextUrl.search, upstream),
      {
        method: req.method,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: {
          'content-type': 'application/json',
          'x-internal-key': key,
          authorization: `Bearer ${access}`,
        },
        ...(body === undefined ? {} : { body }),
      },
    );
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch {
    return fail('UNAVAILABLE', 503);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
