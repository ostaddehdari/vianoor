import type { Pool, PoolClient } from 'pg';
import type { JetStreamClient } from 'nats';
import { eventEnvelopeSchema, type EventEnvelope } from '@vianoor/contracts';

export const infrastructureMigration = `
CREATE TABLE IF NOT EXISTS infra_outbox (
  event_id uuid PRIMARY KEY, envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS infra_outbox_pending ON infra_outbox(next_attempt_at) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS infra_inbox (
  consumer text NOT NULL, event_id uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);`;

export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Caller must write the domain change and this event using the SAME transaction/client.
export async function enqueue(client: PoolClient, value: EventEnvelope, producer: string) {
  const event = eventEnvelopeSchema.parse(value);
  if (event.producer !== producer) throw new Error('Event producer mismatch');
  await client.query('INSERT INTO infra_outbox(event_id, envelope) VALUES ($1, $2)', [
    event.event_id,
    event,
  ]);
}

// A database lock serializes workers. Publish ack precedes commit; a crash can redeliver.
export async function relayOnce(pool: Pool, js: JetStreamClient): Promise<number> {
  return transaction(pool, async (client) => {
    const result = await client.query(
      'SELECT event_id, envelope FROM infra_outbox WHERE published_at IS NULL AND next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED',
    );
    let sent = 0;
    for (const row of result.rows) {
      const event = eventEnvelopeSchema.parse(row.envelope);
      try {
        await js.publish(
          `vianoor.${event.event_type}`,
          new TextEncoder().encode(JSON.stringify(event)),
          { msgID: event.event_id, timeout: 2000 },
        );
        await client.query(
          'UPDATE infra_outbox SET published_at=now(), attempts=attempts+1 WHERE event_id=$1',
          [event.event_id],
        );
        sent++;
      } catch {
        await client.query(
          "UPDATE infra_outbox SET attempts=attempts+1, next_attempt_at=now() + interval '5 seconds' WHERE event_id=$1",
          [event.event_id],
        );
      }
    }
    return sent;
  });
}

// Handler must only change this database; external effects require another outbox event.
export async function consumeOnce(
  pool: Pool,
  consumer: string,
  value: unknown,
  handler: (client: PoolClient, event: EventEnvelope) => Promise<void>,
) {
  const event = eventEnvelopeSchema.parse(value);
  return transaction(pool, async (client) => {
    const inserted = await client.query(
      'INSERT INTO infra_inbox(consumer,event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',
      [consumer, event.event_id],
    );
    if (!inserted.rowCount) return false;
    await handler(client, event);
    return true;
  });
}

// The caller provisions a durable pull consumer with explicit acknowledgment.
export async function processMessage(
  pool: Pool,
  consumer: string,
  message: {
    data: Uint8Array;
    ack(): void;
    nak(delay?: number): void;
  },
  handler: (client: PoolClient, event: EventEnvelope) => Promise<void>,
) {
  try {
    await consumeOnce(pool, consumer, JSON.parse(new TextDecoder().decode(message.data)), handler);
    message.ack(); // Only after database commit, including a previously committed duplicate.
  } catch {
    message.nak(5000);
  }
}
