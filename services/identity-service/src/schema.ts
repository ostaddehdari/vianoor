export const identityMigration = `
CREATE TABLE IF NOT EXISTS identity_accounts (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS identity_tokens (
 hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES identity_accounts(id),
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')), expires_at timestamptz NOT NULL,
 used_at timestamptz
);
CREATE INDEX IF NOT EXISTS identity_tokens_account ON identity_tokens(account_id);
CREATE TABLE IF NOT EXISTS identity_sessions (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES identity_accounts(id),
 access_hash text UNIQUE NOT NULL, access_expires_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), rotated_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS identity_sessions_account ON identity_sessions(account_id);
CREATE TABLE IF NOT EXISTS identity_refresh_tokens (
 hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES identity_sessions(id) ON DELETE CASCADE,
 used_at timestamptz
);
CREATE TABLE IF NOT EXISTS identity_mail (
 id uuid PRIMARY KEY, encrypted text NOT NULL, expires_at timestamptz NOT NULL,
 attempts int NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS identity_audit (
 id bigserial PRIMARY KEY, account_id uuid, action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
`;
export const usersMigration = `
CREATE OR REPLACE FUNCTION identity_new_public_id() RETURNS varchar(13) LANGUAGE plpgsql AS $$
DECLARE candidate varchar(13);
BEGIN
  LOOP
    candidate := substr(translate(encode(uuid_send(gen_random_uuid()),'base64'),'+/','Az'),1,13);
    EXIT WHEN candidate ~ '[A-Za-z]' AND candidate ~ '[0-9]';
  END LOOP;
  RETURN candidate;
END;
$$;
ALTER TABLE identity_accounts ADD COLUMN IF NOT EXISTS public_id varchar(13);
ALTER TABLE identity_accounts ALTER COLUMN public_id SET DEFAULT identity_new_public_id();
ALTER TABLE identity_accounts ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS identity_accounts_public_id ON identity_accounts(public_id);
CREATE TABLE IF NOT EXISTS identity_admin_audit (
 id bigserial PRIMARY KEY, actor_id uuid NOT NULL, target_id uuid NOT NULL,
 action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
`;
