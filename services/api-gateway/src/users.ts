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
      );
      res.json({ data });
    }),
  );
  return router;
}
