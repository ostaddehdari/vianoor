import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction, enqueue, currentTraceId } from '@vianoor/service-runtime';
import { AuthError, digest, encrypt, token, passwordHash, passwordVerify } from './security.js';
import type { IdentityConfig } from './config.js';
import { identityMigration } from './schema.js';
const denied = () => new AuthError(401, 'INVALID_CREDENTIALS');
const invalid = () => new AuthError(400, 'INVALID_TOKEN');
export class Identity {
  private dummyHash = '';
  constructor(
    public pool: Pool,
    public config: IdentityConfig,
  ) {}
  async initialize() {
    await transaction(this.pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(202604)');
      await db.query(identityMigration);
    });
    this.dummyHash = await passwordHash(token());
  }
  async audit(db: PoolClient, account: string, action: string) {
    await db.query('INSERT INTO identity_audit(account_id,action) VALUES($1,$2)', [
      account,
      action,
    ]);
  }
  async issueMail(
    db: PoolClient,
    account: { id: string; email: string },
    purpose: 'verify' | 'reset',
    locale: 'fa' | 'en',
  ) {
    const secret = token(),
      minutes = purpose === 'verify' ? 1440 : 30;
    // Old links are invalidated together with the new link in one transaction.
    await db.query(
      'UPDATE identity_tokens SET used_at=now() WHERE account_id=$1 AND purpose=$2 AND used_at IS NULL',
      [account.id, purpose],
    );
    await db.query(
      "INSERT INTO identity_tokens(hash,account_id,purpose,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 minute')",
      [digest(secret), account.id, purpose, minutes],
    );
    const url = `${this.config.publicUrl}/${locale}/auth/${purpose === 'verify' ? 'verify-email' : 'reset-password'}#token=${secret}`;
    const subject =
      locale === 'fa'
        ? purpose === 'verify'
          ? 'تأیید ایمیل ویانور'
          : 'بازیابی رمز ویانور'
        : purpose === 'verify'
          ? 'Verify your Vianoor email'
          : 'Reset your Vianoor password';
    const text =
      locale === 'fa'
        ? `${subject}\n\n${url}\n\nاگر این درخواست را نداده‌اید، این ایمیل را نادیده بگیرید. لینک یک‌بارمصرف است.`
        : `${subject}\n\n${url}\n\nIf you did not request this, ignore this email. This link can be used once.`;
    await db.query(
      "INSERT INTO identity_mail(id,encrypted,expires_at) VALUES($1,$2,now()+$3*interval '1 minute')",
      [
        randomUUID(),
        encrypt({ email: account.email, subject, text }, this.config.mailKey),
        minutes,
      ],
    );
  }
  async register(email: string, password: string, locale: 'fa' | 'en') {
    // Hash on both existing and new accounts to avoid a cheap enumeration oracle.
    const hash = await passwordHash(password),
      id = randomUUID();
    await transaction(this.pool, async (db) => {
      const result = await db.query(
        'INSERT INTO identity_accounts(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email',
        [id, email, hash],
      );
      if (!result.rowCount) return;
      await this.issueMail(db, result.rows[0], 'verify', locale);
      await this.audit(db, id, 'registered');
      await enqueue(
        db,
        {
          event_id: randomUUID(),
          event_type: 'identity.account.registered.v1',
          event_version: 1,
          occurred_at: new Date().toISOString(),
          producer: 'identity-service',
          tenant_id: null,
          actor_id: id,
          correlation_id: randomUUID(),
          causation_id: null,
          trace_id: currentTraceId(),
          aggregate_id: id,
          aggregate_version: 1,
          data_classification: 'PERSONAL',
          payload: { account_id: id },
        },
        'identity-service',
      );
    });
  }
  async requestMail(email: string, purpose: 'verify' | 'reset', locale: 'fa' | 'en') {
    await transaction(this.pool, async (db) => {
      const { rows } = await db.query(
        'SELECT id,email,verified_at FROM identity_accounts WHERE email=$1 FOR UPDATE',
        [email],
      );
      const account = rows[0];
      if (account && (purpose === 'reset' ? !!account.verified_at : !account.verified_at))
        await this.issueMail(db, account, purpose, locale);
    });
  }
  async consume(secret: string, purpose: 'verify' | 'reset', password?: string) {
    const hash = password === undefined ? undefined : await passwordHash(password);
    await transaction(this.pool, async (db) => {
      // Account first, then token: same lock order as mail requests and login.
      const lookup = await db.query(
        'SELECT account_id FROM identity_tokens WHERE hash=$1 AND purpose=$2',
        [digest(secret), purpose],
      );
      if (!lookup.rowCount) throw invalid();
      const id = lookup.rows[0].account_id;
      await db.query('SELECT id FROM identity_accounts WHERE id=$1 FOR UPDATE', [id]);
      const used = await db.query(
        'UPDATE identity_tokens SET used_at=now() WHERE hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() RETURNING account_id',
        [digest(secret), purpose],
      );
      if (!used.rowCount) throw invalid();
      if (purpose === 'verify') {
        await db.query(
          'UPDATE identity_accounts SET verified_at=COALESCE(verified_at,now()) WHERE id=$1',
          [id],
        );
      } else {
        await db.query('UPDATE identity_accounts SET password_hash=$2 WHERE id=$1', [id, hash]);
        await db.query(
          'UPDATE identity_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',
          [id],
        );
        await db.query(
          "UPDATE identity_tokens SET used_at=now() WHERE account_id=$1 AND purpose='reset' AND used_at IS NULL",
          [id],
        );
      }
      await this.audit(db, id, purpose === 'verify' ? 'email_verified' : 'password_reset');
    });
  }
  async login(email: string, password: string) {
    const result = await this.pool.query('SELECT * FROM identity_accounts WHERE email=$1', [email]);
    const account = result.rows[0];
    const matches = await passwordVerify(account?.password_hash ?? this.dummyHash, password);
    if (!matches || !account?.verified_at) throw denied();
    return transaction(this.pool, async (db) => {
      const fresh = await db.query(
        'SELECT password_hash FROM identity_accounts WHERE id=$1 FOR UPDATE',
        [account.id],
      );
      if (fresh.rows[0]?.password_hash !== account.password_hash) throw denied();
      const id = randomUUID(),
        access = token(),
        refresh = token();
      // Bound active sessions per account; older sessions remain revocable but expire.
      await db.query(
        `UPDATE identity_sessions SET revoked_at=now() WHERE id IN (
        SELECT id FROM identity_sessions WHERE account_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC OFFSET 9)`,
        [account.id],
      );
      await db.query(
        `INSERT INTO identity_sessions(id,account_id,access_hash,access_expires_at,expires_at,absolute_expires_at)
        VALUES($1,$2,$3,now()+interval '5 minutes',now()+interval '7 days',now()+interval '30 days')`,
        [id, account.id, digest(access)],
      );
      await db.query('INSERT INTO identity_refresh_tokens(hash,session_id) VALUES($1,$2)', [
        digest(refresh),
        id,
      ]);
      await this.audit(db, account.id, 'login');
      return { access, refresh };
    });
  }
  async refresh(secret: string) {
    const result = await transaction(this.pool, async (db) => {
      const lookup = await db.query(
        'SELECT session_id FROM identity_refresh_tokens WHERE hash=$1',
        [digest(secret)],
      );
      if (!lookup.rowCount) return null;
      const session = (
        await db.query(
          'SELECT *,expires_at>now() AND absolute_expires_at>now() AS valid FROM identity_sessions WHERE id=$1 FOR UPDATE',
          [lookup.rows[0].session_id],
        )
      ).rows[0];
      if (!session || session.revoked_at || !session.valid) return null;
      const old = (
        await db.query('SELECT used_at FROM identity_refresh_tokens WHERE hash=$1', [
          digest(secret),
        ])
      ).rows[0];
      if (old.used_at) {
        // Commit revocation before returning an error to the caller.
        await db.query('UPDATE identity_sessions SET revoked_at=now() WHERE id=$1', [session.id]);
        await this.audit(db, session.account_id, 'refresh_reuse');
        return null;
      }
      const access = token(),
        refresh = token();
      await db.query('UPDATE identity_refresh_tokens SET used_at=now() WHERE hash=$1', [
        digest(secret),
      ]);
      await db.query('INSERT INTO identity_refresh_tokens(hash,session_id) VALUES($1,$2)', [
        digest(refresh),
        session.id,
      ]);
      await db.query(
        `UPDATE identity_sessions SET access_hash=$2,access_expires_at=now()+interval '5 minutes',
        expires_at=LEAST(absolute_expires_at,now()+interval '7 days'),rotated_at=now() WHERE id=$1`,
        [session.id, digest(access)],
      );
      return { access, refresh };
    });
    if (!result) throw denied();
    return result;
  }
  async session(access: string) {
    const result = await this.pool.query(
      `SELECT s.id,s.account_id,a.email FROM identity_sessions s JOIN identity_accounts a ON a.id=s.account_id
      WHERE access_hash=$1 AND s.revoked_at IS NULL AND access_expires_at>now() AND expires_at>now() AND absolute_expires_at>now()`,
      [digest(access)],
    );
    if (!result.rowCount) throw denied();
    return result.rows[0] as { id: string; account_id: string; email: string };
  }
  async sessions(access: string) {
    const user = await this.session(access);
    const { rows } = await this.pool.query(
      `SELECT id,created_at,rotated_at,expires_at FROM identity_sessions
      WHERE account_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
      [user.account_id],
    );
    return {
      user: { id: user.account_id, email: user.email },
      sessions: rows.map((s) => ({ ...s, current: s.id === user.id })),
    };
  }
  async revoke(access: string, id?: string) {
    const user = await this.session(access);
    await this.pool.query(
      'UPDATE identity_sessions SET revoked_at=now() WHERE account_id=$1 AND ($2::uuid IS NULL OR id=$2)',
      [user.account_id, id ?? null],
    );
  }
  async logout(refresh: string) {
    await this.pool.query(
      `UPDATE identity_sessions SET revoked_at=now() WHERE id IN
      (SELECT session_id FROM identity_refresh_tokens WHERE hash=$1)`,
      [digest(refresh)],
    );
  }
}
