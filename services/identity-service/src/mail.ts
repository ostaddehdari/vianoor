import nodemailer from 'nodemailer';
import type { Pool } from 'pg';
import { transaction } from '@vianoor/service-runtime';
import { decrypt } from './security.js';
import type { IdentityConfig } from './config.js';
export function mailWorker(pool: Pool, config: IdentityConfig) {
  const transport = nodemailer.createTransport(config.smtp);
  let stopped = false,
    running: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function once() {
    await transaction(pool, async (db) => {
      await db.query('DELETE FROM identity_mail WHERE expires_at <= now()');
      const jobs = await db.query(
        'SELECT * FROM identity_mail WHERE next_at <= now() LIMIT 5 FOR UPDATE SKIP LOCKED',
      );
      for (const job of jobs.rows) {
        try {
          const message = decrypt(job.encrypted, config.mailKey);
          await transport.sendMail({
            from: config.from,
            to: message.email,
            subject: message.subject,
            text: message.text,
            disableFileAccess: true,
            disableUrlAccess: true,
          });
          await db.query('DELETE FROM identity_mail WHERE id=$1', [job.id]);
        } catch {
          await db.query(
            "UPDATE identity_mail SET attempts=attempts+1, next_at=now()+interval '60 seconds' WHERE id=$1",
            [job.id],
          );
        }
      }
    });
  }
  const tick = () => {
    running = once()
      .catch(() => {})
      .finally(() => {
        if (!stopped) timer = setTimeout(tick, 2000);
      });
  };
  tick();
  return {
    async close() {
      stopped = true;
      clearTimeout(timer);
      await running;
      transport.close();
    },
  };
}
