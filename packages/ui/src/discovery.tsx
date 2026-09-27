'use client';
import { useEffect, useState } from 'react';
import { userApi, usersBase } from './users-client';
import { usersCopy } from './users-copy';
import { discoveryCopy } from './discovery-copy';
import { localeDirection } from './localization-runtime';
import { ReleaseBadge } from './release';
import { expertsPublicCopy } from './experts-public-copy';
import { LanguageSwitcher } from './language-switcher';
type Language = { code: string; native_name: string | null; name_en: string };
type Result = {
  code: string;
  slug: string;
  profile: Record<string, string>;
  languages: { code: string }[];
  available?: { service_id: string; start_at: string; end_at: string }[];
};
export function ExpertDiscovery({ locale }: { locale: string }) {
  const t = discoveryCopy[locale]!,
    [languages, setLanguages] = useState<Language[]>([]),
    [q, setQ] = useState(''),
    [spoken, setSpoken] = useState(''),
    [local, setLocal] = useState(''),
    [timezone, setTimezone] = useState('UTC'),
    [items, setItems] = useState<Result[]>([]),
    [next, setNext] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loginRequired, setLoginRequired] = useState(false);
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void userApi<Language[]>('languages')
      .then(setLanguages)
      .catch(() => setError(t.error));
    void load(0);
  }, [locale]);
  async function load(offset: number) {
    setBusy(true);
    setError('');
    setLoginRequired(false);
    try {
      const data = local
        ? await userApi<{ items: Result[]; next_offset: number | null }>(
            'matching/expert',
            'POST',
            {
              intent: q,
              language: locale,
              spoken_language: spoken,
              local,
              timezone,
              offset,
            },
          )
        : await userApi<{ items: Result[]; next_offset: number | null }>(
            'search/experts?' +
              new URLSearchParams({
                q,
                language: locale,
                ...(spoken ? { spoken_language: spoken } : {}),
                offset: String(offset),
              }),
          );
      setItems(data.items);
      setNext(data.next_offset);
    } catch (e) {
      setLoginRequired((e as Error).message === 'UNAUTHORIZED');
      setError((e as Error).message === 'UNAUTHORIZED' ? t.error + ' · ' + t.book : t.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-experts" dir={localeDirection(locale)}>
      <nav className="user-toolbar">
        <a href={`${usersBase}/${locale}`}>{expertsPublicCopy[locale]!.home}</a>
        <LanguageSwitcher locale={locale} />
        <ReleaseBadge locale={locale} />
      </nav>
      <h1>{t.title}</h1>
      <form
        className="user-card scholar-form"
        onSubmit={(e) => {
          e.preventDefault();
          void load(0);
        }}
      >
        <label>
          {t.intent}
          <input value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          {t.spoken}
          <select required={!!local} value={spoken} onChange={(e) => setSpoken(e.target.value)}>
            <option value="">{t.any}</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native_name ?? l.name_en}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>{t.guided}</summary>
          <label>
            {t.when}
            <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} />
          </label>
          <label>
            {t.timezone}
            <input dir="ltr" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </label>
          <p>{t.timeNote}</p>
        </details>
        <button className="button primary" disabled={busy}>
          {busy ? t.busy : t.search}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loginRequired && (
        <a href={`${usersBase}/${locale}/auth/login`}>{usersCopy[locale]!.login}</a>
      )}
      <div aria-live="polite">{!busy && !error && !items.length && <p>{t.empty}</p>}</div>
      <div className="scholar-grid">
        {items.map((item) => (
          <article className="user-card" key={item.code}>
            <h2>
              <a href={`${usersBase}/${locale}/experts/${item.slug}`}>
                {item.profile.display_name}
              </a>
            </h2>
            <p>{item.profile.title}</p>
            <p>{item.profile.short_bio}</p>
            <p>
              {t.spoken}:{' '}
              {item.languages
                .map((l) => languages.find((x) => x.code === l.code)?.native_name ?? l.code)
                .join(' · ')}
            </p>
            {item.available?.map((slot) => (
              <p key={slot.service_id}>
                <time dateTime={slot.start_at}>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: timezone,
                  }).format(new Date(slot.start_at))}
                </time>{' '}
                <a
                  href={`${usersBase}/${locale}/account/book?expert=${item.code}&service=${slot.service_id}`}
                >
                  {t.book}
                </a>
              </p>
            ))}
          </article>
        ))}
      </div>
      {next !== null && (
        <button disabled={busy} onClick={() => void load(next)}>
          {t.next}
        </button>
      )}
    </main>
  );
}
