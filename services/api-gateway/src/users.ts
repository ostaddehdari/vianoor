import { Readable } from 'node:stream';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
} from '@vianoor/service-runtime';
const owners: Record<string, string> = {
  users: 'identity-service',
  access: 'organization-service',
  profiles: 'profile-service',
  files: 'file-service',
  consents: 'consent-service',
  bookings: 'booking-service',
  experts: 'scholar-service',
  taxonomy: 'taxonomy-service',
  availability: 'availability-service',
  languages: 'taxonomy-service',
  localization: 'taxonomy-service',
  'site-settings': 'taxonomy-service',
  search: 'search-service',
  matching: 'matching-service',
  payments: 'payment-service',
  finance: 'payment-service',
  wallet: 'wallet-service',
  accounting: 'accounting-service',
  payouts: 'payout-service',
  disputes: 'dispute-service',
  communications: 'messaging-service',
  channels: 'messaging-service',
  questions: 'qa-service',
  notifications: 'notification-service',
  presence: 'presence-service',
  sessions: 'media-service',
  ratings: 'rating-service',
};
export function usersProxy() {
  const router = internalRouter('28mb', true);
  router.use(
    endpoint(async (req, res) => {
      const group = req.path.split('/')[1] ?? '';
      const owner = owners[group];
      if (
        !owner ||
        !['GET', 'POST', 'PUT', 'PATCH'].includes(req.method) ||
        !/^\/[a-zA-Z0-9/-]+$/.test(req.path)
      )
        throw new ServiceError(404, 'NOT_FOUND');
      const publicRead =
        req.method === 'GET' &&
        (/^\/channels\/public\/[a-z0-9-]+$/.test(req.path) ||
          req.path === '/questions/public' ||
          req.path === '/experts/public' ||
          (req.path === '/languages' && req.query.admin !== '1') ||
          req.path === '/availability/public' ||
          req.path === '/availability/public-slots' ||
          req.path === '/bookings/public-stats' ||
          req.path === '/ratings/public' ||
          req.path === '/presence/public' ||
          (req.path === '/site-settings/social-links' && req.query.admin !== '1') ||
          /^\/languages\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(req.path) ||
          ['/localization/bundle', '/localization/translation', '/search/experts'].includes(
            req.path,
          ) ||
          /^\/experts\/public\/[a-z0-9-]+$/.test(req.path) ||
          /^\/files\/public\/[a-f0-9-]+$/.test(req.path) ||
          (req.path === '/taxonomy' && req.query.admin !== '1'));
      if (!publicRead) await principal(req);
      if (req.method === 'GET' && /^\/files\/recordings\/[a-f0-9-]{36}\/stream$/.test(req.path)) {
        const target = process.env.FILE_SERVICE_URL,
          key = process.env.AUTH_INTERNAL_KEY;
        if (!target || !key || key.length < 48) throw new ServiceError(503, 'UNAVAILABLE');
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        const upstream = await fetch(new URL('/api/v2' + req.url, target), {
          redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]),
          headers: {
            'x-internal-key': key,
            authorization: req.get('authorization') ?? '',
            ...(req.get('range') ? { range: req.get('range')! } : {}),
          },
        });
        res.status(upstream.status);
        for (const name of [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'content-disposition',
          'cache-control',
          'x-content-type-options',
        ]) {
          const value = upstream.headers.get(name);
          if (value) res.set(name, value);
        }
        if (!upstream.body) {
          res.end();
          return;
        }
        const body = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
        body.on('error', () => res.destroy());
        body.pipe(res);
        return;
      }
      const data = await internalCall(
        owner,
        '/api/v2' + req.url,
        req.get('authorization') ?? '',
        req.method === 'GET' ? undefined : req.body,
        req.method,
        group === 'payments' ? { 'x-finance-client-ip': req.get('x-finance-client-ip') ?? '' } : {},
      );
      res.json({ data });
    }),
  );
  return router;
}
