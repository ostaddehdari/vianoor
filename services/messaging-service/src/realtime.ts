import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  principal,
  internalCall,
  ServiceError,
  type connectInfrastructure,
} from '@vianoor/service-runtime';
import { member, seal, open, uuid } from './model.js';
type Infra = Awaited<ReturnType<typeof connectInfrastructure>>;
export async function realtime(infra: Infra) {
  const clients = new Map<
      WebSocket,
      { id: string; authorization: string; last: number; typingAt: number }
    >(),
    subscriber = infra.redis.duplicate();
  await subscriber.connect();
  const topic = 'communications:realtime';
  await subscriber.subscribe(topic, (payload) => {
    try {
      const event = JSON.parse(payload) as { accounts: string[]; event: unknown };
      for (const [ws, u] of clients)
        if (event.accounts.includes(u.id) && ws.readyState === 1) {
          if (ws.bufferedAmount > 262144) ws.close(1013);
          else ws.send(JSON.stringify(event.event));
        }
    } catch {
      /* Invalid internal event is discarded. */
    }
  });
  const publish = async (accounts: string[], event: unknown) => {
    await infra.redis.publish(topic, JSON.stringify({ accounts, event }));
  };
  const router = internalRouter();
  router.post(
    '/api/v2/communications/realtime-ticket',
    endpoint(async (req, res) => {
      const u = await principal(req),
        ticket = randomBytes(32).toString('base64url');
      await infra.redis.set(
        'communications:ticket:' + ticket,
        seal({ id: u.id, authorization: req.get('authorization') ?? '' }, ticket),
        { EX: 30 },
      );
      res.json({ data: { ticket, expires_in: 30, path: '/realtime' } });
    }),
  );
  router.post(
    '/internal/communications/publish',
    endpoint(async (req, res) => {
      const d = z
        .object({
          accounts: z.array(uuid).max(100),
          event: z
            .object({ type: z.enum(['notification', 'presence']), context_id: uuid.optional() })
            .strict(),
        })
        .strict()
        .parse(req.body);
      await publish(d.accounts, d.event);
      res.json({ data: { ok: true } });
    }),
  );
  function attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false }),
      pending = new Set<WebSocket>();
    server.on('upgrade', (req, socket, head) => {
      const origin = process.env.AUTH_PUBLIC_URL ? new URL(process.env.AUTH_PUBLIC_URL).origin : '';
      if (
        req.url !== '/realtime' ||
        !origin ||
        req.headers.origin !== origin ||
        pending.size >= 100
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        pending.add(ws);
        const timeout = setTimeout(() => {
          if (!clients.has(ws)) ws.close(1008);
        }, 5000);
        let handling = false;
        ws.on('message', async (bytes) => {
          if (handling) return;
          handling = true;
          try {
            const event = JSON.parse(bytes.toString()),
              existing = clients.get(ws);
            if (!existing) {
              const d = z
                  .object({
                    type: z.literal('authenticate'),
                    ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
                  })
                  .strict()
                  .parse(event),
                ticket = await infra.redis.getDel('communications:ticket:' + d.ticket);
              if (!ticket) throw new ServiceError(401, 'UNAUTHORIZED');
              const u = open(ticket, d.ticket) as { id: string; authorization: string };
              await internalCall('identity-service', '/internal/principal', u.authorization);
              if ([...clients.values()].filter((c) => c.id === u.id).length >= 5)
                throw new ServiceError(429, 'TOO_MANY_CONNECTIONS');
              clients.set(ws, { ...u, last: Date.now(), typingAt: 0 });
              pending.delete(ws);
              clearTimeout(timeout);
              ws.send(JSON.stringify({ type: 'ready' }));
              await internalCall(
                'presence-service',
                '/internal/presence/heartbeat',
                u.authorization,
                { state: 'ONLINE' },
              );
              return;
            }
            const d = z
              .discriminatedUnion('type', [
                z
                  .object({ type: z.literal('heartbeat'), state: z.enum(['ONLINE', 'AWAY']) })
                  .strict(),
                z
                  .object({ type: z.literal('typing'), conversation_id: uuid, active: z.boolean() })
                  .strict(),
              ])
              .parse(event);
            if (d.type === 'heartbeat') {
              await internalCall(
                'presence-service',
                '/internal/presence/heartbeat',
                existing.authorization,
                { state: d.state },
              );
              existing.last = Date.now();
            } else {
              if (Date.now() - existing.typingAt < 1000) return;
              existing.typingAt = Date.now();
              await member(infra.pool!, d.conversation_id, existing.id, true);
              const recipients = (
                await infra.pool!.query(
                  'SELECT account_id FROM conversation_members WHERE conversation_id=$1 AND account_id<>$2',
                  [d.conversation_id, existing.id],
                )
              ).rows.map((r) => r.account_id);
              await publish(recipients, {
                type: 'typing',
                conversation_id: d.conversation_id,
                account_id: existing.id,
                active: d.active,
              });
            }
          } catch {
            ws.close(1008);
          } finally {
            handling = false;
          }
        });
        ws.on('error', () => {});
        ws.on('close', () => {
          clearTimeout(timeout);
          pending.delete(ws);
          clients.delete(ws);
        });
      });
    });
    const interval = setInterval(() => {
      for (const [ws, u] of clients) {
        if (Date.now() - u.last > 75000) {
          ws.close(1008);
          continue;
        }
        void internalCall('identity-service', '/internal/principal', u.authorization).catch(() =>
          ws.close(1008),
        );
      }
    }, 30000);
    interval.unref();
    return {
      close: async () => {
        clearInterval(interval);
        for (const ws of clients.keys()) ws.close(1001);
        for (const ws of pending) ws.close(1001);
        wss.close();
        await subscriber.quit();
      },
    };
  }
  return { router, publish, attach };
}
