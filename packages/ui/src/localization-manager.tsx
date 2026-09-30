'use client';
import { useEffect, useState } from 'react';
import { userApi } from './users-client';
import { discoveryCopy } from './discovery-copy';
import { SocialLinksManager } from './site-settings';
import { languageValue, localizedText } from './localization-runtime';
type Language = {
  code: string;
  name_en: string;
  native_name: string | null;
  direction: 'LTR' | 'RTL';
  status: 'ACTIVE' | 'INACTIVE';
  ai_supported: boolean;
  speech_supported: boolean;
  translation_supported: boolean;
  revision: number;
};
type Key = {
  id: string;
  key: string;
  default_value: string;
  revision: number;
  value: string | null;
  status: string | null;
  translation_revision: number | null;
};
type Coverage = { code: string; total: number; approved: number };
const blank: Language = {
  code: '',
  name_en: '',
  native_name: '',
  direction: 'LTR',
  status: 'ACTIVE',
  ai_supported: false,
  speech_supported: false,
  translation_supported: true,
  revision: 0,
};
export function LocalizationManager({ locale }: { locale: string }) {
  const t = discoveryCopy[locale]!,
    [tab, setTab] = useState('languages'),
    [languages, setLanguages] = useState<Language[]>([]),
    [coverage, setCoverage] = useState<Coverage[]>([]),
    [language, setLanguage] = useState('fa'),
    [edit, setEdit] = useState<Language | null>(null),
    [keys, setKeys] = useState<Key[]>([]),
    [query, setQuery] = useState(''),
    [missing, setMissing] = useState(false),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Key | null>(null),
    [value, setValue] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
      setNotice(t.saved);
    } catch (e) {
      setError(t.error + ' (' + (e as Error).message + ')');
    } finally {
      setBusy(false);
    }
  };
  async function refresh() {
    const [l, c] = await Promise.all([
      userApi<Language[]>('languages?admin=1'),
      userApi<Coverage[]>('localization/coverage'),
    ]);
    setLanguages(l);
    setCoverage(c);
  }
  async function loadKeys(start = offset) {
    setKeys(
      await userApi<Key[]>(
        'localization/keys?' +
          new URLSearchParams({
            language,
            query,
            missing: missing ? '1' : '0',
            offset: String(start),
          }),
      ),
    );
    setOffset(start);
    setSelected(null);
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  useEffect(() => {
    if (tab === 'translations') void run(() => loadKeys(0));
  }, [tab, language]);
  const choices = (
    <select
      aria-label={t.language}
      value={language}
      onChange={(e) => {
        setLanguage(e.target.value);
        setSelected(null);
      }}
    >
      {languages
        .filter((l) => l.status === 'ACTIVE')
        .map((l) => (
          <option key={l.code} value={l.code}>
            {l.native_name ?? l.name_en} · {l.code}
          </option>
        ))}
    </select>
  );
  return (
    <section className="user-card localization-manager">
      <h2>{t.admin}</h2>
      <div className="user-toolbar">
        {(['languages', 'translations', 'specialties', 'synonyms', 'site'] as const).map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setError('');
              setNotice('');
            }}
          >
            {name === 'site'
              ? localizedText(
                  locale,
                  'siteSettings.tab',
                  'Site settings',
                  'تنظیمات سایت',
                )
              : t[name]}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {tab === 'languages' && (
        <>
          <button onClick={() => setEdit({ ...blank })}>{t.add}</button>
          <p>{t.fallback}</p>
          {edit && (
            <form
              className="scholar-form user-card"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const {
                    revision,
                    code,
                    name_en,
                    native_name,
                    direction,
                    status,
                    ai_supported,
                    speech_supported,
                    translation_supported,
                  } = edit;
                  const input = {
                    code,
                    name_en,
                    native_name,
                    direction,
                    status,
                    ai_supported,
                    speech_supported,
                    translation_supported,
                  };
                  await userApi(
                    'languages' + (revision ? '/' + edit.code : ''),
                    revision ? 'PUT' : 'POST',
                    revision ? { ...input, revision } : input,
                  );
                  setEdit(null);
                  await refresh();
                });
              }}
            >
              {(['code', 'name_en', 'native_name'] as const).map((field) => (
                <label key={field}>
                  {field === 'code' ? t.code : field === 'name_en' ? t.name : t.native}
                  <input
                    required
                    value={edit[field] ?? ''}
                    disabled={field === 'code' && !!edit.revision}
                    onChange={(e) => setEdit({ ...edit, [field]: e.target.value })}
                  />
                </label>
              ))}
              <label>
                {t.direction}
                <select
                  value={edit.direction}
                  onChange={(e) => setEdit({ ...edit, direction: e.target.value as 'LTR' | 'RTL' })}
                >
                  <option>LTR</option>
                  <option>RTL</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={edit.status === 'ACTIVE'}
                  disabled={edit.code === 'en'}
                  onChange={(e) =>
                    setEdit({ ...edit, status: e.target.checked ? 'ACTIVE' : 'INACTIVE' })
                  }
                />
                {t.active}
              </label>
              {(['ai_supported', 'speech_supported', 'translation_supported'] as const).map(
                (field) => (
                  <label key={field}>
                    <input
                      type="checkbox"
                      checked={edit[field]}
                      onChange={(e) => setEdit({ ...edit, [field]: e.target.checked })}
                    />
                    {field === 'ai_supported'
                      ? t.ai
                      : field === 'speech_supported'
                        ? t.speech
                        : t.translation}
                  </label>
                ),
              )}
              <button disabled={busy}>{t.save}</button>
              <button type="button" onClick={() => setEdit(null)}>
                {t.close}
              </button>
            </form>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.language}</th>
                  <th>{t.coverage}</th>
                  <th>{t.status}</th>
                  <th>{t.edit}</th>
                </tr>
              </thead>
              <tbody>
                {languages.map((l) => {
                  const c = coverage.find((x) => x.code === l.code);
                  return (
                    <tr key={l.code}>
                      <td>
                        <bdi>{l.code}</bdi> · {l.native_name ?? l.name_en}
                      </td>
                      <td>
                        {c?.approved ?? 0}/{c?.total ?? 0} (
                        {c?.total ? Math.round((c.approved / c.total) * 100) : 0}%)
                      </td>
                      <td>{l.status}</td>
                      <td>
                        <button onClick={() => setEdit({ ...l })}>{t.edit}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === 'translations' && (
        <>
          <details>
            <summary>{t.createKey}</summary>
            <form
              className="scholar-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget,
                  data = new FormData(form);
                void run(async () => {
                  await userApi('localization/keys', 'POST', {
                    key: String(data.get('key')),
                    module: String(data.get('module')),
                    value: String(data.get('value')),
                  });
                  form.reset();
                  await loadKeys(0);
                  await refresh();
                });
              }}
            >
              <label>
                {t.key}
                <input name="key" required pattern="[a-zA-Z][a-zA-Z0-9_.-]*" maxLength={200} />
              </label>
              <label>
                {t.module}
                <input name="module" required pattern="[a-z][a-z0-9-]*" maxLength={60} />
              </label>
              <label>
                {t.source}
                <textarea name="value" required maxLength={20000} />
              </label>
              <button disabled={busy}>{t.add}</button>
            </form>
          </details>
          <form
            className="user-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => loadKeys(0));
            }}
          >
            <label>
              {t.language}
              {choices}
            </label>
            <label>
              {t.filter}
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={missing}
                onChange={(e) => setMissing(e.target.checked)}
              />
              {t.missing}
            </label>
            <button disabled={busy}>{t.filter}</button>
          </form>
          {selected && (
            <form
              className="scholar-form user-card"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (language === 'en')
                    await userApi('localization/keys/' + selected.id, 'PUT', {
                      value,
                      revision: selected.revision,
                    });
                  else
                    await userApi('localization/translation', 'POST', {
                      key_id: selected.id,
                      language,
                      value,
                      source_revision: selected.revision,
                      revision: selected.translation_revision ?? 0,
                    });
                  await loadKeys();
                  await refresh();
                });
              }}
            >
              <strong>
                <bdi>{selected.key}</bdi>
              </strong>
              <label>
                {t.source}
                <textarea aria-label={t.source} readOnly value={selected.default_value} dir="ltr" />
              </label>
              <label>
                {t.value}
                <textarea
                  aria-label={t.value}
                  required
                  rows={5}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <button disabled={busy}>{t.save}</button>
              <button type="button" onClick={() => setSelected(null)}>
                {t.close}
              </button>
            </form>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.key}</th>
                  <th>{t.source}</th>
                  <th>{t.value}</th>
                  <th>{t.status}</th>
                  <th>{t.edit}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <bdi>{k.key}</bdi>
                    </td>
                    <td>{k.default_value}</td>
                    <td>{k.value}</td>
                    <td>{k.status ?? t.pending}</td>
                    <td>
                      <button
                        onClick={() => {
                          setSelected(k);
                          setValue(k.value ?? k.default_value);
                        }}
                      >
                        {t.edit}
                      </button>
                      {language !== 'en' && k.status && k.status !== 'APPROVED' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await userApi('localization/review', 'POST', {
                                key_id: k.id,
                                language,
                                revision: k.translation_revision,
                                status:
                                  k.status === 'HUMAN_REVIEWED' ? 'APPROVED' : 'HUMAN_REVIEWED',
                              });
                              await loadKeys();
                              await refresh();
                            })
                          }
                        >
                          {k.status === 'HUMAN_REVIEWED' ? t.approve : t.review}
                        </button>
                      )}
                      {language !== 'en' && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await userApi('localization/jobs', 'POST', {
                                key_id: k.id,
                                target_language: language,
                              });
                              setNotice(t.waiting);
                            })
                          }
                        >
                          {t.queue}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="user-toolbar">
            <button
              disabled={busy || !offset}
              onClick={() => void run(() => loadKeys(Math.max(0, offset - 100)))}
            >
              {t.previous}
            </button>
            <button
              disabled={busy || keys.length < 100}
              onClick={() => void run(() => loadKeys(offset + 100))}
            >
              {t.next}
            </button>
          </div>
        </>
      )}
      {tab === 'site' && <SocialLinksManager locale={locale} />}
      {tab === 'synonyms' && <Synonyms locale={locale} languages={languages} />}
      {tab === 'specialties' && <SpecialtyTranslations locale={locale} languages={languages} />}
    </section>
  );
}
function Synonyms({ locale, languages }: { locale: string; languages: Language[] }) {
  const t = discoveryCopy[locale]!,
    [items, setItems] = useState<
      {
        id: string;
        source: string;
        target: string;
        source_language: string;
        target_language: string;
      }[]
    >([]),
    [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [from, setFrom] = useState('en'),
    [to, setTo] = useState('fa'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => setItems(await userApi<typeof items>('search/synonyms'));
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await f();
      await load();
    } catch {
      setError(t.error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(load);
  }, []);
  return (
    <>
      <form
        className="scholar-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await userApi('search/synonyms', 'POST', {
              source,
              target,
              source_language: from,
              target_language: to,
              active: true,
            });
            setSource('');
            setTarget('');
          });
        }}
      >
        <label>
          {t.dictionarySource}
          <input
            required
            maxLength={120}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          {t.sourceCode}
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {languages
              .filter((l) => l.status === 'ACTIVE')
              .map((l) => (
                <option key={l.code}>{l.code}</option>
              ))}
          </select>
        </label>
        <label>
          {t.dictionaryTarget}
          <input
            required
            maxLength={120}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <label>
          {t.targetCode}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {languages
              .filter((l) => l.status === 'ACTIVE')
              .map((l) => (
                <option key={l.code}>{l.code}</option>
              ))}
          </select>
        </label>
        <button disabled={busy}>{t.add}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void run(() => userApi('search/rebuild', 'POST', {}))}>
        {t.rebuild}
      </button>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <bdi>
              {item.source_language}: {item.source} ↔ {item.target_language}: {item.target}
            </bdi>{' '}
            <button
              disabled={busy}
              onClick={() =>
                void run(() => userApi('search/synonyms/' + item.id + '/remove', 'POST', {}))
              }
            >
              {t.remove}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
function SpecialtyTranslations({ locale, languages }: { locale: string; languages: Language[] }) {
  const t = discoveryCopy[locale]!,
    [items, setItems] = useState<{ id: string; label: Record<string, string>; kind: string }[]>([]),
    [id, setId] = useState(''),
    [language, setLanguage] = useState('fa'),
    [value, setValue] = useState(''),
    [data, setData] = useState<{
      source: { revision: number; label: Record<string, string> };
      translation: { revision: number; value: string; status: string } | null;
    } | null>(null),
    [error, setError] = useState('');
  const load = async () => {
    if (!id) return;
    const result = await userApi<NonNullable<typeof data>>(
      'localization/specialties?' + new URLSearchParams({ id, language }),
    );
    setData(result);
    setValue(result.translation?.value ?? '');
  };
  const run = async (f: () => Promise<unknown>) => {
    setError('');
    try {
      await f();
    } catch {
      setError(t.error);
    }
  };
  useEffect(() => {
    void run(async () => setItems(await userApi<typeof items>('taxonomy')));
  }, []);
  useEffect(() => {
    setData(null);
    void run(load);
  }, [id, language]);
  return (
    <>
      <label>
        {t.specialties}
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">{t.choose}</option>
          {items
            .filter((x) => x.kind !== 'language')
            .map((x) => (
              <option key={x.id} value={x.id}>
                {languageValue(x.label as { en: string; fa: string }, locale)}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t.language}
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {languages
            .filter((l) => l.code !== 'en' && l.status === 'ACTIVE')
            .map((l) => (
              <option key={l.code}>{l.code}</option>
            ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {data && (
        <form
          className="scholar-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await userApi('localization/specialties', 'POST', {
                id,
                language,
                value,
                source_revision: data.source.revision,
                revision: data.translation?.revision ?? 0,
              });
              await load();
            });
          }}
        >
          <p>
            {t.source}: {data.source.label.en}
          </p>
          <label>
            {t.value}
            <input
              required
              maxLength={120}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button>{t.save}</button>
          {data.translation && data.translation.status !== 'APPROVED' && (
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await userApi('localization/specialties/review', 'POST', {
                    id,
                    language,
                    revision: data.translation!.revision,
                    status:
                      data.translation!.status === 'HUMAN_REVIEWED' ? 'APPROVED' : 'HUMAN_REVIEWED',
                  });
                  await load();
                })
              }
            >
              {data.translation.status === 'HUMAN_REVIEWED' ? t.approve : t.review}
            </button>
          )}
        </form>
      )}
    </>
  );
}
