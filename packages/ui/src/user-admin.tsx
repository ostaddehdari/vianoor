'use client';
import { languageValue } from './localization-runtime';
import { useEffect, useState } from 'react';
import { usersCopy } from './users-copy';
import { userApi, type Workspace, type Profile, type FormDraft, usersBase } from './users-client';
import { ProfileEditor, userError, UserAvatar } from './user-profile';
type Locale = string;
type Account = {
  public_id: string;
  email: string;
  verified_at: string | null;
  disabled_at: string | null;
};
type Organization = { id: string; name: string; parent_id: string | null };
const nameOf = (role: string, locale: Locale) =>
  usersCopy[locale]!.roleNames[role as keyof typeof usersCopy.fa.roleNames] ?? role;
export function UserManagement({ locale }: { locale: Locale }) {
  const t = usersCopy[locale]!;
  const [users, setUsers] = useState<Account[]>([]),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [selected, setSelected] = useState<Account | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [grants, setGrants] = useState<Workspace[]>([]),
    [roles, setRoles] = useState<string[]>([]),
    [organizations, setOrganizations] = useState<Organization[]>([]),
    [forms, setForms] = useState<FormDraft[]>([]),
    [role, setRole] = useState('expert'),
    [scope, setScope] = useState('platform'),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [assigned, setAssigned] = useState('');
  async function load(p = page) {
    const result = await userApi<{ users: Account[]; total: number }>('users/search', 'POST', {
      query,
      page: p,
    });
    setUsers(result.users);
    setTotal(result.total);
    setPage(p);
  }
  async function open(account: Account) {
    setError('');
    setNotice('');
    const [p, g, r, o, f] = await Promise.all([
      userApi<Profile>('profiles/admin/' + account.public_id),
      userApi<Workspace[]>('access/users/' + account.public_id),
      userApi<string[]>('access/roles'),
      userApi<Organization[]>('access/organizations'),
      userApi<FormDraft[]>('profiles/forms'),
    ]);
    setSelected(account);
    setProfile(p);
    setGrants(g);
    setRoles(r);
    setOrganizations(o);
    setForms(f);
    setAssigned(p.form.id);
  }
  async function act(fn: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(userError(e, locale));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load(0).catch((e) => setError(userError(e, locale)));
  }, []);
  async function grant(r: string, s: string, enabled: boolean) {
    if (!selected) return;
    await act(async () => {
      await userApi('access/grants', 'POST', {
        public_id: selected.public_id,
        role: r,
        scope: s,
        enabled,
      });
      setGrants(await userApi<Workspace[]>('access/users/' + selected.public_id));
      setNotice(t.saved);
    });
  }
  return (
    <section className="user-management">
      <div className="user-card">
        <div className="user-heading">
          <h2>{t.users}</h2>
          {selected && (
            <button
              onClick={() => {
                setSelected(null);
                setProfile(null);
              }}
            >
              {t.back}
            </button>
          )}
        </div>
        {error && (
          <p className="user-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="user-success" role="status">
            {notice}
          </p>
        )}
        {!selected ? (
          <>
            <form
              className="user-toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => load(0));
              }}
            >
              <label>
                {t.search}
                <input
                  value={query}
                  placeholder={t.searchPlaceholder}
                  maxLength={254}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <button disabled={busy}>{t.search}</button>
            </form>
            <form
              className="invite-user"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await userApi('users', 'POST', { email, locale });
                  setEmail('');
                  setNotice(t.invited);
                  await load(0);
                });
              }}
            >
              <label>
                {t.email}
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                />
              </label>
              <button className="primary" disabled={busy}>
                {t.invite}
              </button>
              <small>{t.invitation}</small>
            </form>
            <div className="user-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t.publicId}</th>
                    <th>{t.email}</th>
                    <th>{t.status}</th>
                    <th>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((account) => (
                    <tr key={account.public_id}>
                      <td>
                        <bdi>{account.public_id}</bdi>
                      </td>
                      <td>
                        <bdi>{account.email}</bdi>
                      </td>
                      <td>
                        {account.disabled_at
                          ? t.disabled
                          : account.verified_at
                            ? t.verified
                            : t.pending}
                      </td>
                      <td>
                        <button onClick={() => void act(() => open(account))}>{t.edit}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="user-actions">
              <button disabled={!page || busy} onClick={() => void act(() => load(page - 1))}>
                {t.previous}
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(total / 25))}
              </span>
              <button
                disabled={(page + 1) * 25 >= total || busy}
                onClick={() => void act(() => load(page + 1))}
              >
                {t.next}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="profile-identity">
              <UserAvatar avatar={profile?.avatar} size={64} />
              <div>
                <h3>{profile?.display_name || selected.public_id}</h3>
                <bdi>{selected.email}</bdi>
                <small>
                  {t.publicId}: <bdi>{selected.public_id}</bdi>
                </small>
              </div>
            </div>
            <div className="user-actions">
              <button
                disabled={busy}
                className={selected.disabled_at ? '' : 'danger'}
                onClick={() => {
                  if (!selected.disabled_at && !window.confirm(t.confirmDisable)) return;
                  void act(async () => {
                    await userApi('users/' + selected.public_id, 'PATCH', {
                      disabled: !selected.disabled_at,
                    });
                    setSelected({
                      ...selected,
                      disabled_at: selected.disabled_at ? null : new Date().toISOString(),
                    });
                    setNotice(t.saved);
                    await load();
                  });
                }}
              >
                {selected.disabled_at ? t.enable : t.disable}
              </button>
              <button
                disabled={busy || !!selected.disabled_at}
                onClick={() =>
                  void act(async () => {
                    await userApi('users/' + selected.public_id + '/invite', 'POST', { locale });
                    setNotice(t.invited);
                  })
                }
              >
                {t.inviteAgain}
              </button>
              <a href={`${usersBase}/${locale}/members/${selected.public_id}`}>{t.profileLink}</a>
            </div>
            <h3>{t.roles}</h3>
            <ul className="grant-list">
              <li>
                {nameOf('account', locale)} · {t.platform}
              </li>
              {grants.map((g) => (
                <li key={g.role + g.scope}>
                  {nameOf(g.role, locale)} ·{' '}
                  {g.scope === 'platform'
                    ? t.platform
                    : (organizations.find((o) => o.id === g.scope)?.name ?? g.scope)}
                  <button disabled={busy} onClick={() => void grant(g.role, g.scope, false)}>
                    {t.removeRole}
                  </button>
                </li>
              ))}
            </ul>
            <div className="user-toolbar">
              <label>
                {t.roles}
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {roles.map((r) => (
                    <option value={r} key={r}>
                      {nameOf(r, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.scope}
                <select value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="platform">{t.platform}</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} onClick={() => void grant(role, scope, true)}>
                {t.addRole}
              </button>
            </div>
            <div className="user-toolbar">
              <label>
                {t.assignForm}
                <select value={assigned} onChange={(e) => setAssigned(e.target.value)}>
                  {forms
                    .filter((f) => f.published > 0)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {languageValue(f.draft.title, locale)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={busy || assigned === profile?.form.id}
                onClick={() => {
                  if (!window.confirm(t.confirmAssign)) return;
                  void act(async () => {
                    await userApi('profiles/assign', 'POST', {
                      public_id: selected.public_id,
                      form_id: assigned,
                    });
                    await open(selected);
                    setNotice(t.saved);
                  });
                }}
              >
                {t.assign}
              </button>
            </div>
          </>
        )}
      </div>
      {selected && profile && (
        <ProfileEditor
          key={selected.public_id + ':' + profile.form.id + ':' + profile.form.version}
          locale={locale}
          profile={profile}
          onSaved={setProfile}
          admin
        />
      )}
    </section>
  );
}
export function Organizations({
  locale,
  admin,
  scope = 'platform',
}: {
  locale: Locale;
  admin: boolean;
  scope?: string;
}) {
  const t = usersCopy[locale]!;
  const [items, setItems] = useState<Organization[]>([]),
    [name, setName] = useState(''),
    [parent, setParent] = useState(''),
    [error, setError] = useState(''),
    [code, setCode] = useState(''),
    [role, setRole] = useState('expert'),
    [notice, setNotice] = useState(''),
    [members, setMembers] = useState<{ public_id: string; role: string }[]>([]);
  const load = async () => {
    setItems(await userApi<Organization[]>('access/organizations'));
    if (scope !== 'platform')
      setMembers(
        await userApi<{ public_id: string; role: string }[]>(
          'access/members?scope=' + encodeURIComponent(scope),
        ),
      );
  };
  useEffect(() => {
    void load().catch((e) => setError(userError(e, locale)));
  }, [scope]);
  async function grant(public_id: string, r: string, enabled: boolean) {
    try {
      await userApi('access/grants', 'POST', { public_id, role: r, scope, enabled });
      await load();
      setNotice(t.saved);
    } catch (e) {
      setError(userError(e, locale));
    }
  }
  return (
    <section className="user-card">
      <h2>{t.organizations}</h2>
      {error && (
        <p role="alert" className="user-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {admin && (
        <form
          className="user-toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              await userApi('access/organizations', 'POST', { name, parent_id: parent || null });
              setName('');
              await load();
            } catch (err) {
              setError(userError(err, locale));
            }
          }}
        >
          <label>
            {t.organizationName}
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {t.parent}
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t.independent}</option>
              {items
                .filter((o) => !o.parent_id)
                .map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <button>{t.createOrganization}</button>
        </form>
      )}
      <ul>
        {items.map((o) => (
          <li key={o.id}>
            {o.name}
            {o.parent_id ? ` · ${items.find((p) => p.id === o.parent_id)?.name ?? ''}` : ''}
          </li>
        ))}
      </ul>
      {scope !== 'platform' && (
        <>
          <h3>{t.roles}</h3>
          <form
            className="user-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void grant(code, role, true);
            }}
          >
            <label>
              {t.publicId}
              <input
                required
                pattern="[A-Za-z0-9]{13}"
                maxLength={13}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <label>
              {t.roles}
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {['expert', 'secretary', 'responder', 'support'].map((r) => (
                  <option key={r} value={r}>
                    {nameOf(r, locale)}
                  </option>
                ))}
              </select>
            </label>
            <button>{t.addRole}</button>
          </form>
          <ul className="grant-list">
            {members.map((m) => (
              <li key={m.public_id + m.role}>
                <bdi>{m.public_id}</bdi> · {nameOf(m.role, locale)}
                <button onClick={() => void grant(m.public_id, m.role, false)}>
                  {t.removeRole}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
