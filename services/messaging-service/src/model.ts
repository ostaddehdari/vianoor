import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  internalCall,
  ServiceError,
  transaction,
  sealJson,
  openJson,
} from '@vianoor/service-runtime';
export const uuid = z.string().uuid();
export const keyName = 'COMMUNICATION_ENCRYPTION_KEY';
export const seal = (value: unknown, id: string) => sealJson(value, 'communication:' + id, keyName);
export const open = (value: string, id: string) => openJson(value, 'communication:' + id, keyName);
export async function initializeMessaging(pool: Pool) {
  await pool.query(`
CREATE TABLE IF NOT EXISTS conversations(id uuid PRIMARY KEY,type text NOT NULL CHECK(type IN ('BOOKING','CONSULTATION','SUPPORT','CHANNEL_INBOX','QUESTION','EVENT')),context_key text NOT NULL UNIQUE,context_id uuid NOT NULL,created_by uuid NOT NULL,state text NOT NULL DEFAULT 'OPEN',category text NOT NULL DEFAULT '',next_sequence bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS conversation_members(conversation_id uuid REFERENCES conversations(id),account_id uuid NOT NULL,role text NOT NULL,delivered_sequence bigint NOT NULL DEFAULT 0,read_sequence bigint NOT NULL DEFAULT 0,joined_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,account_id));
CREATE TABLE IF NOT EXISTS messages(id uuid PRIMARY KEY,conversation_id uuid NOT NULL REFERENCES conversations(id),sender_id uuid NOT NULL,sequence bigint NOT NULL,type text NOT NULL,sealed_content text NOT NULL,reply_to uuid REFERENCES messages(id),files jsonb NOT NULL DEFAULT '[]',request_key uuid NOT NULL,fingerprint text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(conversation_id,sequence),UNIQUE(conversation_id,sender_id,request_key));
CREATE INDEX IF NOT EXISTS messages_history ON messages(conversation_id,sequence DESC);
CREATE INDEX IF NOT EXISTS conversation_members_account ON conversation_members(account_id,conversation_id);
CREATE TABLE IF NOT EXISTS communication_audit(id bigserial PRIMARY KEY,actor_id uuid NOT NULL,conversation_id uuid,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS communication_notifications(id uuid PRIMARY KEY,account_id uuid NOT NULL,conversation_id uuid NOT NULL,event text NOT NULL,delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS expert_channels(id uuid PRIMARY KEY,expert_id uuid NOT NULL UNIQUE,expert_code varchar(13) NOT NULL UNIQUE,slug text NOT NULL UNIQUE,title text NOT NULL,description text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,comments_enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS channel_followers(channel_id uuid REFERENCES expert_channels(id),account_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(channel_id,account_id));
CREATE TABLE IF NOT EXISTS channel_posts(id uuid PRIMARY KEY,channel_id uuid NOT NULL REFERENCES expert_channels(id),author_id uuid NOT NULL,body text NOT NULL,files jsonb NOT NULL DEFAULT '[]',request_key uuid NOT NULL,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(channel_id,request_key));
CREATE TABLE IF NOT EXISTS channel_comments(id uuid PRIMARY KEY,post_id uuid NOT NULL REFERENCES channel_posts(id),author_id uuid NOT NULL,sealed_body text NOT NULL,request_key uuid NOT NULL,state text NOT NULL DEFAULT 'PENDING',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(post_id,author_id,request_key));
`);

  /*
   * Existing Stage12 databases already contain the original
   * CHECK constraint. Recreate it additively with EVENT.
   */
  await pool.query(`
    ALTER TABLE conversations
      DROP CONSTRAINT IF EXISTS conversations_type_check;

    ALTER TABLE conversations
      ADD CONSTRAINT conversations_type_check
      CHECK(
        type IN(
          'BOOKING',
          'CONSULTATION',
          'SUPPORT',
          'CHANNEL_INBOX',
          'QUESTION',
          'EVENT'
        )
      );
  `);
}
export type Conversation = {
  id: string;
  type: string;
  context_id: string;
  state: string;
  created_by: string;
  next_sequence: string;
};
export async function member(pool: Pool | PoolClient, id: string, account: string, write = false) {
  const c = (
    await pool.query(
      'SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE c.id=$1 AND m.account_id=$2',
      [id, account],
    )
  ).rows[0] as Conversation | undefined;
  if (!c) throw new ServiceError(404, 'CONVERSATION_NOT_FOUND');
  if (write && c.state !== 'OPEN') throw new ServiceError(409, 'CONVERSATION_CLOSED');
  if (write && c.type === 'EVENT') {
    await internalCall(
      'event-service',
      '/internal/events/' +
        c.context_id +
        '/chat-authorize',
      '',
      {
        account_id:
          account,
      },
    );
  }

  if (write && ['BOOKING', 'CONSULTATION'].includes(c.type)) {
    const context = await internalCall<{ status: string; client_id: string; expert_id: string }>(
      'booking-service',
      '/internal/bookings/financial-state/' + c.context_id,
    );
    if (
      !['CONFIRMED', 'COMPLETED', 'RESCHEDULE_REQUESTED', 'RESCHEDULED'].includes(context.status) ||
      ![context.client_id, context.expert_id].includes(account)
    )
      throw new ServiceError(403, 'CONTEXT_NOT_ALLOWED');
  }
  return c;
}
export async function createConversation(
  pool: Pool,
  input: {
    type: string;
    context_id: string;
    context_key: string;
    creator: string;
    members: { id: string; role: string }[];
  },
) {
  return transaction(pool, async (db) => {
    const id = randomUUID();
    const c = (
      await db.query(
        'INSERT INTO conversations(id,type,context_key,context_id,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(context_key) DO UPDATE SET context_key=EXCLUDED.context_key RETURNING *',
        [id, input.type, input.context_key, input.context_id, input.creator],
      )
    ).rows[0];
    for (const m of input.members)
      await db.query(
        'INSERT INTO conversation_members(conversation_id,account_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [c.id, m.id, m.role],
      );
    return c;
  });
}
export const messageInput = z
  .object({
    request_key: uuid,
    type: z.enum(['TEXT', 'IMAGE', 'FILE', 'VOICE', 'VIDEO']),
    content: z.string().trim().max(12000).default(''),
    reply_to: uuid.nullable().default(null),
    files: z.array(uuid).max(8).default([]),
    duration: z.number().int().min(1).max(600).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (!v.content && !v.files.length) c.addIssue({ code: 'custom', message: 'Empty message' });
    if (v.type !== 'TEXT' && !v.files.length)
      c.addIssue({ code: 'custom', message: 'Attachment required' });
    if (v.type === 'VOICE' && !v.duration)
      c.addIssue({ code: 'custom', message: 'Duration required' });
  });
export async function sendMessage(
  pool: Pool,
  conversation: string,
  account: string,
  authorization: string,
  raw: unknown,
) {
  const d = messageInput.parse(raw),
    fingerprint = createHash('sha256').update(JSON.stringify(d)).digest('hex');
  await member(pool, conversation, account, true);
  for (const file of d.files)
    await internalCall('file-service', '/internal/files/communication-claim', authorization, {
      id: file,
      conversation_id: conversation,
      type: d.type,
    });
  return transaction(pool, async (db) => {
    await db.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [conversation]);
    await member(db, conversation, account, true);
    const existing = (
      await db.query(
        'SELECT * FROM messages WHERE conversation_id=$1 AND sender_id=$2 AND request_key=$3',
        [conversation, account, d.request_key],
      )
    ).rows[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT');
      return presentMessage(existing);
    }
    if (
      d.reply_to &&
      !(
        await db.query('SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2', [
          d.reply_to,
          conversation,
        ])
      ).rowCount
    )
      throw new ServiceError(400, 'INVALID_REPLY');
    const rate = (
      await db.query(
        "SELECT count(*)::int AS n FROM messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute'",
        [account],
      )
    ).rows[0].n;
    if (rate >= 120) throw new ServiceError(429, 'MESSAGE_RATE_LIMIT');
    const seq = (
        await db.query(
          'UPDATE conversations SET next_sequence=next_sequence+1,updated_at=now() WHERE id=$1 RETURNING next_sequence',
          [conversation],
        )
      ).rows[0].next_sequence,
      id = randomUUID();
    const row = (
      await db.query(
        'INSERT INTO messages(id,conversation_id,sender_id,sequence,type,sealed_content,reply_to,files,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
        [
          id,
          conversation,
          account,
          seq,
          d.type,
          seal({ text: d.content, duration: d.duration ?? null }, id),
          d.reply_to,
          JSON.stringify(d.files),
          d.request_key,
          fingerprint,
        ],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO communication_notifications(id,account_id,conversation_id,event) SELECT gen_random_uuid(),account_id,$1,'NEW_MESSAGE' FROM conversation_members WHERE conversation_id=$1 AND account_id<>$2",
      [conversation, account],
    );
    return presentMessage(row);
  });
}
export function presentMessage(row: Record<string, unknown>) {
  const payload = open(String(row.sealed_content), String(row.id)) as {
    text: string;
    duration: number | null;
  };
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sequence: String(row.sequence),
    type: row.type,
    content: payload.text,
    duration: payload.duration,
    reply_to: row.reply_to,
    files: row.files,
    created_at: row.created_at,
  };
}
export async function receipt(pool: Pool, conversation: string, account: string, raw: unknown) {
  const d = z
    .object({ sequence: z.string().regex(/^\d{1,18}$/), state: z.enum(['DELIVERED', 'READ']) })
    .strict()
    .parse(raw);
  const c = await member(pool, conversation, account);
  if (BigInt(d.sequence) > BigInt(c.next_sequence)) throw new ServiceError(400, 'INVALID_SEQUENCE');
  const updated = await pool.query(
    'UPDATE conversation_members SET delivered_sequence=GREATEST(delivered_sequence,$3),read_sequence=CASE WHEN $4 THEN GREATEST(read_sequence,$3) ELSE read_sequence END WHERE conversation_id=$1 AND account_id=$2 AND (delivered_sequence<$3 OR ($4 AND read_sequence<$3)) RETURNING account_id',
    [conversation, account, d.sequence, d.state === 'READ'],
  );
  return { ok: true, changed: !!updated.rowCount };
}
export async function relayNotifications(pool: Pool) {
  for (const e of (
    await pool.query(
      'SELECT * FROM communication_notifications WHERE delivered_at IS NULL ORDER BY created_at LIMIT 50',
    )
  ).rows) {
    try {
      await internalCall('notification-service', '/internal/notifications', '', {
        id: e.id,
        account_id: e.account_id,
        event: e.event,
        context_id: e.conversation_id,
        category: 'MESSAGES',
      });
      await pool.query('UPDATE communication_notifications SET delivered_at=now() WHERE id=$1', [
        e.id,
      ]);
    } catch {
      /* Retain the durable notification intent for retry. */
    }
  }
}
