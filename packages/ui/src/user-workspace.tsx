'use client';
import { useEffect, useState } from 'react';
import { usersCopy } from './users-copy';
import {
  userApi,
  usersBase,
  type Profile,
  type Workspace,
  type AvatarValue,
  type Field,
} from './users-client';
import { UserAvatar, ProfileEditor, userError } from './user-profile';
import { UserManagement, Organizations } from './user-admin';
import { FormBuilder } from './form-builder';
type Locale = 'fa' | 'en';
const href = (locale: Locale, path: string) => `${usersBase}/${locale}/${path}`;
const roleName = (locale: Locale, role: string) =>
  usersCopy[locale].roleNames[role as keyof typeof usersCopy.fa.roleNames] ?? role;
async function logout(locale: Locale) {
  const result = await fetch(`${usersBase}/api/auth/logout`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (result.ok) window.location.assign(href(locale, ''));
}
export function UserAccountMenu({ locale, profile: given }: { locale: Locale; profile?: Profile }) {
  const [profile, setProfile] = useState<Profile | undefined>(given),
    [error, setError] = useState('');
  const t = usersCopy[locale];
  useEffect(() => {
    if (given) {
      setProfile(given);
      return;
    }
    void userApi<Profile>('profiles/me')
      .then(setProfile)
      .catch(() => {});
  }, [given]);
  if (!profile)
    return (
      <a className="button compact login-link" href={href(locale, 'auth/login')}>
        {t.login}
      </a>
    );
  return (
    <details className="dashboard-account-menu">
      <summary aria-label={t.title}>
        <UserAvatar avatar={profile.avatar} name={profile.display_name} size={40} />
      </summary>
      <div className="dashboard-account-popover">
        <strong>{profile.display_name || profile.public_id}</strong>
        <small>
          <bdi>{profile.public_id}</bdi>
        </small>
        <a href={href(locale, 'account')}>{t.title}</a>
        <a href={href(locale, 'members/' + profile.public_id)}>{t.profileLink}</a>
        <a href={href(locale, 'account/profile')}>{t.editProfile}</a>
        <a href={href(locale, 'account/security')}>{t.security}</a>
        <button onClick={() => void logout(locale).catch((e) => setError(userError(e, locale)))}>
          {t.logout}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
type SessionRequest = {
  id: string;
  client_code: string;
  expert_code: string;
  preferred_date: string;
  status: 'requested' | 'reviewed' | 'cancelled';
  created_at: string;
};
function SessionRequests({
  locale,
  role,
  scope,
  complete,
}: {
  locale: Locale;
  role: string;
  scope: string;
  complete: boolean;
}) {
  const t = usersCopy[locale];
  const [items, setItems] = useState<SessionRequest[]>([]),
    [experts, setExperts] = useState<
      { public_id: string; display_name: string; avatar: AvatarValue }[]
    >([]),
    [expert, setExpert] = useState(''),
    [date, setDate] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const view = role === 'expert' ? 'expert' : role === 'secretary' ? 'secretary' : 'mine';
  const load = async () => {
    setItems(await userApi<SessionRequest[]>('bookings/requests?view=' + view));
    if (view === 'mine') setExperts(await userApi<typeof experts>('profiles/experts'));
  };
  useEffect(() => {
    if (scope === 'platform') void load().catch((e) => setError(userError(e, locale)));
  }, [view, scope]);
  if (scope !== 'platform')
    return (
      <div className="user-card">
        <p>{t.roleReady}</p>
      </div>
    );
  return (
    <section className="user-card">
      <h2>{t.requests}</h2>
      {error && (
        <p className="user-error" role="alert">
          {error}
        </p>
      )}
      {view === 'mine' && (
        <>
          <p className="user-note">{t.requestNote}</p>
          <form
            className="user-toolbar"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await userApi('bookings/requests', 'POST', { expert, preferred_date: date });
                await load();
              } catch (err) {
                setError(userError(err, locale));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t.expert}
              <select
                required
                value={expert}
                onChange={(e) => setExpert(e.target.value)}
                disabled={!complete}
              >
                <option value="">{t.choose}</option>
                {experts.map((x) => (
                  <option key={x.public_id} value={x.public_id}>
                    {x.display_name || x.public_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.preferredDate}
              <input
                required
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={!complete}
              />
            </label>
            <button className="primary" disabled={!complete || busy || !experts.length}>
              {t.submitRequest}
            </button>
          </form>
          {!experts.length && <p>{t.noExperts}</p>}
          {!!experts.length && (
            <div className="expert-directory">
              {experts.map((person) => (
                <a href={href(locale, 'members/' + person.public_id)} key={person.public_id}>
                  <UserAvatar avatar={person.avatar} size={44} />
                  <span>
                    {person.display_name || person.public_id}
                    <small>{t.profileLink}</small>
                  </span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
      {!items.length ? (
        <p>{t.noRequests}</p>
      ) : (
        <div className="user-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.client}</th>
                <th>{t.expert}</th>
                <th>{t.date}</th>
                <th>{t.status}</th>
                <th>{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <a href={href(locale, 'members/' + item.client_code)}>
                      <bdi>{item.client_code}</bdi>
                    </a>
                  </td>
                  <td>
                    <a href={href(locale, 'members/' + item.expert_code)}>
                      <bdi>{item.expert_code}</bdi>
                    </a>
                  </td>
                  <td>
                    <bdi>{item.preferred_date}</bdi>
                  </td>
                  <td>
                    <span className="user-badge">{t[item.status]}</span>
                  </td>
                  <td>
                    {item.status === 'requested' && view !== 'secretary' && (
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await userApi('bookings/requests/' + item.id, 'PATCH', {
                              status: view === 'mine' ? 'cancelled' : 'reviewed',
                            });
                            await load();
                          } catch (e) {
                            setError(userError(e, locale));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {view === 'mine' ? t.cancel : t.review}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Audit({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<
      { id: number; action: string; scope: string; occurred_at: string }[]
    >([]),
    [error, setError] = useState('');
  const t = usersCopy[locale];
  useEffect(() => {
    void userApi<typeof rows>('access/audit')
      .then(setRows)
      .catch((e) => setError(userError(e, locale)));
  }, [locale]);
  return (
    <section className="user-card">
      <h2>{t.audit}</h2>
      {error && <p role="alert">{error}</p>}
      <ul className="grant-list">
        {rows.map((row) => (
          <li key={row.id}>
            <bdi>{row.action}</bdi>
            <time>{new Date(row.occurred_at).toLocaleString(locale)}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function UserWorkspace({ locale, path }: { locale: Locale; path: string }) {
  const t = usersCopy[locale];
  const [profile, setProfile] = useState<Profile | null>(null),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [scope, setScope] = useState('platform'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const role = path.split('/')[0] || 'account';
  const section = path.split('/')[1] ?? '';
  useEffect(() => {
    setScope(new URLSearchParams(window.location.search).get('scope') ?? 'platform');
    let active = true;
    void Promise.all([
      userApi<Profile>('profiles/me'),
      userApi<{ workspaces: Workspace[] }>('access/me'),
    ])
      .then(([p, a]) => {
        if (active) {
          setProfile(p);
          setWorkspaces(a.workspaces);
        }
      })
      .catch((e) => {
        if (active) setError(userError(e, locale));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locale, path]);
  const workspace = workspaces.find((w) => w.role === role && w.scope === scope);
  const admin = role === 'admin' && scope === 'platform';
  if (loading)
    return (
      <main className="user-loading" aria-live="polite">
        {t.loading}
      </main>
    );
  if (!profile || !workspace)
    return (
      <main className="user-loading">
        <p role="alert">{error || t.denied}</p>
        <a href={href(locale, profile ? 'account' : 'auth/login')}>{profile ? t.title : t.login}</a>
      </main>
    );
  const route = (part: string) =>
    href(locale, role + (part ? '/' + part : '')) +
    (scope === 'platform' ? '' : '?scope=' + encodeURIComponent(scope));
  const links: [string, string][] = [
    ['', t.title],
    ...(role === 'account' ? [['profile', t.editProfile] as [string, string]] : []),
    ...(admin
      ? ([
          ['users', t.users],
          ['forms', t.forms],
          ['organizations', t.organizations],
          ['audit', t.audit],
        ] as [string, string][])
      : []),
    ...(role === 'organization' ? [['organizations', t.organizations] as [string, string]] : []),
    ...(role === 'auditor' ? [['audit', t.audit] as [string, string]] : []),
  ];
  return (
    <div className="users-app">
      <a className="skip-link" href="#workspace-main">
        {t.title}
      </a>
      <aside className="users-sidebar">
        <a className="brand" href={href(locale, '')}>
          <span className="brand-mark">✺</span>
          <strong>{t.brand}</strong>
        </a>
        <label className="workspace-picker">
          {t.workspace}
          <select
            className="workspace-switch"
            value={role + '|' + scope}
            onChange={(e) => {
              const [r, s] = e.target.value.split('|');
              window.location.assign(
                href(locale, r!) + (s === 'platform' ? '' : '?scope=' + encodeURIComponent(s!)),
              );
            }}
          >
            {workspaces.map((w) => (
              <option key={w.role + w.scope} value={w.role + '|' + w.scope}>
                {roleName(locale, w.role)}
                {w.organization_name ? ' · ' + w.organization_name : ''}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label={t.workspace}>
          {links.map(([part, label]) => (
            <a key={part} href={route(part)} aria-current={section === part ? 'page' : undefined}>
              {label}
            </a>
          ))}
          <a href={href(locale, 'account/profile')}>{t.profile}</a>
          <a href={href(locale, 'account/security')}>{t.security}</a>
          <a href={href(locale, '')}>{t.home}</a>
        </nav>
        <div className="sidebar-person">
          <UserAvatar avatar={profile.avatar} size={42} />
          <div>
            {profile.display_name || profile.public_id}
            <small>
              <bdi>{profile.public_id}</bdi>
            </small>
          </div>
        </div>
      </aside>
      <div className="users-content">
        <header className="users-header">
          <div>
            <small>{t.workspace}</small>
            <h1>
              {roleName(locale, role)}
              {workspace.organization_name ? ' · ' + workspace.organization_name : ''}
            </h1>
          </div>
          <div className="user-actions">
            <a
              href={
                href(locale === 'fa' ? 'en' : 'fa', path) +
                (scope === 'platform' ? '' : '?scope=' + encodeURIComponent(scope))
              }
            >
              {t.language}
            </a>
            <UserAccountMenu locale={locale} profile={profile} />
          </div>
        </header>
        <main id="workspace-main">
          {!profile.complete && section !== 'profile' && (
            <div className="completion-banner">
              <p>{t.incomplete}</p>
              <a className="button compact" href={href(locale, 'account/profile')}>
                {t.complete}
              </a>
            </div>
          )}
          {section === 'profile' && role === 'account' ? (
            <ProfileEditor
              key={profile.public_id + ':' + profile.form.id + ':' + profile.form.version}
              locale={locale}
              profile={profile}
              onSaved={setProfile}
            />
          ) : admin && section === 'users' ? (
            <UserManagement locale={locale} />
          ) : admin && section === 'forms' ? (
            <FormBuilder locale={locale} />
          ) : (admin || role === 'organization') && section === 'organizations' ? (
            <Organizations locale={locale} admin={admin} scope={scope} />
          ) : (admin || role === 'auditor') && section === 'audit' ? (
            <Audit locale={locale} />
          ) : section === '' ? (
            <>
              <section className="user-card welcome-card">
                <UserAvatar avatar={profile.avatar} name={profile.display_name} size={76} />
                <div>
                  <h2>{profile.display_name || t.title}</h2>
                  <p>
                    {t.publicId}: <bdi>{profile.public_id}</bdi>
                  </p>
                  <span className="user-badge">
                    {profile.complete ? t.completeBadge : t.complete}
                  </span>
                </div>
                <a href={href(locale, 'members/' + profile.public_id)}>{t.profileLink}</a>
              </section>
              {['account', 'expert', 'secretary'].includes(role) ? (
                <SessionRequests
                  locale={locale}
                  role={role}
                  scope={scope}
                  complete={profile.complete}
                />
              ) : admin ? (
                <div className="workspace-shortcuts">
                  {links.slice(1).map(([part, label]) => (
                    <a className="user-card" key={part} href={route(part)}>
                      {label}
                      <span aria-hidden="true">←</span>
                    </a>
                  ))}
                </div>
              ) : (
                <section className="user-card">
                  <p>{t.roleReady}</p>
                </section>
              )}
            </>
          ) : (
            <section className="user-card">
              <p>{t.roleReady}</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
type Member = {
  public_id: string;
  display_name: string;
  avatar: AvatarValue;
  fields?: {
    id: string;
    label: { fa: string; en: string };
    type: string;
    value: unknown;
    options: Field['options'];
  }[];
  answers?: Record<string, unknown>;
  form?: Profile['form'];
};
export function MemberProfile({ locale, code }: { locale: Locale; code: string }) {
  const t = usersCopy[locale];
  const [profile, setProfile] = useState<Member | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    void userApi<Member>('profiles/member/' + code)
      .then(setProfile)
      .catch((e) => setError(userError(e, locale)));
  }, [code, locale]);
  const fields =
    profile?.fields ??
    profile?.form?.definition.sections.flatMap((s) =>
      s.fields.map((f) => ({ ...f, value: profile.answers?.[f.id] })),
    ) ??
    [];
  const display = (value: unknown, field: (typeof fields)[number]): string => {
    if (Array.isArray(value)) return value.map((v) => display(v, field)).join('، ');
    if (typeof value === 'boolean') return value ? '✓' : '—';
    return field.options?.find((o) => o.value === value)?.label[locale] ?? String(value ?? '—');
  };
  return (
    <main className="member-profile">
      <a href={href(locale, 'account')}>{t.back}</a>
      {error && (
        <p role="alert" className="user-error">
          {error}
        </p>
      )}
      {profile ? (
        <section className="user-card">
          <div className="profile-identity">
            <UserAvatar avatar={profile.avatar} name={profile.display_name} size={110} />
            <div>
              <h1>{profile.display_name || profile.public_id}</h1>
              <p>
                {t.publicId}: <bdi>{profile.public_id}</bdi>
              </p>
            </div>
          </div>
          <dl>
            {fields
              .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
              .map((f) => (
                <div className="profile-property" key={f.id}>
                  <dt>{f.label[locale]}</dt>
                  <dd>
                    {f.type === 'image' ? (
                      <UserAvatar
                        avatar={{ kind: 'upload', value: String(f.value) }}
                        name={f.label[locale]}
                        size={120}
                      />
                    ) : (
                      display(f.value, f)
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ) : (
        !error && <p>{t.loading}</p>
      )}
    </main>
  );
}
