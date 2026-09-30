'use client';

import {
  useEffect,
  useState,
} from 'react';

import {
  Icon,
} from './icons';

import {
  localizedText,
} from './localization-runtime';

import {
  userApi,
} from './users-client';

type Language = {
  code: string;
  name_en: string;
  native_name: string | null;
  direction?: 'RTL' | 'LTR';
};

const base =
  process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function LanguageSwitcher({
  locale,
}: {
  locale: string;
}) {
  /*
   * The current language is the only local
   * fallback. The public API replaces this
   * list with languages marked ACTIVE by
   * administrators.
   */
  const [
    languages,
    setLanguages,
  ] = useState<Language[]>([
    {
      code: locale,
      name_en: locale,
      native_name: locale,
    },
  ]);

  useEffect(() => {
    const controller =
      new AbortController();

    void fetch(
      base +
        '/api/users/languages',
      {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok)
          return;

        const body =
          await response.json();

        if (
          Array.isArray(body?.data) &&
          body.data.length
        ) {
          setLanguages(
            body.data,
          );
        }
      })
      .catch(() => {});

    return () =>
      controller.abort();
  }, []);

  const label =
    localizedText(
      locale,
      'languageSwitcher.label',
      'Language',
      'زبان',
    );

  return (
    <label
      className="language-switcher"
      title={label}
    >
      <span className="sr-only">
        {label}
      </span>

      <Icon name="globe" />

      <select
        aria-label={label}
        value={locale}
        onChange={async (event) => {
          const target =
            event.target.value;

          if (
            !languages.some(
              (language) =>
                language.code === target,
            )
          )
            return;

          const current =
            new URL(
              window.location.href,
            );

          const parts =
            current.pathname.split(
              '/',
            );

          const index =
            parts.indexOf(
              locale,
            );

          if (index < 0)
            return;

          parts[index] =
            target;

          current.pathname =
            parts.join('/');

          document.cookie =
            'vianoor-language=' +
            encodeURIComponent(
              target,
            ) +
            '; Path=' +
            (
              process.env
                .NEXT_PUBLIC_BASE_PATH ||
              '/'
            ) +
            '; SameSite=Lax; Max-Age=31536000' +
            (
              location.protocol ===
              'https:'
                ? '; Secure'
                : ''
            );

          await userApi(
            'profiles/language',
            'PUT',
            {
              language: target,
            },
          ).catch(() => {});

          window.location.assign(
            current.toString(),
          );
        }}
      >
        {languages.map(
          (language) => (
            <option
              key={
                language.code
              }
              value={
                language.code
              }
            >
              {language.native_name ??
                language.name_en}
            </option>
          ),
        )}
      </select>
    </label>
  );
}
