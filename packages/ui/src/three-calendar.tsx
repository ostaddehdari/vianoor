'use client';
import { localeDirection } from './localization-runtime';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  addDays,
  calendarKinds,
  civilDate,
  monthCells,
  primaryCalendar,
  type CalendarKind,
} from './calendar-dates';
import { threeCalendarCopy } from './three-calendar-copy';

export function ThreeCalendar({
  locale,
  timezone,
  value,
  onChange,
}: {
  locale: string;
  timezone: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = threeCalendarCopy[locale]!,
    id = useId(),
    grid = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<CalendarKind>(primaryCalendar(locale));
  const [anchor, setAnchor] = useState(value || '');
  const [today, setToday] = useState('');
  const [focusDay, setFocusDay] = useState('');
  const focusRequested = useRef(false);
  useEffect(() => {
    setKind(primaryCalendar(locale));
  }, [locale]);
  useEffect(() => {
    try {
      const date = civilDate(new Date(), timezone);
      setToday(date);
      setAnchor((old) => old || value || date);
    } catch {
      /* An incomplete timezone input must not break the date picker. */
    }
  }, [timezone, value]);
  useEffect(() => {
    if (value) setAnchor(value);
  }, [value]);
  const month = useMemo(
    () => (anchor ? monthCells(anchor, kind, locale) : null),
    [anchor, kind, locale],
  );
  useEffect(() => {
    if (focusRequested.current) {
      grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDay}"]`)?.focus();
      focusRequested.current = false;
    }
  }, [focusDay, anchor, kind]);
  if (!month) return null;
  const rtl = localeDirection(locale) === 'rtl';
  const secondary = calendarKinds.filter((k) => k !== kind);
  const language = (k: CalendarKind) =>
    k === 'gregory' ? 'en-GB' : locale === 'en' ? 'en-GB' : locale;
  const display = (date: string, k: CalendarKind, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language(k), { ...options, calendar: k, timeZone: 'UTC' }).format(
      new Date(date + 'T12:00:00Z'),
    );
  const heading = (k: CalendarKind) => {
    const first = display(month.start, k, { month: 'long', year: 'numeric' });
    const last = display(month.end, k, { month: 'long', year: 'numeric' });
    return first === last ? first : `${first} — ${last}`;
  };
  const active = month.days.includes(focusDay)
    ? focusDay
    : month.days.includes(value)
      ? value
      : month.days.includes(today)
        ? today
        : month.start;
  return (
    <section
      className="triple-calendar"
      dir={rtl ? 'rtl' : 'ltr'}
      aria-label={t.title}
      data-primary-calendar={kind}
    >
      <div className="triple-calendar-rings" aria-hidden="true">
        <i />
        <i />
      </div>
      <label className="triple-calendar-choice" htmlFor={id + '-kind'}>
        {t.primary}
        <select
          id={id + '-kind'}
          value={kind}
          onChange={(e) => setKind(e.target.value as CalendarKind)}
        >
          {calendarKinds.map((k) => (
            <option key={k} value={k}>
              {t[k]}
            </option>
          ))}
        </select>
      </label>
      <header className="triple-calendar-heading">
        <button
          type="button"
          aria-label={t.previous}
          title={t.previous}
          onClick={() => setAnchor(month.previous)}
        >
          {rtl ? '→' : '←'}
        </button>
        <div aria-live="polite">
          <strong>{heading(kind)}</strong>
          {secondary.map((k) => (
            <small key={k} dir={k === 'gregory' ? 'ltr' : undefined}>
              {heading(k)}
            </small>
          ))}
        </div>
        <button
          type="button"
          aria-label={t.next}
          title={t.next}
          onClick={() => setAnchor(month.next)}
        >
          {rtl ? '←' : '→'}
        </button>
      </header>
      <div className="triple-calendar-paper" ref={grid}>
        <div className="triple-calendar-week" aria-hidden="true">
          {month.days.slice(0, 7).map((day) => (
            <span key={day} title={display(day, kind, { weekday: 'long' })}>
              {display(day, kind, { weekday: 'short' })}
            </span>
          ))}
        </div>
        <div className="triple-calendar-days" role="group" aria-label={t.selected}>
          {month.days.map((day) => {
            const weekend = new Date(day + 'T12:00:00Z').getUTCDay() === (rtl ? 5 : 0);
            return (
              <button
                key={day}
                type="button"
                data-date={day}
                tabIndex={day === active ? 0 : -1}
                aria-label={calendarKinds
                  .map(
                    (k) =>
                      `${t[k]}: ${display(day, k, { day: 'numeric', month: 'long', year: 'numeric' })}`,
                  )
                  .join('؛ ')}
                aria-pressed={day === value}
                aria-current={day === today ? 'date' : undefined}
                className={[
                  day < month.start || day > month.end ? 'is-outside' : '',
                  weekend ? 'is-weekend' : '',
                  day === value ? 'is-selected' : '',
                  day === today ? 'is-today' : '',
                ].join(' ')}
                onFocus={() => setFocusDay(day)}
                onClick={() => {
                  setAnchor(day);
                  onChange(day);
                }}
                onKeyDown={(e) => {
                  const index = month.days.indexOf(day);
                  const step: Record<string, number> = {
                    ArrowRight: rtl ? -1 : 1,
                    ArrowLeft: rtl ? 1 : -1,
                    ArrowDown: 7,
                    ArrowUp: -7,
                    Home: -(index % 7),
                    End: 6 - (index % 7),
                  };
                  if (!(e.key in step)) return;
                  e.preventDefault();
                  const next = addDays(day, step[e.key]!);
                  focusRequested.current = true;
                  setFocusDay(next);
                  if (!month.days.includes(next)) setAnchor(next);
                }}
              >
                <strong>{display(day, kind, { day: 'numeric' })}</strong>
                <span className="triple-calendar-secondary">
                  {secondary.map((k) => (
                    <small key={k} title={t[k]} data-calendar={k}>
                      {display(day, k, { day: '2-digit' })}
                    </small>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="triple-calendar-today"
        type="button"
        onClick={() => {
          setAnchor(today);
          onChange(today);
        }}
      >
        {t.today}
      </button>
      <p className="triple-calendar-legend">
        {secondary.map((k) => (
          <span key={k} data-calendar={k}>
            {t[k]}
          </span>
        ))}
      </p>
      <small className="triple-calendar-note">{t.lunarNote}</small>
    </section>
  );
}
