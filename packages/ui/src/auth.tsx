'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from './icons';
import { authCopy } from './auth-copy';
type Locale = 'fa' | 'en';
export type AuthAction =
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-email'
  | 'resend-verification';
const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const path = (locale: Locale, p: string) => `${prefix}/${locale}/${p}`;
async function request(action: string, data?: unknown) {
  const response = await fetch(`${prefix}/api/auth/${action}`, {
    method: action === 'session' ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(action === 'session' ? {} : { body: JSON.stringify(data ?? {}) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code ?? 'UNAVAILABLE');
  return body.data;
}
function errorText(error: unknown, locale: Locale) {
  const code = error instanceof Error ? error.message : 'UNAVAILABLE';
  const messages = authCopy[locale].errors;
  return messages[code as keyof typeof messages] ?? messages.UNAVAILABLE;
}
function Frame({
  locale,
  children,
  route,
}: {
  locale: Locale;
  children: ReactNode;
  route: string;
}) {
  const t = authCopy[locale];
  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="auth-brand" href={path(locale, '')}>
          <Icon name="leaf" />
          {t.brand}
        </a>
        <a
          className="auth-language"
          href={path(locale === 'fa' ? 'en' : 'fa', route)}
          onClick={(e) => {
            // Preserve a one-time link only in the fragment, never in the query or referrer.
            if (window.location.hash) e.currentTarget.href += window.location.hash;
          }}
        >
          <Icon name="globe" />
          {t.language}
        </a>
      </header>
      <main className="auth-layout" id="main">
        <aside className="auth-story">
          <span className="auth-eyebrow">{t.eyebrow}</span>
          <h2>{t.hero}</h2>
          <p>{t.intro}</p>
          <div className="auth-orbit" aria-hidden="true">
            <div>
              <Icon name="leaf" />
            </div>
            <span className="auth-orbit-mail">
              <Icon name="mail" />
            </span>
            <span className="auth-orbit-shield">
              <Icon name="shield" />
            </span>
          </div>
          <p className="auth-privacy">
            <Icon name="shield" />
            {t.privacy}
          </p>
        </aside>
        <section className="auth-card">{children}</section>
      </main>
      <footer className="auth-footer">
        <a href={path(locale, '')}>{t.home}</a>
        <span>{t.footer}</span>
      </footer>
    </div>
  );
}
export function AuthForm({ locale, action }: { locale: Locale; action: AuthAction }) {
  const t = authCopy[locale];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [show, setShow] = useState(false),
    [secret, setSecret] = useState('');
  const title =
    action === 'login'
      ? t.login
      : action === 'register'
        ? t.register
        : action === 'forgot-password'
          ? t.forgot
          : action === 'reset-password'
            ? t.reset
            : action === 'verify-email'
              ? t.verify
              : t.resend;
  const needsToken = action === 'verify-email' || action === 'reset-password';
  const needsPassword = ['login', 'register', 'reset-password'].includes(action);
  useEffect(() => {
    if (needsToken) {
      const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
      setSecret(/^[A-Za-z0-9_-]{43}$/.test(value) ? value : '');
    }
  }, [needsToken]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const data = new FormData(event.currentTarget),
      password = String(data.get('password') ?? '');
    if (['register', 'reset-password'].includes(action) && password !== data.get('confirm')) {
      setError(t.mismatch);
      return;
    }
    if (needsToken && !secret) {
      setError(t.missingToken);
      return;
    }
    setBusy(true);
    try {
      await request(action, {
        ...(!needsToken ? { email: data.get('email') } : { token: secret }),
        ...(needsPassword ? { password } : {}),
        ...(['register', 'forgot-password', 'resend-verification'].includes(action)
          ? { locale }
          : {}),
      });
      if (action === 'login') {
        window.location.assign(path(locale, 'account/security'));
        return;
      }
      setSuccess(
        action === 'verify-email' ? t.verified : action === 'reset-password' ? t.resetDone : t.sent,
      );
      if (needsToken) {
        setSecret('');
        window.history.replaceState(null, '', window.location.pathname);
      }
      event.currentTarget?.reset();
    } catch (e) {
      setError(errorText(e, locale));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame locale={locale} route={`auth/${action}`}>
      <span className="auth-card-icon">
        <Icon name={action === 'login' ? 'user' : needsToken ? 'shield' : 'mail'} />
      </span>
      <h1>{title}</h1>
      <p className="auth-card-intro">
        {action === 'verify-email'
          ? t.verifyHint
          : needsPassword && action !== 'login'
            ? t.hint
            : t.intro}
      </p>
      {success ? (
        <div className="auth-message success" role="status">
          <Icon name="check" />
          {success}
        </div>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          {!needsToken && (
            <label className="auth-field">
              {t.email}
              <input
                name="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@example.com"
              />
            </label>
          )}
          {needsPassword && (
            <>
              <label className="auth-field">
                {t.password}
                <input
                  name="password"
                  type={show ? 'text' : 'password'}
                  autoComplete={action === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={action === 'login' ? 1 : 15}
                  maxLength={128}
                  aria-describedby={action === 'login' ? undefined : 'password-hint'}
                />
              </label>
              <button
                className="auth-show"
                type="button"
                onClick={() => setShow(!show)}
                aria-pressed={show}
              >
                {show ? t.hide : t.show}
              </button>
              {action !== 'login' && (
                <>
                  <p id="password-hint" className="auth-hint">
                    {t.hint}
                  </p>
                  <label className="auth-field">
                    {t.confirm}
                    <input
                      name="confirm"
                      type={show ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      minLength={15}
                      maxLength={128}
                    />
                  </label>
                </>
              )}
            </>
          )}
          {needsToken && !secret && <p className="auth-hint">{t.missingToken}</p>}
          <div role="alert">{error && <p className="auth-message error">{error}</p>}</div>
          <button className="auth-submit" disabled={busy || (needsToken && !secret)} type="submit">
            {busy ? t.busy : title}
            <Icon name={locale === 'fa' ? 'arrow' : 'right'} />
          </button>
        </form>
      )}
      <nav className="auth-links" aria-label={title}>
        {action === 'login' ? (
          <>
            <a href={path(locale, 'auth/forgot-password')}>{t.forgotLink}</a>
            <a href={path(locale, 'auth/resend-verification')}>{t.resend}</a>
            <p>
              {t.newHere} <a href={path(locale, 'auth/register')}>{t.register}</a>
            </p>
          </>
        ) : (
          <>
            <a href={path(locale, 'auth/login')}>
              {t.haveAccount} {t.login}
            </a>
            {needsToken && (
              <a
                href={path(
                  locale,
                  action === 'verify-email' ? 'auth/resend-verification' : 'auth/forgot-password',
                )}
              >
                {action === 'verify-email' ? t.resend : t.forgot}
              </a>
            )}
          </>
        )}
      </nav>
    </Frame>
  );
}
type AccountSessions = {
  user: { id: string; email: string };
  sessions: { id: string; created_at: string; expires_at: string; current: boolean }[];
};
export function AccountSecurity({ locale }: { locale: Locale }) {
  const t = authCopy[locale];
  const [data, setData] = useState<AccountSessions | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  async function load() {
    try {
      setData(await request('session'));
    } catch (e) {
      if (e instanceof Error && e.message === 'INVALID_CREDENTIALS') {
        await request('refresh');
        setData(await request('session'));
      } else throw e;
    }
  }
  useEffect(() => {
    void load()
      .catch((e) => setError(errorText(e, locale)))
      .finally(() => setBusy(false));
  }, [locale]);
  async function operate(action: string, id?: string) {
    if (action === 'revoke' && !id && !window.confirm(t.confirmRevoke)) return;
    setBusy(true);
    setError('');
    try {
      await request(action, id ? { id } : {});
      if (
        action === 'logout' ||
        (action === 'revoke' && (!id || data?.sessions.find((s) => s.id === id)?.current))
      ) {
        setData(null);
        window.location.assign(path(locale, 'auth/login'));
        return;
      }
      await load();
    } catch (e) {
      setError(errorText(e, locale));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame locale={locale} route="account/security">
      <span className="auth-card-icon">
        <Icon name="shield" />
      </span>
      <h1>{t.security}</h1>
      <p className="auth-card-intro">{t.securityIntro}</p>
      <div role="alert">{error && <p className="auth-message error">{error}</p>}</div>
      {busy && !data ? (
        <p role="status">{t.loading}</p>
      ) : !data ? (
        <p>
          {t.loginRequired} <a href={path(locale, 'auth/login')}>{t.login}</a>
        </p>
      ) : (
        <>
          <div className="auth-account">
            <span>{t.account}</span>
            <strong dir="ltr">{data.user.email}</strong>
          </div>
          <h2 className="auth-session-title">{t.sessions}</h2>
          <ul className="auth-sessions">
            {data.sessions.map((s, i) => (
              <li key={s.id}>
                <div>
                  <strong>
                    <Icon name="shield" />
                    {s.current ? t.current : `${t.session} ${i + 1}`}
                  </strong>
                  <span>
                    {t.created}:{' '}
                    {new Date(s.created_at).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-GB')}
                  </span>
                  <span>
                    {t.expires}:{' '}
                    {new Date(s.expires_at).toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-GB')}
                  </span>
                </div>
                <button disabled={busy} onClick={() => operate('revoke', s.id)}>
                  {t.revoke}
                </button>
              </li>
            ))}
          </ul>
          <div className="auth-security-actions">
            <button disabled={busy} onClick={() => operate('refresh')}>
              {t.refresh}
            </button>
            <button disabled={busy} onClick={() => operate('revoke')}>
              {t.revokeAll}
            </button>
          </div>
          <button className="auth-submit" disabled={busy} onClick={() => operate('logout')}>
            {t.logout}
            <Icon name="exit" />
          </button>
        </>
      )}
      <p className="auth-hint">{t.demo}</p>
      <a href={path(locale, 'dashboards')}>{t.gallery}</a>
    </Frame>
  );
}
