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
    ![
      'users',
      'access',
      'profiles',
      'files',
      'consents',
      'bookings',
      'instant',
      'experts',
      'taxonomy',
      'availability',
      'languages',
      'localization',
      'site-settings',
      'search',
      'matching',
      'payments',
      'finance',
      'wallet',
      'accounting',
      'payouts',
      'disputes',
      'communications',
      'channels',
      'questions',
      'events',
      'notifications',
      'presence',
      'sessions',
      'ratings',
    ].includes(path[0]!)
  )
    return fail('NOT_FOUND', 404);
  const base = process.env.AUTH_PUBLIC_URL,
    key = process.env.AUTH_INTERNAL_KEY,
    gateway = process.env.AUTH_GATEWAY_URL,
    qaPreview = process.env.QA_PREVIEW_URL,
    eventPreview = process.env.EVENT_PREVIEW_URL,
    instantPreview = process.env.INSTANT_PREVIEW_URL,
    paymentPreview = process.env.PAYMENT_PREVIEW_URL,
    messagingPreview = process.env.MESSAGING_PREVIEW_URL,
    upstream =
      path[0] === 'questions' && qaPreview
        ? qaPreview
        : path[0] === 'events' && eventPreview
          ? eventPreview
          : path[0] === 'instant' && instantPreview
            ? instantPreview
            : path[0] === 'payments' && paymentPreview
            ? paymentPreview
            : path[0] === 'communications' && messagingPreview
              ? messagingPreview
              : gateway;
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
  const publicRead =
    req.method === 'GET' &&
    ((path[0] === 'languages' && req.nextUrl.searchParams.get('admin') !== '1') ||
      (path[0] === 'availability' && path[1] === 'public') ||
      (path[0] === 'availability' && path[1] === 'public-slots') ||
      (path[0] === 'bookings' && path[1] === 'public-stats') ||
      (path[0] === 'ratings' && path[1] === 'public') ||
      (path[0] === 'presence' && path[1] === 'public') ||
      (path[0] === 'questions' && path[1] === 'public') ||
      (path[0] === 'events' && path[1] === 'public') ||
      (path[0] === 'instant' && path[1] === 'public') ||
      (path[0] === 'site-settings' && path[1] === 'social-links' && req.nextUrl.searchParams.get('admin') !== '1') ||
      (path[0] === 'localization' && ['bundle', 'translation'].includes(path[1] ?? '')) ||
      (path[0] === 'search' && path[1] === 'experts') ||
      (path[0] === 'experts' && path[1] === 'public') ||
      (path[0] === 'files' && path[1] === 'public') ||
      (path.length === 1 &&
        path[0] === 'taxonomy' &&
        req.nextUrl.searchParams.get('admin') !== '1'));
  if (!access && !publicRead) return fail('UNAUTHORIZED', 401);
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
        if (size > (path[0] === 'files' && path[1] === 'assets' ? 28 : 3) * 1024 * 1024) {
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
  const recordingStream =
    req.method === 'GET' &&
    path.length === 4 &&
    path[0] === 'files' &&
    path[1] === 'recordings' &&
    /^[a-f0-9-]{36}$/.test(path[2]!) &&
    path[3] === 'stream';
  try {
    const response = await fetch(
      new URL('/api/v2/' + path.join('/') + req.nextUrl.search, upstream),
      {
        method: req.method,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(
          recordingStream
            ? 600000
            : ['matching', 'payments', 'finance', 'payouts', 'disputes'].includes(path[0]!)
              ? 65000
              : 20000,
        ),
        headers: {
          ...(recordingStream && req.headers.get('range')
            ? { range: req.headers.get('range')! }
            : {}),
          'content-type': 'application/json',
          'x-internal-key': key,
          authorization: `Bearer ${access}`,
          ...(path[0] === 'payments' && process.env.FINANCE_TRUST_PROXY_IP === '1'
            ? { 'x-finance-client-ip': req.headers.get('x-real-ip') ?? '' }
            : {}),
        },
        ...(body === undefined ? {} : { body }),
      },
    );
    if (recordingStream && response.ok) {
      const headers = new Headers({
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      });
      for (const name of [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'content-disposition',
        'x-content-type-options',
      ]) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new NextResponse(response.body, { status: response.status, headers });
    }
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch {
    return fail('UNAVAILABLE', 503);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
