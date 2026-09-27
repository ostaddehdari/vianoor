'use client';
import { useEffect, useState } from 'react';
import { userApi } from './users-client';
import { discoveryCopy } from './discovery-copy';
import type { Scholar } from './scholars-client';
export function SourceLanguage({
  locale,
  value,
  onChange,
}: {
  locale: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = discoveryCopy[locale]!,
    [languages, setLanguages] = useState<
      { code: string; native_name: string | null; name_en: string }[]
    >([]);
  useEffect(() => {
    void userApi<typeof languages>('languages')
      .then(setLanguages)
      .catch(() => {});
  }, []);
  return (
    <label>
      {t.sourceLanguage}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="und">{t.unknown}</option>
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native_name ?? l.name_en}
          </option>
        ))}
      </select>
    </label>
  );
}
type Data = {
  source: Record<string, string>;
  source_hash: string;
  source_language: string;
  translations: {
    language: string;
    fields: Record<string, string>;
    status: string;
    revision: number;
  }[];
};
export function DynamicTranslations({
  locale,
  row,
  admin,
}: {
  locale: string;
  row: Scholar;
  admin: boolean;
}) {
  const t = discoveryCopy[locale]!,
    [target, setTarget] = useState('expert:' + row.id),
    [language, setLanguage] = useState(locale),
    [data, setData] = useState<Data | null>(null),
    [fields, setFields] = useState<Record<string, string>>({}),
    [languages, setLanguages] = useState<
      { code: string; native_name: string | null; name_en: string }[]
    >([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [kind, id] = target.split(':');
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await f();
    } catch (e) {
      setError(t.error + ' (' + (e as Error).message + ')');
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const result = await userApi<Data>(
      'experts/translations?' + new URLSearchParams({ kind: kind!, id: id! }),
    );
    setData(result);
    setFields(result.translations.find((x) => x.language === language)?.fields ?? result.source);
  };
  useEffect(() => {
    void run(async () => setLanguages(await userApi<typeof languages>('languages')));
  }, []);
  useEffect(() => {
    setData(null);
    void run(load);
  }, [target, language]);
  const current = data?.translations.find((x) => x.language === language);
  return (
    <details>
      <summary>{t.dynamic}</summary>
      <div className="scholar-form">
        <label>
          {t.choose}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value={'expert:' + row.id}>{t.profile}</option>
            {row.offerings.map((o) => (
              <option key={o.id} value={'service:' + o.id}>
                {t.service}: {o.details.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.language}
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native_name ?? l.name_en}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && (
        <form
          className="scholar-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await userApi('experts/translations', 'POST', {
                kind,
                id,
                language,
                fields,
                source_hash: data.source_hash,
                revision: current?.revision ?? 0,
              });
              await load();
            });
          }}
        >
          <p>
            {t.sourceLanguage}: <bdi>{data.source_language}</bdi> · {t.status}:{' '}
            {current?.status ?? t.pending}
          </p>
          {Object.entries(fields).map(([key, value]) => (
            <label key={key}>
              {t.fields[key as keyof typeof t.fields] ?? key}
              <small>{data.source[key]}</small>
              <textarea
                value={value}
                rows={3}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              />
            </label>
          ))}
          <button disabled={busy}>{t.save}</button>
          {admin && current && current.status !== 'APPROVED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await userApi('experts/translations/review', 'POST', {
                    kind,
                    id,
                    language,
                    revision: current.revision,
                    status: current.status === 'HUMAN_REVIEWED' ? 'APPROVED' : 'HUMAN_REVIEWED',
                  });
                  await load();
                })
              }
            >
              {current.status === 'HUMAN_REVIEWED' ? t.approve : t.review}
            </button>
          )}
        </form>
      )}
    </details>
  );
}
