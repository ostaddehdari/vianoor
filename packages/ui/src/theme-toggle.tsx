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

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vianoor-theme';

function preferredTheme(): Theme {
  if (typeof window === 'undefined')
    return 'light';

  const stored =
    window.localStorage.getItem(
      STORAGE_KEY,
    );

  if (
    stored === 'light' ||
    stored === 'dark'
  )
    return stored;

  return window.matchMedia(
    '(prefers-color-scheme: dark)',
  ).matches
    ? 'dark'
    : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme =
    theme;

  document.documentElement.style.colorScheme =
    theme;
}

export function ThemeToggle({
  locale,
}: {
  locale: string;
}) {
  const [
    theme,
    setTheme,
  ] = useState<Theme>('light');

  useEffect(() => {
    const next =
      preferredTheme();

    applyTheme(next);
    setTheme(next);
  }, []);

  const toggle = () => {
    const next =
      theme === 'dark'
        ? 'light'
        : 'dark';

    window.localStorage.setItem(
      STORAGE_KEY,
      next,
    );

    applyTheme(next);
    setTheme(next);
  };

  const label =
    theme === 'dark'
      ? localizedText(
          locale,
          'shell.theme.light',
          'Switch to light mode',
          'حالت روشن',
        )
      : localizedText(
          locale,
          'shell.theme.dark',
          'Switch to dark mode',
          'حالت شب',
        );

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-theme-value={theme}
    >
      <Icon
        name={
          theme === 'dark'
            ? 'sun'
            : 'moon'
        }
      />
    </button>
  );
}
