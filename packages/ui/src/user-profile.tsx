'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { usersCopy } from './users-copy';
import {
  userApi,
  uploadImage,
  type AvatarValue,
  type Field,
  type FormDefinition,
  type Profile,
} from './users-client';
type Locale = 'fa' | 'en';
const imageCache = new Map<string, string>();
export function UserAvatar({
  avatar,
  name = '',
  size = 44,
}: {
  avatar?: AvatarValue | undefined;
  name?: string;
  size?: number;
}) {
  const [image, setImage] = useState('');
  useEffect(() => {
    setImage('');
    let active = true;
    if (avatar?.kind === 'upload') {
      const cached = imageCache.get(avatar.value);
      if (cached) setImage(cached);
      else
        void userApi<{ data_url: string }>('files/images/' + avatar.value)
          .then((result) => {
            imageCache.set(avatar.value, result.data_url);
            if (active) setImage(result.data_url);
          })
          .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [avatar?.kind, avatar?.value]);
  if (image)
    return <img className="user-avatar" width={size} height={size} src={image} alt={name} />;
  const n = Number(avatar?.value ?? 1) - 1;
  const index = Number.isInteger(n) && n >= 0 && n < 5 ? n : 0;
  const colors = [
    ['#dcefe6', '#c0835b', '#273e35', '#4b7c66'],
    ['#efe4f7', '#e8b58b', '#433248', '#9d6fa6'],
    ['#faeacb', '#81513d', '#34271f', '#c0924c'],
    ['#dfedf7', '#efc49e', '#644330', '#477a9b'],
    ['#f7e0dd', '#bb815f', '#443b35', '#b96864'],
  ][index]!;
  return (
    <svg
      className="user-avatar"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
    >
      <circle cx="50" cy="50" r="50" fill={colors[0]} />
      <path d="M10 102 Q14 70 50 69 Q86 70 90 102" fill={colors[3]} />
      <path
        d={index === 1 ? 'M22 73 Q12 20 50 13 Q91 17 79 77Z' : 'M24 51 Q18 14 50 14 Q82 14 78 54Z'}
        fill={colors[2]}
      />
      <path d="M41 62 V77 Q50 85 59 77 V62" fill={colors[1]} />
      <ellipse cx="50" cy="45" rx="25" ry="29" fill={colors[1]} />
      {index === 1 ? (
        <path
          d="M19 62 Q12 16 50 10 Q91 13 81 67 L74 44 Q58 44 46 24 Q33 40 25 44L29 70Z"
          fill={colors[3]}
        />
      ) : (
        <path
          d={
            index === 3
              ? 'M25 40 Q20 14 50 13 Q81 14 76 39 Q61 34 55 23 Q38 41 25 40'
              : 'M24 39 Q19 10 50 13 Q82 10 78 41 Q67 35 64 27 Q48 37 24 39'
          }
          fill={colors[2]}
        />
      )}
      <path
        d="M34 42 Q38 39 42 42 M58 42 Q62 39 66 42"
        fill="none"
        stroke={colors[2]}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <ellipse cx="38" cy="47" rx="2" ry="2.8" fill="#26342f" />
      <ellipse cx="62" cy="47" rx="2" ry="2.8" fill="#26342f" />
      <path
        d="M49 48 L47 55 H52"
        fill="none"
        stroke="#9e634f"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M41 61 Q50 68 59 61"
        fill="none"
        stroke="#7f493d"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {(index === 0 || index === 4) && (
        <g fill="none" stroke={colors[2]} strokeWidth="2">
          <rect x="29" y="41" width="18" height="13" rx="5" />
          <rect x="53" y="41" width="18" height="13" rx="5" />
          <path d="M47 46 H53" />
        </g>
      )}
      {index === 2 && (
        <path d="M26 53 Q29 78 50 79 Q73 76 75 52 L67 63 Q50 75 34 63Z" fill={colors[2]} />
      )}
    </svg>
  );
}
export function userError(error: unknown, locale: Locale) {
  const key = error instanceof Error ? error.message : 'UNAVAILABLE';
  return (
    usersCopy[locale].errors[key as keyof typeof usersCopy.fa.errors] ??
    usersCopy[locale].errors.UNAVAILABLE
  );
}
function FieldInput({
  field,
  locale,
  value,
  onChange,
  onError,
}: {
  field: Field;
  locale: Locale;
  value: unknown;
  onChange: (v: unknown) => void;
  onError: (e: unknown) => void;
}) {
  const t = usersCopy[locale];
  const id = 'field-' + field.id;
  if (field.type === 'heading') return <h3>{field.label[locale]}</h3>;
  const label = (
    <>
      {field.label[locale]}
      {field.required && <span className="required"> *</span>}
    </>
  );
  if (field.type === 'radio' || field.type === 'multiselect')
    return (
      <fieldset className="user-field">
        <legend>{label}</legend>
        {field.options.map((option) => (
          <label className="choice" key={option.value}>
            <input
              type={field.type === 'radio' ? 'radio' : 'checkbox'}
              name={id}
              value={option.value}
              checked={
                field.type === 'radio'
                  ? value === option.value
                  : Array.isArray(value) && value.includes(option.value)
              }
              onChange={(e) =>
                onChange(
                  field.type === 'radio'
                    ? option.value
                    : e.target.checked
                      ? [...(Array.isArray(value) ? value : []), option.value]
                      : (Array.isArray(value) ? value : []).filter((v) => v !== option.value),
                )
              }
            />
            {option.label[locale]}
          </label>
        ))}
        <small>{t[field.visibility]}</small>
      </fieldset>
    );
  return (
    <div className="user-field">
      <label htmlFor={id}>{label}</label>
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          maxLength={4000}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'select' ? (
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t.choose}</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label[locale]}
            </option>
          ))}
        </select>
      ) : field.type === 'checkbox' ? (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : field.type === 'image' ? (
        <>
          <input
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file)
                try {
                  onChange((await uploadImage(file, 'attachment')).id);
                } catch (err) {
                  onError(err);
                }
            }}
          />
          {!!value && (
            <UserAvatar
              avatar={{ kind: 'upload', value: String(value) }}
              name={field.label[locale]}
              size={80}
            />
          )}
          <small>{t.imageHint}</small>
        </>
      ) : (
        <input
          id={id}
          type={
            field.type === 'phone'
              ? 'tel'
              : field.type === 'number'
                ? 'number'
                : field.type === 'email'
                  ? 'email'
                  : field.type === 'date'
                    ? 'date'
                    : field.type === 'url'
                      ? 'url'
                      : 'text'
          }
          min={field.min}
          max={field.max}
          maxLength={field.type === 'url' ? 500 : 300}
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(
              field.type === 'number' && e.target.value !== ''
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
      <small>{t[field.visibility]}</small>
    </div>
  );
}
export function DynamicProfileForm({
  definition,
  locale,
  answers,
  onChange,
  onError,
}: {
  definition: FormDefinition;
  locale: Locale;
  answers: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  onError: (e: unknown) => void;
}) {
  const [section, setSection] = useState(0);
  const t = usersCopy[locale];
  const current = Math.min(section, definition.sections.length - 1);
  return (
    <div className="dynamic-profile">
      <nav className="form-sections" aria-label={definition.title[locale]}>
        {definition.sections.map((s, i) => (
          <button
            type="button"
            key={s.id}
            className={i === current ? 'selected' : ''}
            aria-current={i === current ? 'step' : undefined}
            onClick={() => setSection(i)}
          >
            <span>{i + 1}</span>
            {s.title[locale]}
          </button>
        ))}
      </nav>
      <section aria-label={definition.sections[current]!.title[locale]}>
        <h3>{definition.sections[current]!.title[locale]}</h3>
        {definition.sections[current]!.fields.filter(
          (f) => !f.showWhen || answers[f.showWhen.field] === f.showWhen.equals,
        ).map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            locale={locale}
            value={answers[field.id]}
            onChange={(v) => onChange({ ...answers, [field.id]: v })}
            onError={onError}
          />
        ))}
      </section>
      {definition.layout === 'steps' && (
        <div className="user-actions">
          <button type="button" disabled={current === 0} onClick={() => setSection(current - 1)}>
            {t.previous}
          </button>
          <button
            type="button"
            disabled={current === definition.sections.length - 1}
            onClick={() => setSection(current + 1)}
          >
            {t.next}
          </button>
        </div>
      )}
    </div>
  );
}
export function ProfileEditor({
  locale,
  profile,
  onSaved,
  admin = false,
}: {
  locale: Locale;
  profile: Profile;
  onSaved: (p: Profile) => void;
  admin?: boolean;
}) {
  const t = usersCopy[locale];
  const [name, setName] = useState(profile.display_name),
    [avatar, setAvatar] = useState(profile.avatar),
    [answers, setAnswers] = useState(profile.answers),
    [consent, setConsent] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!admin)
      void userApi<{ accepted: boolean }>('consents/profile')
        .then((v) => setConsent(v.accepted))
        .catch((e) => setError(userError(e, locale)));
  }, [admin, locale]);
  async function save(event: FormEvent, complete: boolean) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (!admin) {
        await userApi('consents/profile', 'POST', { version: 1, accepted: consent });
        if (complete && !consent) throw new Error('CONSENT_REQUIRED');
      }
      const result = await userApi<Profile>(
        admin ? 'profiles/admin/' + profile.public_id : 'profiles/me',
        'PUT',
        {
          display_name: name,
          avatar,
          answers,
          version: profile.form.version,
          revision: profile.revision,
          complete,
        },
      );
      onSaved(result);
      setNotice(t.saved);
    } catch (e) {
      setError(userError(e, locale));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="user-card profile-editor" onSubmit={(e) => save(e, true)}>
      <h2>{t.editProfile}</h2>
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
      <div className="profile-identity">
        <UserAvatar avatar={avatar} name={name} size={96} />
        <div>
          <label htmlFor="display-name">{t.displayName}</label>
          <input
            id="display-name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <small>
            {t.publicId}: <bdi>{profile.public_id}</bdi>
          </small>
        </div>
      </div>
      <fieldset className="avatar-choices">
        <legend>{t.presets}</legend>
        {['1', '2', '3', '4', '5'].map((value) => (
          <button
            type="button"
            key={value}
            aria-label={`${t.avatar} ${value}`}
            aria-pressed={avatar.kind === 'preset' && avatar.value === value}
            onClick={() => setAvatar({ kind: 'preset', value })}
          >
            <UserAvatar avatar={{ kind: 'preset', value }} size={64} />
          </button>
        ))}
      </fieldset>
      {!admin && (
        <div className="user-field">
          <label htmlFor="avatar-upload">{t.upload}</label>
          <input
            id="avatar-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                setAvatar({ kind: 'upload', value: (await uploadImage(file, 'avatar')).id });
              } catch (err) {
                setError(userError(err, locale));
              } finally {
                setBusy(false);
              }
            }}
          />
          <small>{t.imageHint}</small>
        </div>
      )}
      <DynamicProfileForm
        definition={profile.form.definition}
        locale={locale}
        answers={answers}
        onChange={setAnswers}
        onError={(e) => setError(userError(e, locale))}
      />
      {!admin && (
        <label className="choice consent-choice">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          {t.consent}
        </label>
      )}
      <div className="user-actions">
        <button className="primary" type="submit" disabled={busy}>
          {t.complete}
        </button>
        <button type="button" disabled={busy} onClick={(e) => save(e, false)}>
          {t.save}
        </button>
      </div>
    </form>
  );
}
