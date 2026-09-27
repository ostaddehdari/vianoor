'use client';
import { SourceLanguage, DynamicTranslations } from './dynamic-translations';
import { languageValue } from './localization-runtime';
import { useEffect, useState } from 'react';
import { userApi, usersBase } from './users-client';
import { scholarsCopy } from './scholars-copy';
import {
  emptyProfessional,
  uploadAsset,
  downloadAsset,
  type Professional,
  type Scholar,
  type Taxon,
  type DocumentDetails,
  type Offering,
} from './scholars-client';
type Locale = string;
type Copy = typeof scholarsCopy.en;
export function ExpertAssetImage({ id, alt }: { id: string | null; alt: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    setSrc('');
    if (id)
      void userApi<{ mime: string; base64: string }>('files/public/' + id)
        .then((f) => {
          if (active) setSrc('data:' + f.mime + ';base64,' + f.base64);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return src ? (
    <img className="scholar-portrait" src={src} alt={alt} width={120} height={120} />
  ) : null;
}
const stateLabel = (t: Copy, s: string) => t.states[s as keyof Copy['states']] ?? s;
type Value = string | number | boolean | null;
function Control({
  label,
  value,
  change,
  options,
  multiline = false,
  type = 'text',
  required = false,
}: {
  label: string;
  value: Value;
  change: (v: Value) => void;
  options?: { value: string; label: string }[];
  multiline?: boolean;
  type?: string;
  required?: boolean;
}) {
  if (typeof value === 'boolean')
    return (
      <label className="scholar-check">
        <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} />
        {label}
      </label>
    );
  return (
    <label>
      {label}
      {options ? (
        <select value={String(value ?? '')} onChange={(e) => change(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          rows={4}
          value={String(value ?? '')}
          onChange={(e) => change(e.target.value)}
          required={required}
        />
      ) : (
        <input
          type={type}
          value={value ?? ''}
          required={required}
          onChange={(e) =>
            change(
              type === 'number'
                ? e.target.value === ''
                  ? null
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
function AssetUpload({
  locale,
  purpose,
  onReady,
}: {
  locale: Locale;
  purpose: 'image' | 'document';
  onReady: (id: string) => void;
}) {
  const t = scholarsCopy[locale]!,
    [id, setId] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function refresh() {
    const result = await userApi<{ state: string }>('files/assets/' + id);
    setStatus(result.state);
    if (result.state === 'READY') onReady(id);
  }
  return (
    <div className="scholar-upload">
      <label>
        {t.file}
        <input
          type="file"
          accept={
            purpose === 'image'
              ? 'image/jpeg,image/png,image/webp'
              : '.pdf,image/jpeg,image/png,image/webp'
          }
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError('');
            try {
              const result = await uploadAsset(file, purpose);
              setId(result.id);
              setStatus(result.state);
            } catch {
              setError(t.error);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {status && (
        <p role="status">
          {stateLabel(t, status)}
          {status === 'SCANNING' ? ' · ' + t.scanPending : ''}
        </p>
      )}
      {id && status !== 'READY' && (
        <button type="button" onClick={() => void refresh().catch(() => setError(t.error))}>
          {t.refresh}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function ProfessionalForm({
  locale,
  initial,
  taxons,
  onSave,
}: {
  locale: Locale;
  initial: Professional;
  taxons: Taxon[];
  onSave: (v: Professional) => Promise<void>;
}) {
  const t = scholarsCopy[locale]!,
    [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false);
  const update = (key: keyof Professional, v: unknown) => setValue((p) => ({ ...p, [key]: v }));
  const field = (key: keyof Professional, type = 'text', multiline = false) => (
    <Control
      key={key}
      label={t[key as keyof Copy] as string}
      value={value[key] as Value}
      type={type}
      multiline={multiline}
      change={(v) => update(key, v)}
    />
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(value);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <div className="scholar-grid">
          <SourceLanguage
            locale={locale}
            value={value.source_language ?? 'und'}
            onChange={(v) => update('source_language', v)}
          />
          {(['display_name', 'title', 'slug', 'city', 'country', 'contact_phone'] as const).map(
            (k) => field(k),
          )}
          {field('years', 'number')}
          {(['short_bio', 'biography', 'experience', 'education'] as const).map((k) =>
            field(k, 'text', true),
          )}
          <Control
            label={t.links}
            value={value.links.join('\n')}
            multiline
            change={(v) => update('links', String(v).split('\n').filter(Boolean))}
          />
          <Control
            label={t.visibility}
            value={value.visibility}
            change={(v) => update('visibility', v)}
            options={['PUBLIC', 'HIDDEN', 'INACTIVE'].map((v) => ({
              value: v,
              label: stateLabel(t, v),
            }))}
          />
          {field('seo_title')}
          {field('seo_description', 'text', true)}
        </div>
        <h3>{t.image_id}</h3>
        <AssetUpload locale={locale} purpose="image" onReady={(id) => update('image_id', id)} />
        {value.image_id && <ExpertAssetImage id={value.image_id} alt={value.display_name} />}
        <h3>{t.specialties}</h3>
        <div className="scholar-options">
          {taxons
            .filter((x) => x.kind === 'specialty' && x.active)
            .map((x) => (
              <Control
                key={x.id}
                label={languageValue(x.label, locale)}
                value={value.specialties.includes(x.id)}
                change={(v) =>
                  update(
                    'specialties',
                    v ? [...value.specialties, x.id] : value.specialties.filter((s) => s !== x.id),
                  )
                }
              />
            ))}
        </div>
        <h3>{t.languages}</h3>
        {taxons
          .filter((x) => x.kind === 'language' && x.active)
          .map((x) => {
            const current = value.languages.find((l) => l.id === x.id);
            return (
              <div className="scholar-grid" key={x.id}>
                <Control
                  label={languageValue(x.label, locale)}
                  value={!!current}
                  change={(v) =>
                    update(
                      'languages',
                      v
                        ? [...value.languages, { id: x.id, level: 'FLUENT' }]
                        : value.languages.filter((l) => l.id !== x.id),
                    )
                  }
                />
                {current && (
                  <Control
                    label={t.level}
                    value={current.level}
                    options={['NATIVE', 'FLUENT', 'INTERMEDIATE', 'CONVERSATIONAL'].map((v) => ({
                      value: v,
                      label: stateLabel(t, v),
                    }))}
                    change={(v) =>
                      update(
                        'languages',
                        value.languages.map((l) =>
                          l.id === x.id ? { ...l, level: String(v) } : l,
                        ),
                      )
                    }
                  />
                )}
              </div>
            );
          })}
        <h3>{t.viewpoints}</h3>
        {value.viewpoints.map((v, i) => (
          <div className="user-card" key={i}>
            <Control
              label={t.topic}
              value={v.topic}
              change={(x) =>
                update(
                  'viewpoints',
                  value.viewpoints.map((p, n) => (n === i ? { ...p, topic: String(x) } : p)),
                )
              }
            />
            <Control
              label={t.text}
              value={v.text}
              multiline
              change={(x) =>
                update(
                  'viewpoints',
                  value.viewpoints.map((p, n) => (n === i ? { ...p, text: String(x) } : p)),
                )
              }
            />
            <button
              type="button"
              onClick={() =>
                update(
                  'viewpoints',
                  value.viewpoints.filter((_, n) => n !== i),
                )
              }
            >
              {t.remove}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update('viewpoints', [...value.viewpoints, { topic: '', text: '' }])}
        >
          {t.add}
        </button>
        <p>{t.editNote}</p>
        <button className="button" type="submit">
          {t.save}
        </button>
      </fieldset>
    </form>
  );
}
function DocumentForm({
  locale,
  onSave,
}: {
  locale: Locale;
  onSave: (v: DocumentDetails) => Promise<void>;
}) {
  const t = scholarsCopy[locale]!,
    [value, setValue] = useState<DocumentDetails>({
      kind: 'DEGREE',
      title: '',
      issuer: '',
      number: '',
      issued_at: null,
      expires_at: null,
      file_id: '',
      description: '',
      public_summary: false,
    }),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(value);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <div className="scholar-grid">
          <Control
            label={t.kind}
            value={value.kind}
            options={[
              'DEGREE',
              'SEMINARY',
              'CERTIFICATE',
              'LICENSE',
              'IDENTITY',
              'CV',
              'REFERENCE',
              'OTHER',
            ].map((v) => ({ value: v, label: stateLabel(t, v) }))}
            change={(v) => setValue({ ...value, kind: String(v) })}
          />
          {(['title', 'issuer', 'number', 'issued_at', 'expires_at', 'description'] as const).map(
            (k) => (
              <Control
                key={k}
                label={t[k]}
                value={value[k]}
                type={k.endsWith('_at') ? 'date' : 'text'}
                multiline={k === 'description'}
                change={(v) =>
                  setValue({ ...value, [k]: k.endsWith('_at') ? v || null : String(v ?? '') })
                }
              />
            ),
          )}
        </div>
        <Control
          label={t.public_summary}
          value={value.public_summary}
          change={(v) => setValue({ ...value, public_summary: !!v })}
        />
        <AssetUpload
          locale={locale}
          purpose="document"
          onReady={(id) => setValue((p) => ({ ...p, file_id: id }))}
        />
        <button className="button" disabled={!value.file_id}>
          {t.add}
        </button>
      </fieldset>
    </form>
  );
}
function ServiceForm({
  locale,
  taxons,
  initial,
  onSave,
}: {
  locale: Locale;
  taxons: Taxon[];
  initial?: Offering;
  onSave: (v: Offering) => Promise<void>;
}) {
  const t = scholarsCopy[locale]!,
    [value, setValue] = useState<Offering>(
      initial ?? {
        title: '',
        summary: '',
        description: '',
        kind: 'TEXT',
        specialty_id: '',
        category_id: null,
        duration_minutes: null,
        price_minor: 0,
        currency: 'IRR',
        booking_required: false,
        image_id: null,
        terms: '',
      },
    ),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(value);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <div className="scholar-grid">
          <SourceLanguage
            locale={locale}
            value={value.source_language ?? 'und'}
            onChange={(v) => setValue({ ...value, source_language: v })}
          />
          {(
            ['title', 'summary', 'description', 'duration_minutes', 'price_minor', 'terms'] as const
          ).map((k) => (
            <Control
              key={k}
              label={t[k]}
              value={value[k]}
              type={['duration_minutes', 'price_minor'].includes(k) ? 'number' : 'text'}
              multiline={['description', 'terms'].includes(k)}
              change={(v) => setValue({ ...value, [k]: v })}
            />
          ))}
          <Control
            label={t.kind}
            value={value.kind}
            options={[
              'TEXT',
              'AUDIO',
              'VIDEO',
              'IN_PERSON',
              'QUESTION',
              'CASE_REVIEW',
              'TRAINING',
            ].map((v) => ({ value: v, label: stateLabel(t, v) }))}
            change={(v) => setValue({ ...value, kind: String(v) })}
          />
          <Control
            label={t.currency}
            value={value.currency}
            options={['IRR', 'IRT', 'USD', 'EUR'].map((v) => ({ value: v, label: v }))}
            change={(v) => setValue({ ...value, currency: String(v) })}
          />
          {(['specialty_id', 'category_id'] as const).map((k) => (
            <Control
              key={k}
              label={t[k]}
              value={value[k]}
              options={[
                { value: '', label: t.select },
                ...taxons
                  .filter((x) => x.kind === (k === 'specialty_id' ? 'specialty' : 'category'))
                  .map((x) => ({ value: x.id, label: languageValue(x.label, locale) })),
              ]}
              change={(v) => setValue({ ...value, [k]: v || null })}
            />
          ))}
        </div>
        <Control
          label={t.booking_required}
          value={value.booking_required}
          change={(v) => setValue({ ...value, booking_required: !!v })}
        />
        <AssetUpload
          locale={locale}
          purpose="image"
          onReady={(id) => setValue({ ...value, image_id: id })}
        />
        <button className="button">{t.save}</button>
      </fieldset>
    </form>
  );
}
function ReviewForm({
  locale,
  statuses,
  onSave,
  internal = false,
}: {
  locale: Locale;
  statuses: string[];
  onSave: (v: {
    status: string;
    reason: string;
    internal_note: string;
    valid_until: string | null;
  }) => Promise<void>;
  internal?: boolean;
}) {
  const t = scholarsCopy[locale]!,
    [status, setStatus] = useState(statuses[0] ?? ''),
    [reason, setReason] = useState(''),
    [note, setNote] = useState(''),
    [valid, setValid] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="scholar-review"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave({
            status,
            reason,
            internal_note: note,
            valid_until: valid ? new Date(valid + 'T23:59:59Z').toISOString() : null,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <Control
          label={t.status}
          value={status}
          options={statuses.map((v) => ({ value: v, label: stateLabel(t, v) }))}
          change={(v) => setStatus(String(v))}
        />
        <Control
          label={t.reason}
          value={reason}
          required
          multiline
          change={(v) => setReason(String(v))}
        />
        {internal && (
          <>
            <Control
              label={t.internal_note}
              value={note}
              multiline
              change={(v) => setNote(String(v))}
            />
            <Control
              label={t.valid_until}
              value={valid}
              type="date"
              change={(v) => setValid(String(v))}
            />
          </>
        )}
        <button disabled={!status || !reason} className="button">
          {t.review}
        </button>
      </fieldset>
    </form>
  );
}
export function ScholarWorkspace({
  locale,
  admin = false,
  initialTab = 'profile',
  initialStatus = '',
}: {
  locale: Locale;
  admin?: boolean;
  initialTab?: string;
  initialStatus?: string;
}) {
  const t = scholarsCopy[locale]!,
    [row, setRow] = useState<Scholar | null>(null),
    [taxons, setTaxons] = useState<Taxon[]>([]),
    [items, setItems] = useState<
      { id: string; display_name: string; status: string; public_id: string }[]
    >([]),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState(initialTab),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(initialStatus),
    [filters, setFilters] = useState({
      specialty: '',
      language: '',
      from: '',
      to: '',
      documents: '',
    }),
    [editService, setEditService] = useState(''),
    [reviewServices, setReviewServices] = useState(true);
  const load = async () => {
    setTaxons(await userApi<Taxon[]>('taxonomy'));
    if (admin) {
      setItems(
        await userApi<typeof items>(
          'experts/admin?' +
            new URLSearchParams({
              ...(query ? { q: query } : {}),
              ...(status ? { status } : {}),
              ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
            }),
        ),
      );
      if (selected) setRow(await userApi<Scholar>('experts/admin/' + selected));
      setReviewServices(
        (await userApi<{ review_services: boolean }>('experts/settings')).review_services,
      );
    } else setRow(await userApi<Scholar | null>('experts/me'));
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    void load()
      .catch(() => {
        if (active) setError(t.error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected]);
  async function action(fn: () => Promise<unknown>) {
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      setMessage(t.saved);
    } catch {
      setError(t.error);
    }
  }
  if (loading) return <p role="status">{t.loading}</p>;
  return (
    <section className="user-card scholar-workspace">
      <h2>{admin ? t.experts : t.professional}</h2>
      {error && (
        <p role="alert" className="user-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {admin && !selected ? (
        <>
          <form
            className="user-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void action(load);
            }}
          >
            <Control label={t.search} value={query} change={(v) => setQuery(String(v))} />
            {(['specialty', 'language'] as const).map((k) => (
              <Control
                key={k}
                label={k === 'specialty' ? t.specialties : t.languages}
                value={filters[k]}
                options={[
                  { value: '', label: t.all },
                  ...taxons
                    .filter((x) => x.kind === k)
                    .map((x) => ({ value: x.id, label: languageValue(x.label, locale) })),
                ]}
                change={(v) => setFilters({ ...filters, [k]: String(v) })}
              />
            ))}
            {(['from', 'to'] as const).map((k) => (
              <Control
                key={k}
                label={t[k]}
                value={filters[k]}
                type="date"
                change={(v) => setFilters({ ...filters, [k]: String(v) })}
              />
            ))}
            <Control
              label={t.documents}
              value={filters.documents}
              options={[
                { value: '', label: t.all },
                { value: 'missing', label: t.missing },
                { value: 'expired', label: t.states.EXPIRED },
              ]}
              change={(v) => setFilters({ ...filters, documents: String(v) })}
            />
            <Control
              label={t.status}
              value={status}
              options={[
                { value: '', label: t.all },
                ...[
                  'DRAFT',
                  'SUBMITTED',
                  'UNDER_REVIEW',
                  'NEEDS_CHANGES',
                  'APPROVED',
                  'SUSPENDED',
                  'REJECTED',
                ].map((v) => ({ value: v, label: stateLabel(t, v) })),
              ]}
              change={(v) => setStatus(String(v))}
            />
            <button>{t.search}</button>
          </form>
          <Control
            label={t.review_services}
            value={reviewServices}
            change={(v) =>
              void action(() => userApi('experts/settings', 'PUT', { review_services: !!v }))
            }
          />
          {items.length === 0 && <p>{t.empty}</p>}
          {items.map((item) => (
            <button className="scholar-list-row" key={item.id} onClick={() => setSelected(item.id)}>
              <strong>{item.display_name || item.public_id}</strong>
              <span>{stateLabel(t, item.status)}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          {admin && (
            <button
              onClick={() => {
                setSelected('');
                setRow(null);
              }}
            >
              {t.back}
            </button>
          )}
          {!row ? (
            <>
              <p>{t.applyNote}</p>
              <ProfessionalForm
                locale={locale}
                initial={emptyProfessional}
                taxons={taxons}
                onSave={(v) => action(() => userApi('experts/me', 'POST', v))}
              />
            </>
          ) : (
            <>
              <DynamicTranslations key={row.id} locale={locale} row={row} admin={admin} />
              <div className="scholar-summary">
                <h3>{row.profile.display_name}</h3>
                <span className="user-badge">{stateLabel(t, row.status)}</span>
                <label>
                  {t.completion}: {row.completion}%<progress max={100} value={row.completion} />
                </label>
                {row.missing.length > 0 && (
                  <p>
                    {t.missing}:{' '}
                    {row.missing.map((m) => (t[m as keyof Copy] as string) || m).join('، ')}
                  </p>
                )}
                {row.verified && (
                  <a href={`${usersBase}/${locale}/experts/${row.slug}`}>{t.publicProfile}</a>
                )}
              </div>
              <div className="scholar-tabs" role="tablist">
                {['profile', 'documents', 'specialties', 'services', 'history'].map((k) => (
                  <button role="tab" aria-selected={tab === k} key={k} onClick={() => setTab(k)}>
                    {t[k as keyof Copy] as string}
                  </button>
                ))}
              </div>
              <button onClick={() => void action(load)}>{t.refresh}</button>
              {tab === 'profile' &&
                (admin ? (
                  <div className="scholar-readonly">
                    <ExpertAssetImage id={row.profile.image_id} alt={row.profile.display_name} />
                    <p>
                      {t.contact_phone}: {row.profile.contact_phone}
                    </p>
                    <h3>{row.profile.title}</h3>
                    <p>{row.profile.short_bio}</p>
                    <p>{row.profile.biography}</p>
                    <h4>{t.education}</h4>
                    <p>{row.profile.education}</p>
                    <h4>{t.experience}</h4>
                    <p>{row.profile.experience}</p>
                    <p>
                      {row.profile.city} · {row.profile.country} · {row.profile.years}
                    </p>
                    <h4>{t.languages}</h4>
                    {row.profile.languages.map((l) => (
                      <p key={l.id}>
                        {languageValue(taxons.find((x) => x.id === l.id)?.label, locale)} ·{' '}
                        {stateLabel(t, l.level)}
                      </p>
                    ))}
                    {row.profile.viewpoints.map((v, i) => (
                      <article key={i}>
                        <h4>{v.topic}</h4>
                        <p>{v.text}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <ProfessionalForm
                    key={row.revision}
                    locale={locale}
                    initial={row.profile}
                    taxons={taxons}
                    onSave={(profile) =>
                      action(() =>
                        userApi('experts/me', 'PUT', { profile, revision: row.revision }),
                      )
                    }
                  />
                ))}
              {tab === 'documents' && (
                <>
                  {row.documents.map((d) => (
                    <article className="user-card" key={d.id}>
                      <h3>{d.details.title}</h3>
                      <p>
                        {stateLabel(t, d.details.kind)} · {d.details.issuer}
                      </p>
                      <p>
                        {t.number}: {d.details.number}
                      </p>
                      <p>
                        {d.details.issued_at} — {d.details.expires_at}
                      </p>
                      <p>{d.details.description}</p>
                      <span className="user-badge">{stateLabel(t, d.status)}</span>
                      <p>{d.reason}</p>
                      <button onClick={() => void action(() => downloadAsset(d.details.file_id))}>
                        {t.download}
                      </button>
                      {admin ? (
                        <ReviewForm
                          locale={locale}
                          statuses={['APPROVED', 'REJECTED']}
                          onSave={(v) =>
                            action(() =>
                              userApi(`experts/admin/${row.id}/documents/${d.id}/review`, 'POST', {
                                status: v.status,
                                reason: v.reason,
                              }),
                            )
                          }
                        />
                      ) : (
                        <button
                          onClick={() =>
                            void action(() =>
                              userApi('experts/me/documents/' + d.id + '/remove', 'POST', {}),
                            )
                          }
                        >
                          {t.remove}
                        </button>
                      )}
                    </article>
                  ))}
                  {!admin && (
                    <DocumentForm
                      locale={locale}
                      onSave={(v) => action(() => userApi('experts/me/documents', 'POST', v))}
                    />
                  )}
                </>
              )}
              {tab === 'specialties' &&
                row.specialties.map((s) => (
                  <article key={s.specialty_id} className="user-card">
                    <h3>
                      {languageValue(taxons.find((x) => x.id === s.specialty_id)?.label, locale)}
                    </h3>
                    <p>
                      {stateLabel(t, s.status)} · {s.reason}
                    </p>
                    {admin && (
                      <ReviewForm
                        locale={locale}
                        statuses={['APPROVED', 'REJECTED']}
                        onSave={(v) =>
                          action(() =>
                            userApi(
                              `experts/admin/${row.id}/specialties/${s.specialty_id}/review`,
                              'POST',
                              { status: v.status, reason: v.reason },
                            ),
                          )
                        }
                      />
                    )}
                  </article>
                ))}
              {tab === 'services' && (
                <>
                  {row.offerings.map((s) => (
                    <article className="user-card" key={s.id}>
                      <h3>{s.details.title}</h3>
                      <p>{s.details.summary}</p>
                      <p>{s.details.description}</p>
                      <p>
                        {(
                          s.details.price_minor /
                          (['USD', 'EUR'].includes(s.details.currency) ? 100 : 1)
                        ).toLocaleString(locale)}{' '}
                        {s.details.currency} · {s.details.duration_minutes}
                      </p>
                      <p>{s.details.terms}</p>
                      <span>{stateLabel(t, s.status)}</span>
                      <p>{s.reason}</p>
                      {admin ? (
                        <ReviewForm
                          locale={locale}
                          statuses={
                            s.status === 'PENDING_REVIEW'
                              ? ['PUBLISHED', 'REJECTED', 'DISABLED']
                              : ['DISABLED']
                          }
                          onSave={(v) =>
                            action(() =>
                              userApi(`experts/admin/${row.id}/services/${s.id}/review`, 'POST', {
                                status: v.status,
                                reason: v.reason,
                                revision: s.revision,
                              }),
                            )
                          }
                        />
                      ) : (
                        <div className="user-actions">
                          <button onClick={() => setEditService(s.id)}>{t.edit}</button>
                          <button
                            onClick={() =>
                              void action(() =>
                                userApi('experts/me/services/' + s.id + '/publish', 'POST', {}),
                              )
                            }
                          >
                            {t.publish}
                          </button>
                          <button
                            onClick={() =>
                              void action(() =>
                                userApi('experts/me/services/' + s.id + '/disable', 'POST', {}),
                              )
                            }
                          >
                            {t.disable}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                  {!admin && row.verified && (
                    <ServiceForm
                      key={editService}
                      locale={locale}
                      taxons={taxons.filter(
                        (x) =>
                          x.kind !== 'specialty' ||
                          row.specialties.some(
                            (s) => s.specialty_id === x.id && s.status === 'APPROVED',
                          ),
                      )}
                      {...(editService
                        ? { initial: row.offerings.find((s) => s.id === editService)!.details }
                        : {})}
                      onSave={async (v) => {
                        await action(() =>
                          editService
                            ? userApi('experts/me/services/' + editService, 'PUT', {
                                details: v,
                                revision: row.offerings.find((s) => s.id === editService)!.revision,
                              })
                            : userApi('experts/me/services', 'POST', v),
                        );
                        setEditService('');
                      }}
                    />
                  )}
                </>
              )}
              {tab === 'history' &&
                row.decisions.map((d) => (
                  <article key={d.id} className="user-card">
                    <h3>{stateLabel(t, d.status)}</h3>
                    <p>{d.reason}</p>
                    {d.internal_note && (
                      <p>
                        {t.internal_note}: {d.internal_note}
                      </p>
                    )}
                    <time>{new Date(d.created_at).toLocaleString(locale)}</time>
                  </article>
                ))}
              {admin ? (
                <ReviewForm
                  key={row.status}
                  locale={locale}
                  internal
                  statuses={
                    row.status === 'SUBMITTED' || row.status === 'SUSPENDED'
                      ? ['UNDER_REVIEW']
                      : row.status === 'UNDER_REVIEW'
                        ? ['NEEDS_CHANGES', 'APPROVED', 'REJECTED']
                        : row.status === 'APPROVED'
                          ? ['SUSPENDED']
                          : []
                  }
                  onSave={(v) =>
                    action(() =>
                      userApi('experts/admin/' + row.id + '/review', 'POST', {
                        ...v,
                        revision: row.revision,
                      }),
                    )
                  }
                />
              ) : (
                ['DRAFT', 'NEEDS_CHANGES', 'REJECTED'].includes(row.status) && (
                  <button
                    className="button"
                    onClick={() => void action(() => userApi('experts/me/submit', 'POST', {}))}
                  >
                    {t.submit}
                  </button>
                )
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
export function TaxonomyManager({ locale }: { locale: Locale }) {
  const t = scholarsCopy[locale]!,
    blank = {
      id: '',
      kind: 'specialty',
      label: { fa: '', en: '' },
      parent_id: null,
      active: true,
      position: 0,
      icon: '',
      image_id: null,
      revision: 0,
    } as Taxon;
  const [items, setItems] = useState<Taxon[]>([]),
    [value, setValue] = useState<Taxon>(blank),
    [error, setError] = useState('');
  const load = () =>
    userApi<Taxon[]>('taxonomy?admin=1').then((rows) =>
      setItems(rows.filter((row) => row.kind !== 'language')),
    );
  useEffect(() => {
    void load().catch(() => setError(t.error));
  }, []);
  return (
    <section className="user-card scholar-workspace">
      <h2>{t.taxonomy}</h2>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            const { id, revision, ...data } = value;
            await userApi(
              'taxonomy' + (id ? '/' + id : ''),
              id ? 'PUT' : 'POST',
              id
                ? { ...data, label: { fa: data.label.fa, en: data.label.en }, revision }
                : { ...data, label: { fa: data.label.fa, en: data.label.en } },
            );
            setValue(blank);
            await load();
          } catch {
            setError(t.error);
          }
        }}
      >
        <div className="scholar-grid">
          <Control
            label={t.kind}
            value={value.kind}
            options={['specialty', 'category'].map((v) => ({
              value: v,
              label: stateLabel(t, v),
            }))}
            change={(v) => setValue({ ...value, kind: v as Taxon['kind'], parent_id: null })}
          />
          <Control
            label={t.labelFa}
            value={value.label.fa}
            change={(v) => setValue({ ...value, label: { ...value.label, fa: String(v) } })}
          />
          <Control
            label={t.labelEn}
            value={value.label.en}
            change={(v) => setValue({ ...value, label: { ...value.label, en: String(v) } })}
          />
          <Control
            label={t.parent_id}
            value={value.parent_id}
            options={[
              { value: '', label: t.select },
              ...items
                .filter((x) => x.id !== value.id && x.kind === value.kind)
                .map((x) => ({ value: x.id, label: languageValue(x.label, locale) })),
            ]}
            change={(v) => setValue({ ...value, parent_id: v ? String(v) : null })}
          />
          <Control
            label={t.position}
            value={value.position}
            type="number"
            change={(v) => setValue({ ...value, position: Number(v) })}
          />
          <Control
            label={t.icon}
            value={value.icon}
            change={(v) => setValue({ ...value, icon: String(v) })}
          />
          <Control
            label={t.active}
            value={value.active}
            change={(v) => setValue({ ...value, active: !!v })}
          />
        </div>
        <AssetUpload
          locale={locale}
          purpose="image"
          onReady={(id) => setValue({ ...value, image_id: id })}
        />
        <button className="button">{t.save}</button>
        <button type="button" onClick={() => setValue(blank)}>
          {t.create}
        </button>
      </form>
      {items.map((item) => (
        <button className="scholar-list-row" key={item.id} onClick={() => setValue(item)}>
          {languageValue(item.label, locale)} · {stateLabel(t, item.kind)} ·{' '}
          {item.active ? t.active : t.disable}
        </button>
      ))}
    </section>
  );
}
export function ServiceReviewQueue({ locale }: { locale: Locale }) {
  const t = scholarsCopy[locale]!,
    [items, setItems] = useState<
      {
        id: string;
        scholar_id: string;
        display_name: string;
        details: Offering;
        status: string;
        revision: number;
      }[]
    >([]),
    [error, setError] = useState('');
  const load = () => userApi<typeof items>('experts/admin-services').then(setItems);
  useEffect(() => {
    void load().catch(() => setError(t.error));
  }, []);
  return (
    <section className="user-card scholar-workspace">
      <h2>{t.services}</h2>
      {error && <p role="alert">{error}</p>}
      {items.length === 0 && <p>{t.empty}</p>}
      {items.map((s) => (
        <article className="user-card" key={s.id}>
          <h3>{s.details.title}</h3>
          <p>{s.display_name}</p>
          <ExpertAssetImage id={s.details.image_id} alt={s.details.title} />
          <p>{s.details.description}</p>
          <p>{stateLabel(t, s.status)}</p>
          <ReviewForm
            locale={locale}
            statuses={
              s.status === 'PENDING_REVIEW' ? ['PUBLISHED', 'REJECTED', 'DISABLED'] : ['DISABLED']
            }
            onSave={async (v) => {
              setError('');
              try {
                await userApi(`experts/admin/${s.scholar_id}/services/${s.id}/review`, 'POST', {
                  status: v.status,
                  reason: v.reason,
                  revision: s.revision,
                });
                await load();
              } catch {
                setError(t.error);
              }
            }}
          />
        </article>
      ))}
    </section>
  );
}
export function FileManager({ locale }: { locale: Locale }) {
  const t = scholarsCopy[locale]!,
    [items, setItems] = useState<
      {
        id: string;
        owner_code: string;
        name: string;
        mime: string;
        bytes: number;
        purpose: string;
        access: string;
        state: string;
        scan_status: string;
        references: number;
        created_at: string;
      }[]
    >([]),
    [limits, setLimits] = useState<{ purpose: string; max_bytes: number }[]>([]),
    [error, setError] = useState('');
  const load = async () => {
    setItems(await userApi<typeof items>('files/assets?admin=1'));
    setLimits(await userApi<typeof limits>('files/limits'));
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch {
      setError(t.error);
    }
  };
  useEffect(() => {
    void act(load);
  }, []);
  return (
    <section className="user-card scholar-workspace">
      <h2>{t.files}</h2>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => void act(load)}>{t.refresh}</button>
      {limits.map((l, i) => (
        <form
          key={l.purpose}
          className="user-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => userApi('files/limits', 'PUT', l));
          }}
        >
          <Control
            label={stateLabel(t, l.purpose) + ' · ' + t.limit}
            value={l.max_bytes}
            type="number"
            change={(v) =>
              setLimits(limits.map((x, n) => (n === i ? { ...x, max_bytes: Number(v) } : x)))
            }
          />
          <button>{t.save}</button>
        </form>
      ))}
      {items.map((f) => (
        <article className="user-card" key={f.id}>
          <h3>{f.name}</h3>
          <p>
            {t.owner}: <bdi>{f.owner_code}</bdi>
          </p>
          <p>
            {f.mime} · {t.size}: {f.bytes.toLocaleString(locale)}
          </p>
          <p>
            {stateLabel(t, f.state)} · {t.scan}: {stateLabel(t, f.scan_status)} ·{' '}
            {stateLabel(t, f.access)}
          </p>
          <p>
            {t.references}: {f.references} · {new Date(f.created_at).toLocaleString(locale)}
          </p>
          <div className="user-actions">
            <button onClick={() => void act(() => downloadAsset(f.id))}>{t.download}</button>
            {['BLOCK', 'QUARANTINE', 'RESCAN', 'DELETE'].map((action) => (
              <button
                key={action}
                onClick={() =>
                  void act(() => userApi('files/assets/' + f.id + '/action', 'POST', { action }))
                }
              >
                {stateLabel(t, action)}
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
