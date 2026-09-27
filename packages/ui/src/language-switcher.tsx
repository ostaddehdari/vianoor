'use client';
import { userApi } from './users-client';
import { useEffect, useState } from 'react';
import { localizedText } from './localization-runtime';
type Language = { code: string; name_en: string; native_name: string | null };
export function LanguageSwitcher({ locale }: { locale: string }) {
  const [languages, setLanguages] = useState<Language[]>([
    { code: 'en', name_en: 'English', native_name: 'English' },
    { code: 'fa', name_en: 'Persian', native_name: 'فارسی' },
  ]);
  useEffect(() => {
    void fetch((process.env.NEXT_PUBLIC_BASE_PATH ?? '') + '/api/users/languages')
      .then(async (r) => {
        if (r.ok) setLanguages((await r.json()).data);
      })
      .catch(() => {});
  }, []);
  return (
    <label className="language-switcher">
      <span>{localizedText(locale, 'languageSwitcher.label', 'Language', 'زبان')}</span>
      <select
        value={locale}
        onChange={async (e) => {
          const target = e.target.value,
            url = new URL(window.location.href),
            parts = url.pathname.split('/'),
            index = parts.indexOf(locale);
          if (index < 0) return;
          parts[index] = target;
          url.pathname = parts.join('/');
          document.cookie =
            'vianoor-language=' +
            encodeURIComponent(target) +
            '; Path=' +
            (process.env.NEXT_PUBLIC_BASE_PATH || '/') +
            '; SameSite=Lax; Max-Age=31536000' +
            (location.protocol === 'https:' ? '; Secure' : '');
          await userApi('profiles/language', 'PUT', { language: target }).catch(() => {});
          window.location.assign(url.toString());
        }}
      >
        {languages.map((language) => (
          <option key={language.code} value={language.code}>
            {language.native_name ?? language.name_en} · {language.code}
          </option>
        ))}
      </select>
    </label>
  );
}
