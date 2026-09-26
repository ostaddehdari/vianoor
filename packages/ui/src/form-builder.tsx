'use client';
import { useEffect, useState } from 'react';
import { usersCopy } from './users-copy';
import {
  userApi,
  type FormDraft,
  type FormDefinition,
  type Field,
  type Localized,
} from './users-client';
import { DynamicProfileForm, userError } from './user-profile';
type Locale = 'fa' | 'en';
const id = () => `f${crypto.randomUUID().slice(0, 8)}`;
function Bilingual({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Localized;
  onChange: (v: Localized) => void;
}) {
  return (
    <fieldset className="bilingual">
      <legend>{label}</legend>
      <label>
        {usersCopy.fa.persian}
        <input
          dir="rtl"
          value={value.fa}
          maxLength={200}
          onChange={(e) => onChange({ ...value, fa: e.target.value })}
        />
      </label>
      <label>
        {usersCopy.en.english}
        <input
          dir="ltr"
          value={value.en}
          maxLength={200}
          onChange={(e) => onChange({ ...value, en: e.target.value })}
        />
      </label>
    </fieldset>
  );
}
function ConditionValue({
  locale,
  controller,
  value,
  onChange,
}: {
  locale: Locale;
  controller: Field | undefined;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  const t = usersCopy[locale];
  if (controller?.type === 'checkbox')
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="">{t.choose}</option>
        <option value="true">{t.yes}</option>
        <option value="false">{t.no}</option>
      </select>
    );
  if (controller?.options.length)
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t.choose}</option>
        {controller.options.map((o) => (
          <option value={o.value} key={o.value}>
            {o.label[locale]}
          </option>
        ))}
      </select>
    );
  return <input value={String(value)} onChange={(e) => onChange(e.target.value)} />;
}
export function FormBuilder({ locale }: { locale: Locale }) {
  const t = usersCopy[locale];
  const [forms, setForms] = useState<FormDraft[]>([]),
    [selected, setSelected] = useState(''),
    [draft, setDraft] = useState<FormDefinition | null>(null),
    [section, setSection] = useState(0),
    [field, setField] = useState(-1),
    [preview, setPreview] = useState(false),
    [answers, setAnswers] = useState<Record<string, unknown>>({}),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const current = forms.find((f) => f.id === selected);
  const currentSection = draft?.sections[section];
  const currentField = currentSection?.fields[field];
  async function load(preferred?: string) {
    const list = await userApi<FormDraft[]>('profiles/forms');
    setForms(list);
    const form = list.find((f) => f.id === (preferred ?? selected)) ?? list[0];
    if (form) {
      setSelected(form.id);
      setDraft(structuredClone(form.draft));
      setSection(0);
      setField(-1);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(userError(e, locale)));
  }, []);
  function updateForm(change: (form: FormDefinition) => void) {
    if (!draft) return;
    const copy = structuredClone(draft);
    change(copy);
    setDraft(copy);
    setNotice('');
  }
  function updateField(change: Partial<Field>) {
    updateForm((form) => {
      Object.assign(form.sections[section]!.fields[field]!, change);
    });
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(t.saved);
    } catch (e) {
      setError(userError(e, locale));
    } finally {
      setBusy(false);
    }
  }
  async function save(publish = false) {
    if (!current || !draft) return;
    if (publish && !window.confirm(t.publishConfirm)) return;
    await act(async () => {
      await userApi('profiles/forms/' + current.id, 'PUT', {
        definition: draft,
        revision: current.revision,
      });
      if (publish)
        await userApi('profiles/forms/' + current.id + '/publish', 'POST', {
          revision: current.revision + 1,
        });
      await load(current.id);
    });
  }
  async function create() {
    await act(async () => {
      const definition: FormDefinition = {
        title: { fa: usersCopy.fa.newForm, en: usersCopy.en.newForm },
        layout: 'steps',
        sections: [
          {
            id: id(),
            title: { fa: usersCopy.fa.sectionTitle, en: usersCopy.en.sectionTitle },
            fields: [],
          },
        ],
      };
      const result = await userApi<{ id: string }>('profiles/forms', 'POST', definition);
      await load(result.id);
    });
  }
  return (
    <section className="user-card form-builder">
      <div className="user-heading">
        <h2>{t.forms}</h2>
        <button type="button" onClick={() => void create()} disabled={busy}>
          {t.newForm}
        </button>
      </div>
      {error && (
        <p role="alert" className="user-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="user-success">
          {notice}
        </p>
      )}
      <div className="user-toolbar">
        <label>
          {t.forms}
          <select
            value={selected}
            onChange={(e) => {
              const form = forms.find((f) => f.id === e.target.value)!;
              setSelected(form.id);
              setDraft(structuredClone(form.draft));
              setSection(0);
              setField(-1);
            }}
          >
            {forms.map((form) => (
              <option key={form.id} value={form.id}>
                {form.draft.title[locale]}
                {form.is_default ? ` · ${t.defaultForm}` : ''}
              </option>
            ))}
          </select>
        </label>
        <span>
          {t.published}: {current?.published ?? 0} · {t.draft}: {current?.revision ?? 0}
        </span>
      </div>
      {draft && (
        <>
          <div className="user-actions">
            <button disabled={busy} onClick={() => void save()}>
              {t.save}
            </button>
            <button className="primary" disabled={busy} onClick={() => void save(true)}>
              {t.publish}
            </button>
            <button onClick={() => setPreview(!preview)}>{preview ? t.editor : t.preview}</button>
          </div>
          {preview ? (
            <DynamicProfileForm
              definition={draft}
              locale={locale}
              answers={answers}
              onChange={setAnswers}
              onError={(e) => setError(userError(e, locale))}
            />
          ) : (
            <>
              <Bilingual
                label={t.formTitle}
                value={draft.title}
                onChange={(title) =>
                  updateForm((f) => {
                    f.title = title;
                  })
                }
              />
              <label className="user-field">
                {t.layout}
                <select
                  value={draft.layout}
                  onChange={(e) =>
                    updateForm((f) => {
                      f.layout = e.target.value as 'tabs' | 'steps';
                    })
                  }
                >
                  <option value="tabs">{t.tabs}</option>
                  <option value="steps">{t.steps}</option>
                </select>
              </label>
              <nav className="form-sections" aria-label={t.sectionTitle}>
                {draft.sections.map((s, i) => (
                  <button
                    type="button"
                    key={s.id}
                    aria-current={i === section ? 'step' : undefined}
                    className={section === i ? 'selected' : ''}
                    onClick={() => {
                      setSection(i);
                      setField(-1);
                    }}
                  >
                    {s.title[locale]}
                  </button>
                ))}
                <button
                  disabled={draft.sections.length >= 12}
                  onClick={() => {
                    updateForm((f) => {
                      f.sections.push({
                        id: id(),
                        title: { fa: usersCopy.fa.sectionTitle, en: usersCopy.en.sectionTitle },
                        fields: [],
                      });
                    });
                    setSection(draft.sections.length);
                    setField(-1);
                  }}
                >
                  {t.newSection}
                </button>
              </nav>
              {currentSection && (
                <>
                  <Bilingual
                    label={t.sectionTitle}
                    value={currentSection.title}
                    onChange={(title) =>
                      updateForm((f) => {
                        f.sections[section]!.title = title;
                      })
                    }
                  />
                  <div className="user-actions">
                    <button
                      disabled={draft.sections.length === 1}
                      onClick={() => {
                        updateForm((f) => {
                          f.sections.splice(section, 1);
                        });
                        setSection(0);
                        setField(-1);
                      }}
                    >
                      {t.deleteSection}
                    </button>
                    <button
                      disabled={section === 0}
                      onClick={() => {
                        updateForm((f) => {
                          const [item] = f.sections.splice(section, 1);
                          f.sections.splice(section - 1, 0, item!);
                        });
                        setSection(section - 1);
                      }}
                    >
                      {t.moveUp}
                    </button>
                    <button
                      disabled={section === draft.sections.length - 1}
                      onClick={() => {
                        updateForm((f) => {
                          const [item] = f.sections.splice(section, 1);
                          f.sections.splice(section + 1, 0, item!);
                        });
                        setSection(section + 1);
                      }}
                    >
                      {t.moveDown}
                    </button>
                  </div>
                  <div className="builder-grid">
                    <aside className="field-palette">
                      <h3>{t.fieldPalette}</h3>
                      {(Object.keys(t.fieldTypes) as Field['type'][]).map((type) => (
                        <button
                          type="button"
                          key={type}
                          disabled={currentSection.fields.length >= 30}
                          onClick={() => {
                            updateForm((f) => {
                              f.sections[section]!.fields.push({
                                id: id(),
                                type,
                                label: {
                                  fa: usersCopy.fa.fieldTypes[type],
                                  en: usersCopy.en.fieldTypes[type],
                                },
                                required: false,
                                visibility: 'private',
                                options: ['select', 'radio', 'multiselect'].includes(type)
                                  ? [
                                      {
                                        value: 'first',
                                        label: { fa: usersCopy.fa.choose, en: usersCopy.en.choose },
                                      },
                                    ]
                                  : [],
                              });
                            });
                            setField(currentSection.fields.length);
                          }}
                        >
                          {t.fieldTypes[type]} <span aria-hidden="true">＋</span>
                        </button>
                      ))}
                    </aside>
                    <div className="field-canvas">
                      <h3>{t.preview}</h3>
                      {!currentSection.fields.length && <p>{t.noFields}</p>}
                      {currentSection.fields.map((item, i) => (
                        <button
                          className={`field-tile ${field === i ? 'selected' : ''}`}
                          key={item.id}
                          onClick={() => setField(i)}
                        >
                          <strong>
                            {item.label[locale]}
                            {item.required ? ' *' : ''}
                          </strong>
                          <span>{t.fieldTypes[item.type]}</span>
                          <span className="field-placeholder" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    <aside className="field-settings">
                      <h3>{t.fieldSettings}</h3>
                      {currentField ? (
                        <>
                          <Bilingual
                            label={t.fieldLabel}
                            value={currentField.label}
                            onChange={(label) => updateField({ label })}
                          />
                          <label className="choice">
                            <input
                              type="checkbox"
                              checked={currentField.required}
                              onChange={(e) => updateField({ required: e.target.checked })}
                            />
                            {t.required}
                          </label>
                          <label>
                            {t.scope}
                            <select
                              value={currentField.visibility}
                              onChange={(e) =>
                                updateField({ visibility: e.target.value as Field['visibility'] })
                              }
                            >
                              <option value="private">{t.private}</option>
                              <option value="members">{t.members}</option>
                            </select>
                          </label>
                          {['select', 'radio', 'multiselect'].includes(currentField.type) && (
                            <div>
                              <h4>{t.options}</h4>
                              {currentField.options.map((option, index) => (
                                <div key={option.value}>
                                  <Bilingual
                                    label={`${t.options} ${index + 1}`}
                                    value={option.label}
                                    onChange={(label) =>
                                      updateField({
                                        options: currentField.options.map((o, i) =>
                                          i === index ? { ...o, label } : o,
                                        ),
                                      })
                                    }
                                  />
                                  <button
                                    onClick={() =>
                                      updateField({
                                        options: currentField.options.filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    {t.removeOption}
                                  </button>
                                </div>
                              ))}
                              <button
                                disabled={currentField.options.length >= 30}
                                onClick={() =>
                                  updateField({
                                    options: [
                                      ...currentField.options,
                                      {
                                        value: id(),
                                        label: {
                                          fa: usersCopy.fa.addOption,
                                          en: usersCopy.en.addOption,
                                        },
                                      },
                                    ],
                                  })
                                }
                              >
                                {t.addOption}
                              </button>
                            </div>
                          )}
                          {currentField.type === 'number' && (
                            <div className="two-columns">
                              <label>
                                {t.min}
                                <input
                                  type="number"
                                  value={currentField.min ?? ''}
                                  onChange={(e) =>
                                    updateForm((f) => {
                                      const item = f.sections[section]!.fields[field]!;
                                      if (e.target.value === '') delete item.min;
                                      else item.min = Number(e.target.value);
                                    })
                                  }
                                />
                              </label>
                              <label>
                                {t.max}
                                <input
                                  type="number"
                                  value={currentField.max ?? ''}
                                  onChange={(e) =>
                                    updateForm((f) => {
                                      const item = f.sections[section]!.fields[field]!;
                                      if (e.target.value === '') delete item.max;
                                      else item.max = Number(e.target.value);
                                    })
                                  }
                                />
                              </label>
                            </div>
                          )}
                          <label>
                            {t.condition}
                            <select
                              value={currentField.showWhen?.field ?? ''}
                              onChange={(e) =>
                                updateForm((f) => {
                                  const item = f.sections[section]!.fields[field]!;
                                  if (e.target.value)
                                    item.showWhen = { field: e.target.value, equals: '' };
                                  else delete item.showWhen;
                                })
                              }
                            >
                              <option value="">{t.always}</option>
                              {draft.sections
                                .flatMap((s, i) =>
                                  i < section
                                    ? s.fields
                                    : i === section
                                      ? s.fields.slice(0, field)
                                      : [],
                                )
                                .filter((f) =>
                                  ['text', 'select', 'radio', 'checkbox'].includes(f.type),
                                )
                                .map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.label[locale]}
                                  </option>
                                ))}
                            </select>
                          </label>
                          {currentField.showWhen && (
                            <label>
                              {t.equals}
                              <ConditionValue
                                locale={locale}
                                controller={draft.sections
                                  .flatMap((s) => s.fields)
                                  .find((f) => f.id === currentField.showWhen!.field)}
                                value={currentField.showWhen.equals}
                                onChange={(equals) =>
                                  updateField({
                                    showWhen: { field: currentField.showWhen!.field, equals },
                                  })
                                }
                              />
                            </label>
                          )}
                          <div className="user-actions">
                            <button
                              disabled={field === 0}
                              onClick={() => {
                                updateForm((f) => {
                                  const list = f.sections[section]!.fields;
                                  const [item] = list.splice(field, 1);
                                  list.splice(field - 1, 0, item!);
                                });
                                setField(field - 1);
                              }}
                            >
                              {t.moveUp}
                            </button>
                            <button
                              disabled={field === currentSection.fields.length - 1}
                              onClick={() => {
                                updateForm((f) => {
                                  const list = f.sections[section]!.fields;
                                  const [item] = list.splice(field, 1);
                                  list.splice(field + 1, 0, item!);
                                });
                                setField(field + 1);
                              }}
                            >
                              {t.moveDown}
                            </button>
                            <button
                              className="danger"
                              onClick={() => {
                                updateForm((f) => {
                                  f.sections[section]!.fields.splice(field, 1);
                                });
                                setField(-1);
                              }}
                            >
                              {t.deleteField}
                            </button>
                          </div>
                        </>
                      ) : (
                        <p>{t.noFields}</p>
                      )}
                    </aside>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
