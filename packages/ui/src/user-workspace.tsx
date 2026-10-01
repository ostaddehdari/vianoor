'use client';
import { SessionWorkspace } from './sessions';
import { sessionsCopy } from './sessions-copy';
import { CommunicationWorkspace } from './communication';
import { CommunicationCenter } from './communication-center';
import { communicationCopy } from './communication-copy';
import { FinanceWorkspace } from './finance';
import { financeCopy } from './finance-copy';
import { LocalizationManager } from './localization-manager';
import { discoveryCopy } from './discovery-copy';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';
import { languageValue } from './localization-runtime';
import { useEffect, useRef, useState } from 'react';
import { usersCopy } from './users-copy';
import { dashboardSections, sectionNames } from './routing';
import { ReleaseBadge } from './release';
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
import { ScholarWorkspace, TaxonomyManager, FileManager, ServiceReviewQueue } from './scholars';
import { scholarsCopy } from './scholars-copy';
import { schedulingCopy } from './scheduling-copy';
import { SchedulingWorkspace } from './scheduling';
import { Icon, type IconName } from './icons';
import { dashboard22Copy } from './dashboard22-copy';
type Locale = string;
const href = (locale: Locale, path: string) => `${usersBase}/${locale}/${path}`;
const roleName = (locale: Locale, role: string) =>
  usersCopy[locale]!.roleNames[role as keyof typeof usersCopy.fa.roleNames] ?? role;
function workspaceIcon(
  part: string,
  role: string,
): IconName {
  if (!part)
    return 'grid';

  const map: Record<
    string,
    IconName
  > = {
    sessions: 'video',
    messages: 'mail',
    channels: 'comments',
    questions: 'help',
    notifications: 'bell',
    inbox: 'mail',

    book: 'calendar',
    bookings: 'calendar',
    calendar: 'calendar',
    availability: 'clock',
    'calendar-settings': 'calendar',
    holidays: 'calendar',
    requests: 'calendar',

    professional: 'user',
    profile: 'user',
    credentials: 'shield',
    offerings: 'sparkles',

    experts: 'user',
    'expert-applications': 'user',
    verification: 'shield',
    'expert-documents': 'book',
    services: 'sparkles',
    taxonomy: 'grid',
    files: 'book',

    wallet: 'wallet',
    earnings: 'wallet',
    payouts: 'wallet',
    finance: 'wallet',

    localization: 'globe',
    users: 'user',
    forms: 'book',
    organizations: 'building',
    audit: 'shield',

    settings: 'filter',
  };

  return (
    map[part] ??
    (
      role === 'operations'
        ? 'server'
        : role === 'call'
          ? 'phone'
          : 'grid'
    )
  );
}

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
  const t = usersCopy[locale]!;
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
  const t = usersCopy[locale]!;
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
  const t = usersCopy[locale]!;
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
  const t = usersCopy[locale]!;
  const [profile, setProfile] = useState<Profile | null>(null),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [scope, setScope] = useState('platform'),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [drawerOpen, setDrawerOpen] = useState(false),
    [shellSearch, setShellSearch] = useState('');

  const sidebarRef = useRef<HTMLElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);

  const root = path.split('/')[0] || 'account';
  const role = root === 'call-center' ? 'call' : root;
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
  useEffect(() => {
    try {
      setSidebarCollapsed(
        window.localStorage.getItem(
          'vianoor:dashboard-sidebar',
        ) === 'collapsed',
      );
    } catch {
      /* localStorage is optional */
    }
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setShellSearch('');
  }, [path]);

  useEffect(() => {
    if (!drawerOpen)
      return;

    const previous =
      document.activeElement as HTMLElement | null;

    const oldOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      'hidden';

    sidebarRef.current
      ?.querySelector<HTMLElement>(
        '[data-drawer-close]',
      )
      ?.focus();

    return () => {
      document.body.style.overflow =
        oldOverflow;

      previous?.focus();
    };
  }, [drawerOpen]);

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
    ['', roleName(locale, role)],
    ...([['sessions', sessionsCopy[locale]!.sessions]] as [string, string][]),
    ...(['messages', 'channels', 'questions', 'notifications'] as const).map(
      (k) => [k, communicationCopy[locale]![k]] as [string, string],
    ),
    ...(admin || role === 'support'
      ? [['inbox', communicationCopy[locale]!.inbox] as [string, string]]
      : []),
    ...(role === 'account'
      ? ([
          ['book', schedulingCopy[locale]!.book],
          ['bookings', schedulingCopy[locale]!.bookings],
        ] as [string, string][])
      : []),
    ...(role === 'expert'
      ? ([
          ['calendar', schedulingCopy[locale]!.calendar],
          ['bookings', schedulingCopy[locale]!.expertBookings],
        ] as [string, string][])
      : []),
    ...(admin
      ? ([
          ['bookings', schedulingCopy[locale]!.adminBookings],
          ['calendar-settings', schedulingCopy[locale]!.holidays],
        ] as [string, string][])
      : []),
    ...(['account', 'expert'].includes(role)
      ? [['professional', scholarsCopy[locale]!.professional] as [string, string]]
      : []),
    ...(admin || role === 'scientific'
      ? ([
          ['experts', scholarsCopy[locale]!.experts],
          ['expert-applications', scholarsCopy[locale]!.applications],
          ['verification', scholarsCopy[locale]!.verification],
          ['expert-documents', scholarsCopy[locale]!.documents],
          ['services', scholarsCopy[locale]!.services],
          ['taxonomy', scholarsCopy[locale]!.taxonomy],
        ] as [string, string][])
      : []),
    ...(admin ? [['files', scholarsCopy[locale]!.files] as [string, string]] : []),
    ...(['account', 'expert'].includes(role)
      ? [['wallet', financeCopy[locale]!.wallet] as [string, string]]
      : []),
    ...(admin || role === 'finance'
      ? [['finance', financeCopy[locale]!.admin] as [string, string]]
      : []),
    ...(role === 'account' ? [['profile', t.editProfile] as [string, string]] : []),
    ...(admin
      ? ([
          ['localization', discoveryCopy[locale]!.admin],
          ['users', t.users],
          ['forms', t.forms],
          ['organizations', t.organizations],
          ['audit', t.audit],
        ] as [string, string][])
      : []),
    ...(role === 'organization' ? [['organizations', t.organizations] as [string, string]] : []),
    ...(role === 'auditor' ? [['audit', t.audit] as [string, string]] : []),
  ];
  const existing = new Set(links.map(([part]) => part));
  if (['account', 'expert', 'secretary'].includes(role)) {
    links.push(['requests', t.requests]);
    existing.add('requests');
  }
  for (const part of dashboardSections(role)) {
    if (!existing.has(part) && sectionNames[part]) links.push([part, sectionNames[part]![locale]!]);
  }
  const shell =
    dashboard22Copy[locale]!;

  const currentLabel =
    links.find(
      ([part]) =>
        part === section,
    )?.[1] ??
    roleName(
      locale,
      role,
    );

  const searchValue =
    shellSearch
      .trim()
      .toLocaleLowerCase(
        locale,
      );

  const shellMatches =
    searchValue
      ? links
          .filter(
            ([, label]) =>
              label
                .toLocaleLowerCase(
                  locale,
                )
                .includes(
                  searchValue,
                ),
          )
          .slice(
            0,
            6,
          )
      : [];

  const quickItems: {
    part: string;
    label: string;
    icon: IconName;
  }[] =
    role === 'account'
      ? [
          {
            part: 'book',
            label:
              schedulingCopy[locale]!
                .book,
            icon:
              'calendar',
          },

          {
            part: 'questions',
            label:
              communicationCopy[locale]!
                .questions,
            icon:
              'comments',
          },
        ]
      : role === 'expert'
        ? [
            {
              part: 'calendar',
              label:
                schedulingCopy[locale]!
                  .calendar,
              icon:
                'calendar',
            },

            {
              part: 'professional',
              label:
                scholarsCopy[locale]!
                  .professional,
              icon:
                'user',
            },
          ]
        : admin
          ? [
              {
                part: 'users',
                label:
                  t.users,
                icon:
                  'user',
              },

              {
                part:
                  'expert-applications',
                label:
                  scholarsCopy[locale]!
                    .applications,
                icon:
                  'shield',
              },
            ]
          : [
              {
                part: 'messages',
                label:
                  communicationCopy[locale]!
                    .messages,
                icon:
                  'mail',
              },
            ];

  const changeCollapsed =
    () => {
      const next =
        !sidebarCollapsed;

      setSidebarCollapsed(
        next,
      );

      try {
        window.localStorage.setItem(
          'vianoor:dashboard-sidebar',
          next
            ? 'collapsed'
            : 'expanded',
        );
      } catch {
        /* localStorage is optional */
      }
    };

  return (
    <div
      className={`users-app dash22-app${
        sidebarCollapsed
          ? ' dash22-collapsed'
          : ''
      }${
        drawerOpen
          ? ' dash22-drawer-open'
          : ''
      }`}
    >
      <a
        className="skip-link"
        href="#workspace-main"
      >
        {t.title}
      </a>

      <aside
        ref={sidebarRef}
        id="dashboard-navigation"
        className={`users-sidebar dash22-sidebar${
          drawerOpen
            ? ' is-open'
            : ''
        }`}
        aria-label={
          shell.mainNavigation
        }
        onKeyDown={(event) => {
          if (
            event.key ===
            'Escape'
          ) {
            setDrawerOpen(
              false,
            );

            drawerButtonRef
              .current
              ?.focus();
          }
        }}
      >
        <div className="dash22-sidebar-brand">
          <a
            className="brand"
            href={href(
              locale,
              '',
            )}
            data-tooltip={
              t.brand
            }
          >
            <span className="brand-mark">
              ✺
            </span>

            <strong className="dash22-brand-text">
              {t.brand}
            </strong>
          </a>

          <button
            type="button"
            className="dash22-collapse-button"
            aria-label={
              sidebarCollapsed
                ? shell.expand
                : shell.collapse
            }
            aria-pressed={
              sidebarCollapsed
            }
            onClick={
              changeCollapsed
            }
          >
            <Icon
              name={
                sidebarCollapsed
                  ? 'next'
                  : 'chevron'
              }
              className="direction-icon"
            />
          </button>

          <button
            type="button"
            data-drawer-close
            className="dash22-drawer-close"
            aria-label={
              shell.closeMenu
            }
            onClick={() =>
              setDrawerOpen(
                false,
              )
            }
          >
            <Icon name="close" />
          </button>
        </div>

        <div
          className="dash22-user-card"
          data-tooltip={
            profile.display_name ||
            roleName(
              locale,
              role,
            )
          }
        >
          <UserAvatar
            avatar={
              profile.avatar
            }
            name={
              profile.display_name
            }
            size={48}
          />

          <div className="dash22-user-copy">
            <strong>
              {profile.display_name ||
                t.title}
            </strong>

            <small>
              {roleName(
                locale,
                role,
              )}
            </small>
          </div>
        </div>

        <label
          className="workspace-picker dash22-workspace-picker"
          data-tooltip={
            roleName(
              locale,
              role,
            )
          }
        >
          <span className="dash22-field-label">
            {shell.currentWorkspace}
          </span>

          <select
            className="workspace-switch"
            aria-label={
              shell.workspace
            }
            value={
              role +
              '|' +
              scope
            }
            onChange={(
              event,
            ) => {
              const [
                nextRole,
                nextScope,
              ] =
                event.target.value.split(
                  '|',
                );

              window.location.assign(
                href(
                  locale,
                  nextRole!,
                ) +
                  (
                    nextScope ===
                    'platform'
                      ? ''
                      : '?scope=' +
                        encodeURIComponent(
                          nextScope!,
                        )
                  ),
              );
            }}
          >
            {workspaces.map(
              (
                item,
              ) => (
                <option
                  key={
                    item.role +
                    item.scope
                  }
                  value={
                    item.role +
                    '|' +
                    item.scope
                  }
                >
                  {roleName(
                    locale,
                    item.role,
                  )}
                  {item.organization_name
                    ? ' · ' +
                      item.organization_name
                    : ''}
                </option>
              ),
            )}
          </select>
        </label>

        <div className="dash22-nav-title">
          {shell.navigation}
        </div>

        <nav
          className="dash22-navigation"
          aria-label={
            shell.mainNavigation
          }
        >
          {links.map(
            ([
              part,
              label,
            ]) => {
              const active =
                section ===
                part;

              return (
                <a
                  key={
                    part
                  }
                  className="dash22-nav-link"
                  href={
                    route(
                      part,
                    )
                  }
                  aria-current={
                    active
                      ? 'page'
                      : undefined
                  }
                  data-tooltip={
                    label
                  }
                  title={
                    sidebarCollapsed
                      ? label
                      : undefined
                  }
                  onClick={() =>
                    setDrawerOpen(
                      false,
                    )
                  }
                >
                  <Icon
                    name={workspaceIcon(
                      part,
                      role,
                    )}
                  />

                  <span className="dash22-nav-text">
                    {label}
                  </span>

                  {active && (
                    <span
                      className="dash22-active-mark"
                      aria-hidden="true"
                    />
                  )}
                </a>
              );
            },
          )}
        </nav>

        <div className="dash22-sidebar-footer">
          <a
            className="dash22-nav-link"
            href={href(
              locale,
              'account/security',
            )}
            data-tooltip={
              t.security
            }
          >
            <Icon name="shield" />

            <span className="dash22-nav-text">
              {t.security}
            </span>
          </a>

          <a
            className="dash22-nav-link"
            href={href(
              locale,
              '',
            )}
            data-tooltip={
              shell.home
            }
          >
            <Icon name="exit" />

            <span className="dash22-nav-text">
              {shell.home}
            </span>
          </a>

          <div className="dash22-release">
            <ReleaseBadge
              locale={
                locale
              }
            />
          </div>
        </div>
      </aside>

      {drawerOpen && (
        <button
          type="button"
          className="dash22-backdrop"
          aria-label={
            shell.closeMenu
          }
          onClick={() =>
            setDrawerOpen(
              false,
            )
          }
        />
      )}

      <div
        className="users-content dash22-content"
        inert={
          drawerOpen ||
          undefined
        }
      >
        <header className="users-header dash22-header">
          <div className="dash22-header-start">
            <button
              ref={
                drawerButtonRef
              }
              type="button"
              className="dash22-mobile-menu"
              aria-label={
                shell.openMenu
              }
              aria-controls="dashboard-navigation"
              aria-expanded={
                drawerOpen
              }
              onClick={() =>
                setDrawerOpen(
                  true,
                )
              }
            >
              <Icon name="menu" />
            </button>

            <div className="dash22-page-title">
              <small>
                {workspace.organization_name ??
                  roleName(
                    locale,
                    role,
                  )}
              </small>

              <strong>
                {section
                  ? currentLabel
                  : shell.dashboard}
              </strong>
            </div>
          </div>

          <div className="dash22-search">
            <Icon name="search" />

            <input
              value={
                shellSearch
              }
              aria-label={
                shell.searchLabel
              }
              placeholder={
                shell.search
              }
              onChange={(
                event,
              ) =>
                setShellSearch(
                  event.target
                    .value,
                )
              }
            />

            {shellSearch && (
              <div
                className="dash22-search-results"
                role="listbox"
              >
                {shellMatches.length ? (
                  shellMatches.map(
                    ([
                      part,
                      label,
                    ]) => (
                      <a
                        key={
                          part
                        }
                        href={
                          route(
                            part,
                          )
                        }
                      >
                        <Icon
                          name={workspaceIcon(
                            part,
                            role,
                          )}
                        />

                        <span>
                          {label}
                        </span>
                      </a>
                    ),
                  )
                ) : (
                  <p>
                    {shell.noResults}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="dash22-header-actions">
            <details className="dash22-quick-create">
              <summary
                className="dash22-quick-button"
                aria-label={
                  shell.quickCreate
                }
              >
                <Icon name="sparkles" />

                <span>
                  {shell.quickCreate}
                </span>

                <Icon name="down" />
              </summary>

              <div className="dash22-quick-popover">
                <strong>
                  {shell.quickActions}
                </strong>

                {quickItems.map(
                  (
                    item,
                  ) => (
                    <a
                      key={
                        item.part
                      }
                      href={
                        route(
                          item.part,
                        )
                      }
                    >
                      <Icon
                        name={
                          item.icon
                        }
                      />

                      <span>
                        {item.label}
                      </span>
                    </a>
                  ),
                )}
              </div>
            </details>

            <CommunicationCenter
              locale={
                locale
              }
              compact
              messageHref={
                route(
                  'messages',
                )
              }
              notificationHref={
                route(
                  'notifications',
                )
              }
            />

            <ThemeToggle
              locale={
                locale
              }
            />

            <LanguageSwitcher
              locale={
                locale
              }
            />

            <div className="dash22-header-person">
              <span className="dash22-header-person-copy">
                <strong>
                  {profile.display_name ||
                    t.title}
                </strong>

                <small>
                  {roleName(
                    locale,
                    role,
                  )}
                </small>
              </span>

              <UserAccountMenu
                locale={
                  locale
                }
                profile={
                  profile
                }
              />
            </div>
          </div>
        </header>

        <main
          id="workspace-main"
          className="dash22-main"
        >

          {!profile.complete && section !== 'profile' && (
            <div className="completion-banner">
              <p>{t.incomplete}</p>
              <a className="button compact" href={href(locale, 'account/profile')}>
                {t.complete}
              </a>
            </div>
          )}
          {section === 'sessions' ? (
            <SessionWorkspace locale={locale} admin={admin} />
          ) : ['messages', 'channels', 'questions', 'notifications', 'inbox'].includes(section) ? (
            <CommunicationWorkspace
              locale={locale}
              section={section}
              admin={admin || (role === 'support' && section === 'inbox')}
              expert={role === 'expert'}
            />
          ) : ((admin || role === 'finance') && (section === 'finance' || role === 'finance')) ||
            (['account', 'expert'].includes(role) &&
              ['wallet', 'earnings', 'payouts'].includes(section)) ? (
            <FinanceWorkspace
              locale={locale}
              admin={admin || role === 'finance'}
              expert={role === 'expert'}
            />
          ) : admin && section === 'localization' ? (
            <LocalizationManager locale={locale} />
          ) : role === 'account' && section === 'book' ? (
            <SchedulingWorkspace locale={locale} mode="book" />
          ) : role === 'account' && ['bookings', 'calendar'].includes(section) ? (
            <SchedulingWorkspace locale={locale} mode="mine" />
          ) : role === 'expert' && section === 'calendar' ? (
            <SchedulingWorkspace locale={locale} mode="calendar" />
          ) : role === 'expert' && section === 'bookings' ? (
            <SchedulingWorkspace locale={locale} mode="expert" />
          ) : admin && section === 'bookings' ? (
            <SchedulingWorkspace locale={locale} mode="admin" />
          ) : admin && ['calendar-settings', 'holidays'].includes(section) ? (
            <SchedulingWorkspace locale={locale} mode="holidays" />
          ) : (section === 'professional' && ['account', 'expert'].includes(role)) ||
            (role === 'expert' &&
              ['profile', 'credentials', 'offerings', 'files'].includes(section)) ? (
            <ScholarWorkspace
              key={section}
              locale={locale}
              initialTab={
                section === 'credentials' || section === 'files'
                  ? 'documents'
                  : section === 'offerings'
                    ? 'services'
                    : 'profile'
              }
            />
          ) : ['experts', 'expert-applications', 'verification', 'expert-documents'].includes(
              section,
            ) &&
            (admin || role === 'scientific') ? (
            <ScholarWorkspace
              key={section}
              locale={locale}
              admin
              initialTab={section === 'expert-documents' ? 'documents' : 'profile'}
              initialStatus={
                section === 'expert-applications'
                  ? 'SUBMITTED'
                  : section === 'verification'
                    ? 'UNDER_REVIEW'
                    : ''
              }
            />
          ) : section === 'services' && (admin || role === 'scientific') ? (
            <ServiceReviewQueue locale={locale} />
          ) : section === 'taxonomy' && (admin || role === 'scientific') ? (
            <TaxonomyManager locale={locale} />
          ) : section === 'files' && admin ? (
            <FileManager locale={locale} />
          ) : section === 'profile' && role === 'account' ? (
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
          ) : section === 'requests' && ['account', 'expert', 'secretary'].includes(role) ? (
            <SessionRequests
              locale={locale}
              role={role}
              scope={scope}
              complete={profile.complete}
            />
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
              <h2>{links.find(([part]) => part === section)?.[1] ?? roleName(locale, role)}</h2>
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
  const t = usersCopy[locale]!;
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
    return (
      languageValue(field.options?.find((o) => o.value === value)?.label, locale) ??
      String(value ?? '—')
    );
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
                  <dt>{languageValue(f.label, locale)}</dt>
                  <dd>
                    {f.type === 'image' ? (
                      <UserAvatar
                        avatar={{ kind: 'upload', value: String(f.value) }}
                        name={languageValue(f.label, locale)}
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
