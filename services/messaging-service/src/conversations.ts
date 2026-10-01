import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  internalRouter,
  endpoint,
  principal,
  requirePermission,
  internalCall,
  ServiceError,
  transaction,
} from '@vianoor/service-runtime';
import { uuid, member, createConversation, sendMessage, presentMessage, receipt } from './model.js';
export function conversationRouter(
  pool: Pool,
  publish: (accounts: string[], event: unknown) => Promise<void>,
) {
  const r = internalRouter();
  r.post(
    '/internal/communications/booking',
    endpoint(async (req, res) => {
      const { booking_id } = z.object({ booking_id: uuid }).strict().parse(req.body);
      const b = await internalCall<{
        client_id: string;
        expert_id: string;
        status: string;
        kind: string;
      }>('booking-service', '/internal/bookings/financial-state/' + booking_id);
      if (!['CONFIRMED', 'COMPLETED', 'RESCHEDULED', 'RESCHEDULE_REQUESTED'].includes(b.status))
        throw new ServiceError(409, 'CONTEXT_NOT_ALLOWED');
      uuid.parse(b.client_id);
      uuid.parse(b.expert_id);
      res.json({
        data: await createConversation(pool, {
          type: b.kind === 'TEXT' ? 'CONSULTATION' : 'BOOKING',
          context_id: booking_id,
          context_key: 'booking:' + booking_id,
          creator: b.client_id,
          members: [
            { id: b.client_id, role: 'CUSTOMER' },
            { id: b.expert_id, role: 'EXPERT' },
          ],
        }),
      });
    }),
  );
  r.get(
    '/api/v2/communications/conversations',
    endpoint(async (req, res) => {
      const u = await principal(req);
      res.json({
        data: (
          await pool.query(
            'SELECT c.id,c.type,c.context_id,c.state,c.category,c.updated_at,c.next_sequence,m.read_sequence,(SELECT count(*)::int FROM messages x WHERE x.conversation_id=c.id AND x.sequence>m.read_sequence AND x.sender_id<>$1) AS unread FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.account_id=$1 ORDER BY c.updated_at DESC LIMIT 100',
            [u.id],
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/communications/conversations',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({
            type: z.enum(['BOOKING', 'SUPPORT', 'CHANNEL_INBOX']),
            context_id: uuid.optional(),
            request_key: uuid,
          })
          .strict()
          .parse(req.body);
      let context = d.context_id ?? d.request_key,
        key = '',
        type: string = d.type,
        members = [{ id: u.id, role: 'CUSTOMER' }];
      if (d.type === 'BOOKING') {
        if (!d.context_id) throw new ServiceError(400, 'CONTEXT_REQUIRED');
        const b = await internalCall<{
          client_id: string;
          expert_id: string;
          status: string;
          kind: string;
        }>(
          'booking-service',
          '/internal/bookings/communication-context/' + context,
          req.get('authorization') ?? '',
        );
        if (
          ![b.client_id, b.expert_id].includes(u.id) ||
          !['CONFIRMED', 'COMPLETED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED'].includes(b.status)
        )
          throw new ServiceError(403, 'CONTEXT_NOT_ALLOWED');
        key = 'booking:' + context;
        type = b.kind === 'TEXT' ? 'CONSULTATION' : 'BOOKING';
        members = [
          { id: b.client_id, role: 'CUSTOMER' },
          { id: b.expert_id, role: 'EXPERT' },
        ];
      } else if (d.type === 'SUPPORT') {
        context = d.request_key;
        key = 'support:' + u.id + ':' + d.request_key;
      } else {
        const channel = (
          await pool.query('SELECT id FROM expert_channels WHERE id=$1 AND active', [context])
        ).rows[0];
        if (!channel) throw new ServiceError(404, 'CHANNEL_NOT_FOUND');
        key = 'channel-inbox:' + context + ':' + u.id;
      }
      res.json({
        data: await createConversation(pool, {
          type,
          context_id: context,
          context_key: key,
          creator: u.id,
          members,
        }),
      });
    }),
  );
  r.get(
    '/api/v2/communications/conversations/:id/messages',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        d = z
          .object({
            after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
            before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          })
          .strict()
          .parse(req.query);
      await member(pool, id, u.id);
      if (d.after !== undefined && d.before !== undefined)
        throw new ServiceError(400, 'INVALID_CURSOR');
      const rows =
        d.after !== undefined
          ? (
              await pool.query(
                'SELECT * FROM messages WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3',
                [id, d.after, d.limit],
              )
            ).rows
          : (
              await pool.query(
                'SELECT * FROM messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR sequence<$2) ORDER BY sequence DESC LIMIT $3',
                [id, d.before ?? null, d.limit],
              )
            ).rows.reverse();
      const actors = await internalCall(
        'profile-service',
        '/internal/communication-actors',
        req.get('authorization') ?? '',
        { conversation_id: id },
      );
      res.json({
        data: {
          actors,
          messages: rows.map(presentMessage),
          members: (
            await pool.query(
              'SELECT account_id,role,delivered_sequence,read_sequence FROM conversation_members WHERE conversation_id=$1',
              [id],
            )
          ).rows,
          next: rows.at(-1)?.sequence ?? String(d.after ?? 0),
        },
      });
    }),
  );
  r.post(
    '/api/v2/communications/conversations/:id/messages',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id),
        message = await sendMessage(pool, id, u.id, req.get('authorization') ?? '', req.body);
      const members = (
        await pool.query('SELECT account_id FROM conversation_members WHERE conversation_id=$1', [
          id,
        ])
      ).rows.map((x) => x.account_id);
      await publish(members, {
        type: 'message',
        conversation_id: id,
        message_id: message.id,
      }).catch(() => {});
      res.json({ data: message });
    }),
  );
  r.post(
    '/api/v2/communications/conversations/:id/receipt',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id);
      const result = await receipt(pool, id, u.id, req.body);
      const members = (
        await pool.query('SELECT account_id FROM conversation_members WHERE conversation_id=$1', [
          id,
        ])
      ).rows.map((x) => x.account_id);
      if (result.changed)
        await publish(members, { type: 'receipt', conversation_id: id }).catch(() => {});
      res.json({ data: result });
    }),
  );
  r.get(
    '/api/v2/communications/admin/inbox',
    endpoint(async (req, res) => {
      await requirePermission(req, 'communication.manage');
      res.json({
        data: (
          await pool.query(
            "SELECT c.id,c.type,c.context_id,c.created_by,c.state,c.category,c.updated_at FROM conversations c WHERE type IN ('SUPPORT','CHANNEL_INBOX') ORDER BY updated_at DESC LIMIT 100",
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/api/v2/communications/admin/:id/review',
    endpoint(async (req, res) => {
      const u = await requirePermission(req, 'communication.manage'),
        id = uuid.parse(req.params.id),
        d = z
          .object({
            action: z.enum(['CLAIM', 'FORWARD', 'ARCHIVE', 'REOPEN', 'CATEGORIZE']),
            category: z.string().trim().max(80).default(''),
          })
          .strict()
          .parse(req.body);
      await transaction(pool, async (db) => {
        const c = (
          await db.query(
            "SELECT * FROM conversations WHERE id=$1 AND type IN ('SUPPORT','CHANNEL_INBOX') FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!c) throw new ServiceError(404, 'CONVERSATION_NOT_FOUND');
        await db.query(
          "INSERT INTO conversation_members(conversation_id,account_id,role) VALUES($1,$2,'MODERATOR') ON CONFLICT DO NOTHING",
          [id, u.id],
        );
        if (d.action === 'FORWARD') {
          if (c.type !== 'CHANNEL_INBOX') throw new ServiceError(400, 'INVALID_CONTEXT');
          const channel = (
            await db.query('SELECT expert_id FROM expert_channels WHERE id=$1 AND active', [
              c.context_id,
            ])
          ).rows[0];
          if (!channel) throw new ServiceError(404, 'CHANNEL_NOT_FOUND');
          await db.query(
            "INSERT INTO conversation_members(conversation_id,account_id,role) VALUES($1,$2,'EXPERT') ON CONFLICT DO NOTHING",
            [id, channel.expert_id],
          );
          await db.query(
            "INSERT INTO communication_notifications(id,account_id,conversation_id,event) VALUES($1,$2,$3,'INBOX_FORWARDED')",
            [randomUUID(), channel.expert_id, id],
          );
        }
        if (d.action === 'ARCHIVE' || d.action === 'REOPEN')
          await db.query('UPDATE conversations SET state=$2,updated_at=now() WHERE id=$1', [
            id,
            d.action === 'ARCHIVE' ? 'ARCHIVED' : 'OPEN',
          ]);
        if (d.action === 'CATEGORIZE')
          await db.query('UPDATE conversations SET category=$2 WHERE id=$1', [id, d.category]);
        await db.query(
          'INSERT INTO communication_audit(actor_id,conversation_id,action) VALUES($1,$2,$3)',
          [u.id, id, d.action],
        );
      });
      res.json({ data: { ok: true } });
    }),
  );
  r.get(
    '/internal/communications/members/:id',
    endpoint(async (req, res) => {
      const u = await principal(req),
        id = uuid.parse(req.params.id);
      await member(pool, id, u.id);
      res.json({
        data: (
          await pool.query(
            'SELECT account_id,role FROM conversation_members WHERE conversation_id=$1',
            [id],
          )
        ).rows,
      });
    }),
  );
  r.post(
    '/internal/communications/authorize',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z
          .object({ conversation_id: uuid, write: z.boolean().default(false) })
          .strict()
          .parse(req.body);
      res.json({ data: await member(pool, d.conversation_id, u.id, d.write) });
    }),
  );
  r.post(
    '/internal/communications/file-access',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z.object({ id: uuid }).strict().parse(req.body);
      const allowed = (
        await pool.query(
          'SELECT 1 FROM messages x JOIN conversation_members m ON m.conversation_id=x.conversation_id WHERE m.account_id=$1 AND x.files @> $2::jsonb LIMIT 1',
          [u.id, JSON.stringify([d.id])],
        )
      ).rowCount;
      if (!allowed) throw new ServiceError(403, 'FORBIDDEN');
      res.json({ data: { ok: true } });
    }),
  );
  r.post(
    '/internal/communications/event',
    endpoint(async (req, res) => {
      const d = z
        .object({
          event_id: uuid,
          presenter_id: uuid,
          account_id: uuid,
          role: z.enum([
            'PRESENTER',
            'MODERATOR',
            'SPONSOR',
            'ATTENDEE',
          ]),
        })
        .strict()
        .parse(req.body);

      res.json({
        data: await createConversation(pool, {
          type: 'EVENT',
          context_id: d.event_id,
          context_key: 'event:' + d.event_id,
          creator: d.presenter_id,
          members: [
            {
              id: d.presenter_id,
              role: 'PRESENTER',
            },
            {
              id: d.account_id,
              role: d.role,
            },
          ],
        }),
      });
    }),
  );

  r.post(
    '/internal/communications/question',
    endpoint(async (req, res) => {
      const u = await principal(req),
        d = z.object({ question_id: uuid }).strict().parse(req.body),
        q = await internalCall<{ owner_id: string; expert_id: string }>(
          'qa-service',
          '/internal/questions/' + d.question_id + '/context',
          req.get('authorization') ?? '',
        );
      if (![q.owner_id, q.expert_id].includes(u.id)) throw new ServiceError(403, 'FORBIDDEN');
      res.json({
        data: await createConversation(pool, {
          type: 'QUESTION',
          context_id: d.question_id,
          context_key: 'question:' + d.question_id,
          creator: q.owner_id,
          members: [
            { id: q.owner_id, role: 'CUSTOMER' },
            { id: q.expert_id, role: 'EXPERT' },
          ],
        }),
      });
    }),
  );
  return r;
}
