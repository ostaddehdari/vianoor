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
  search: 'search-service',
  matching: 'matching-service',
  payments: 'payment-service',
  finance: 'payment-service',
  wallet: 'wallet-service',
  accounting: 'accounting-service',
  payouts: 'payout-service',
  disputes: 'dispute-service',
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
        (req.path === '/experts/public' ||
          (req.path === '/languages' && req.query.admin !== '1') ||
          /^\/languages\/[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(req.path) ||
          ['/localization/bundle', '/localization/translation', '/search/experts'].includes(
            req.path,
          ) ||
          /^\/experts\/public\/[a-z0-9-]+$/.test(req.path) ||
          /^\/files\/public\/[a-f0-9-]+$/.test(req.path) ||
          (req.path === '/taxonomy' && req.query.admin !== '1'));
      if (!publicRead) await principal(req);
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
