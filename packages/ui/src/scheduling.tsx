'use client';
import { communicationCopy } from './communication-copy';
import { financeCopy } from './finance-copy';
import { usersBase } from './users-client';
import { useEffect, useState, useRef } from 'react';
import { userApi } from './users-client';
import { schedulingCopy } from './scheduling-copy';
import { ThreeCalendar } from './three-calendar';
import { threeCalendarCopy } from './three-calendar-copy';
import { addDays } from './calendar-dates';
type Locale = string;
type Copy = typeof schedulingCopy.en;
type Rule = { day: number; start: string; end: string };
type Calendar = {
  timezone: string;
  weekly: Rule[];
  breaks: Rule[];
  buffer_before: number;
  buffer_after: number;
  min_notice_minutes: number;
  horizon_days: number;
  cancellation_hours: number;
  revision: number;
  exceptions: { id: string; title: string; kind: string; start_at: string; end_at: string }[];
};
type Service = {
  service_id: string;
  expert_code: string;
  expert_name: string;
  title: string;
  duration_minutes: number;
};
type Slot = { start_at: string; end_at: string };
type Booking = {
  id: string;
  client_code: string;
  expert_code: string;
  service_id: string;
  start_at: string;
  end_at: string;
  status: string;
  expires_at: string | null;
  timezone: string;
  revision: number;
  pending: boolean;
  error_code: string | null;
  service: { title: string; expert_name: string; cancellation_hours: number } | null;
};
type Note = { id: string; event: string; created_at: string; read_at: string | null };
const zones = [
  'Asia/Tehran',
  'Europe/Berlin',
  'America/New_York',
  'Asia/Tokyo',
  'Europe/London',
  'Asia/Dubai',
  'UTC',
];
const label = (t: Copy, status: string) => t.states[status as keyof Copy['states']] ?? status;
function failure(t: Copy, e: unknown) {
  const s = e instanceof Error ? e.message : '';
  return s.includes('SLOT_ALREADY_RESERVED')
    ? t.conflict
    : s.includes('HOLD_EXPIRED')
      ? t.expired
      : s.includes('CANCELLATION_CUTOFF')
        ? t.cutoffError
        : s.includes('AMBIGUOUS_OR_INVALID_TIME')
          ? t.ambiguous
          : s.includes('SERVICE_UNAVAILABLE')
            ? t.serviceUnavailable
            : t.error;
}
function format(value: string, zone: string, locale: Locale) {
  try {
    return (
      new Intl.DateTimeFormat(locale, {
        timeZone: zone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value)) +
      ' · ' +
      new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date(value))
        .find((p) => p.type === 'timeZoneName')?.value
    );
  } catch {
    return value;
  }
}
function Zone({ t, value, onChange }: { t: Copy; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      {t.timezone}
      <input
        list="scheduling-zones"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
      <datalist id="scheduling-zones">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </label>
  );
}
function Rules({
  t,
  title,
  rows,
  set,
}: {
  t: Copy;
  title: string;
  rows: Rule[];
  set: (r: Rule[]) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      {rows.map((r, i) => (
        <div className="schedule-rule" key={i}>
          <label>
            {t.day}
            <select
              value={r.day}
              onChange={(e) =>
                set(rows.map((s, j) => (j === i ? { ...s, day: Number(e.target.value) } : s)))
              }
            >
              {t.days.map((day, n) => (
                <option value={n + 1} key={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          {(['start', 'end'] as const).map((k) => (
            <label key={k}>
              {t[k]}
              <input
                type="time"
                value={r[k]}
                onChange={(e) =>
                  set(rows.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)))
                }
                required
              />
            </label>
          ))}
          <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))}>
            {t.remove}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => set([...rows, { day: 1, start: '09:00', end: '12:00' }])}
      >
        {t.add}
      </button>
    </fieldset>
  );
}
function CalendarEditor({ locale }: { locale: Locale }) {
  const t = schedulingCopy[locale]!,
    [value, setValue] = useState<Calendar | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [exception, setException] = useState({
    title: '',
    kind: 'UNAVAILABLE',
    start: '',
    end: '',
    disambiguation: 'reject',
  });
  const [holidays, setHolidays] = useState<
    { id: string; details: { title: string; start_date: string; end_date: string } }[]
  >([]);
  const load = async () => {
    setValue(await userApi<Calendar>('availability/calendar'));
    setHolidays(await userApi<typeof holidays>('availability/holidays'));
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      setMessage(t.saved);
    } catch (e) {
      setError(failure(t, e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load().catch((e) => setError(failure(t, e)));
  }, []);
  return (
    <section className="user-card scholar-workspace schedule-workspace">
      <h2>{t.calendar}</h2>
      <p>{t.calendarNote}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {value && (
        <>
          <ThreeCalendar
            locale={locale}
            timezone={value.timezone}
            value={exception.start.slice(0, 10)}
            onChange={(day) =>
              setException({ ...exception, start: day + 'T09:00', end: day + 'T10:00' })
            }
          />
          {holidays.length > 0 && (
            <aside>
              <h3>{t.holidays}</h3>
              {holidays.map((h) => (
                <p key={h.id}>
                  {h.details.title} ·{' '}
                  <bdi>
                    {h.details.start_date} — {h.details.end_date}
                  </bdi>
                </p>
              ))}
            </aside>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(
                Object.entries(value).filter(([key]) => key !== 'exceptions'),
              );
              void act(() => userApi('availability/calendar', 'PUT', data));
            }}
          >
            <fieldset disabled={busy}>
              <Zone
                t={t}
                value={value.timezone}
                onChange={(timezone) => setValue({ ...value, timezone })}
              />
              <Rules
                t={t}
                title={t.weekly}
                rows={value.weekly}
                set={(weekly) => setValue({ ...value, weekly })}
              />
              <Rules
                t={t}
                title={t.breaks}
                rows={value.breaks}
                set={(breaks) => setValue({ ...value, breaks })}
              />
              <div className="scholar-grid">
                {(
                  [
                    ['buffer_before', 'before'],
                    ['buffer_after', 'after'],
                    ['min_notice_minutes', 'notice'],
                    ['horizon_days', 'horizon'],
                    ['cancellation_hours', 'cutoff'],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k}>
                    {t[l]}
                    <input
                      type="number"
                      min={k === 'horizon_days' ? 1 : 0}
                      value={value[k]}
                      onChange={(e) => setValue({ ...value, [k]: Number(e.target.value) })}
                      required
                    />
                  </label>
                ))}
              </div>
              <button className="button">{t.save}</button>
            </fieldset>
          </form>
          <h3>{t.exceptions}</h3>
          {value.exceptions.map((x) => (
            <article className="user-card" key={x.id}>
              <h4>{x.title}</h4>
              <p>{x.kind === 'AVAILABLE' ? t.available : t.unavailable}</p>
              <p>
                {format(x.start_at, value.timezone, locale)} —{' '}
                {format(x.end_at, value.timezone, locale)}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(() => userApi('availability/exceptions/' + x.id + '/remove', 'POST', {}))
                }
              >
                {t.remove}
              </button>
            </article>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const resolve = (local: string) =>
                  userApi<{ utc: string }>('availability/resolve', 'POST', {
                    local,
                    timezone: value.timezone,
                    disambiguation: exception.disambiguation,
                  });
                const start = await resolve(exception.start),
                  end = await resolve(exception.end);
                return userApi('availability/exceptions', 'POST', {
                  kind: exception.kind,
                  title: exception.title,
                  start_at: start.utc,
                  end_at: end.utc,
                });
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                {t.title}
                <input
                  required
                  value={exception.title}
                  onChange={(e) => setException({ ...exception, title: e.target.value })}
                />
              </label>
              <label>
                {t.kind}
                <select
                  value={exception.kind}
                  onChange={(e) => setException({ ...exception, kind: e.target.value })}
                >
                  <option value="UNAVAILABLE">{t.unavailable}</option>
                  <option value="AVAILABLE">{t.available}</option>
                </select>
              </label>
              <div className="scholar-grid">
                {(['start', 'end'] as const).map((k) => (
                  <label key={k}>
                    {k === 'start' ? t.localStart : t.localEnd}
                    <input
                      required
                      type="datetime-local"
                      value={exception[k]}
                      onChange={(e) => setException({ ...exception, [k]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label>
                {t.disambiguation}
                <select
                  value={exception.disambiguation}
                  onChange={(e) => setException({ ...exception, disambiguation: e.target.value })}
                >
                  {(['reject', 'earlier', 'later'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t[k]}
                    </option>
                  ))}
                </select>
              </label>
              <button>{t.add}</button>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}
function BookingFlow({
  locale,
  move,
  onDone,
}: {
  locale: Locale;
  move?: Booking;
  onDone?: () => void;
}) {
  const t = schedulingCopy[locale]!,
    [services, setServices] = useState<Service[]>([]),
    [expert, setExpert] = useState(move?.expert_code ?? ''),
    [service, setService] = useState(move?.service_id ?? ''),
    [zone, setZone] = useState('Asia/Tehran'),
    [date, setDate] = useState(''),
    [slots, setSlots] = useState<Slot[]>([]),
    [held, setHeld] = useState<Booking | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [cutoff, setCutoff] = useState<number | null>(null),
    [now, setNow] = useState(Date.now()),
    [searchAt, setSearchAt] = useState(''),
    [found, setFound] = useState<(Service & Slot)[]>([]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(failure(t, e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void action(async () => {
      setServices(await userApi<Service[]>('availability/services'));
      setZone((await userApi<{ timezone: string }>('profiles/timezone')).timezone);
      if (!move) {
        const query = new URLSearchParams(window.location.search);
        if (query.get('expert')) setExpert(query.get('expert')!);
        if (query.get('service')) setService(query.get('service')!);
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expires = held?.expires_at
    ? Math.max(0, Math.ceil((Date.parse(held.expires_at) - now) / 1000))
    : 0;
  const holdAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function reserve(slot: Slot) {
    await action(async () => {
      if (move) {
        await userApi('bookings/scheduled/' + move.id + '/reschedule', 'POST', {
          revision: move.revision,
          request_key: crypto.randomUUID(),
          start_at: slot.start_at,
        });
        onDone?.();
      } else {
        const fingerprint = JSON.stringify({
          expert,
          service,
          start_at: slot.start_at,
          timezone: zone,
        });
        if (holdAttempt.current?.fingerprint !== fingerprint)
          holdAttempt.current = { fingerprint, key: crypto.randomUUID() };
        setHeld(
          await userApi<Booking>('bookings/scheduled', 'POST', {
            request_key: holdAttempt.current.key,
            expert,
            service,
            start_at: slot.start_at,
            timezone: zone,
          }),
        );
        holdAttempt.current = null;
      }
      setSlots([]);
    });
  }
  return (
    <section className="user-card scholar-workspace schedule-workspace">
      <h2>{move ? t.reschedule : t.book}</h2>
      <p>{financeCopy[locale]!.paymentNotice}</p>
      {move && <p>{t.moveNote}</p>}
      {error && <p role="alert">{error}</p>}
      <Zone t={t} value={zone} onChange={setZone} />
      <button
        disabled={busy}
        onClick={() => void action(() => userApi('profiles/timezone', 'PUT', { timezone: zone }))}
      >
        {t.saveTimezone}
      </button>
      <p>{t.utcOffset}</p>
      {held ? (
        <article className="user-card">
          <h3>{label(t, held.status)}</h3>
          <p>{format(held.start_at, zone, locale)}</p>
          <p>{held.service?.title}</p>
          {held.status === 'BOOKING_PENDING_PAYMENT' && (
            <a className="button" href={`${usersBase}/${locale}/account/wallet?booking=${held.id}`}>
              {financeCopy[locale]!.pay}
            </a>
          )}
          {held.status === 'HELD' && (
            <>
              <p>
                {t.remaining}: {expires}
              </p>
              {cutoff !== null && (
                <p>
                  {t.policy} {cutoff}
                </p>
              )}
              <button
                className="button"
                disabled={busy || expires === 0}
                onClick={() =>
                  void action(async () =>
                    setHeld(
                      await userApi<Booking>('bookings/scheduled/' + held.id + '/confirm', 'POST', {
                        revision: held.revision,
                        request_key: crypto.randomUUID(),
                      }),
                    ),
                  )
                }
              >
                {t.confirm}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await userApi('bookings/scheduled/' + held.id + '/cancel', 'POST', {
                      revision: held.revision,
                      request_key: crypto.randomUUID(),
                    });
                    setHeld(null);
                  })
                }
              >
                {t.cancel}
              </button>
            </>
          )}
          <button
            onClick={() => {
              setHeld(null);
              setSlots([]);
            }}
          >
            {t.back}
          </button>
        </article>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const from = (
                  await userApi<{ utc: string }>('availability/resolve', 'POST', {
                    local: date + 'T00:00',
                    timezone: zone,
                  })
                ).utc;
                const next = new Date(date + 'T12:00:00Z');
                next.setUTCDate(next.getUTCDate() + 1);
                const to = (
                  await userApi<{ utc: string }>('availability/resolve', 'POST', {
                    local: next.toISOString().slice(0, 10) + 'T00:00',
                    timezone: zone,
                  })
                ).utc;
                const data = await userApi<{ slots: Slot[]; cancellation_hours: number }>(
                  'availability/slots?' +
                    new URLSearchParams({ expert, service, from, to, timezone: zone }),
                );
                setSlots(data.slots);
                setCutoff(data.cancellation_hours);
              });
            }}
          >
            <fieldset disabled={busy}>
              <div className="scholar-grid">
                <label>
                  {t.expert}
                  <select
                    required
                    disabled={!!move}
                    value={expert}
                    onChange={(e) => {
                      setExpert(e.target.value);
                      setService('');
                      setSlots([]);
                    }}
                  >
                    <option value="">{t.select}</option>
                    {[...new Map(services.map((s) => [s.expert_code, s])).values()].map((s) => (
                      <option key={s.expert_code} value={s.expert_code}>
                        {s.expert_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.service}
                  <select
                    required
                    disabled={!!move}
                    value={service}
                    onChange={(e) => {
                      setService(e.target.value);
                      setSlots([]);
                    }}
                  >
                    <option value="">{t.select}</option>
                    {services
                      .filter((s) => s.expert_code === expert)
                      .map((s) => (
                        <option key={s.service_id} value={s.service_id}>
                          {s.title} · {s.duration_minutes}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {t.date}
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setSlots([]);
                    }}
                  />
                </label>
              </div>
              <ThreeCalendar
                locale={locale}
                timezone={zone}
                value={date}
                onChange={(day) => {
                  setDate(day);
                  setSlots([]);
                }}
              />
              <button>{t.find}</button>
            </fieldset>
          </form>
          <h3>{t.slots}</h3>
          {slots.length === 0 && <p>{t.empty}</p>}
          {cutoff !== null && (
            <p>
              {t.policy} {cutoff}. {t.noPenalty}
            </p>
          )}
          <div className="schedule-slots">
            {slots.map((s) => (
              <button key={s.start_at} disabled={busy} onClick={() => void reserve(s)}>
                <time dateTime={s.start_at}>{format(s.start_at, zone, locale)}</time>
                <span>{move ? t.reschedule : t.hold}</span>
              </button>
            ))}
          </div>
          {!move && (
            <>
              <h3>{t.searchTime}</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(async () => {
                    const time = await userApi<{ utc: string }>('availability/resolve', 'POST', {
                      local: searchAt,
                      timezone: zone,
                    });
                    setFound(
                      await userApi<(Service & Slot)[]>(
                        'availability/search?' +
                          new URLSearchParams({ at: time.utc, timezone: zone }),
                      ),
                    );
                  });
                }}
              >
                <label>
                  {t.searchAt}
                  <input
                    type="datetime-local"
                    required
                    value={searchAt}
                    onChange={(e) => setSearchAt(e.target.value)}
                  />
                </label>
                <button disabled={busy}>{t.search}</button>
              </form>
              {found.map((s) => (
                <button
                  key={s.service_id}
                  onClick={() => {
                    setExpert(s.expert_code);
                    setService(s.service_id);
                    setSlots([{ start_at: s.start_at, end_at: s.end_at }]);
                  }}
                >
                  {s.expert_name} · {s.title} · {format(s.start_at, zone, locale)}
                </button>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
function BookingList({ locale, view }: { locale: Locale; view: 'mine' | 'expert' | 'admin' }) {
  const t = schedulingCopy[locale]!,
    [rows, setRows] = useState<Booking[]>([]),
    [notes, setNotes] = useState<Note[]>([]),
    [zone, setZone] = useState('Asia/Tehran'),
    [period, setPeriod] = useState('all'),
    [offset, setOffset] = useState(0),
    [selectedDay, setSelectedDay] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [move, setMove] = useState<Booking | null>(null);
  const load = async () => {
    const range: Record<string, string> = {};
    if (selectedDay) {
      range.from = (
        await userApi<{ utc: string }>('availability/resolve', 'POST', {
          local: selectedDay + 'T00:00',
          timezone: zone,
        })
      ).utc;
      range.to = (
        await userApi<{ utc: string }>('availability/resolve', 'POST', {
          local: addDays(selectedDay, 1) + 'T00:00',
          timezone: zone,
        })
      ).utc;
    }
    setRows(
      await userApi<Booking[]>(
        'bookings/scheduled?' +
          new URLSearchParams({ view, period, offset: String(offset), ...range }),
      ),
    );
    setNotes(await userApi<Note[]>('bookings/notifications'));
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(failure(t, e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void act(load);
  }, [period, offset, selectedDay, zone]);
  useEffect(() => {
    void userApi<{ timezone: string }>('profiles/timezone')
      .then((v) => setZone(v.timezone))
      .catch(() => {});
  }, []);
  if (move)
    return (
      <>
        <button onClick={() => setMove(null)}>{t.back}</button>
        <BookingFlow
          key={move.id}
          locale={locale}
          move={move}
          onDone={() => {
            setMove(null);
            void act(load);
          }}
        />
      </>
    );
  return (
    <section className="user-card scholar-workspace schedule-workspace">
      <h2>
        {view === 'mine' ? t.bookings : view === 'expert' ? t.expertBookings : t.adminBookings}
      </h2>
      {error && <p role="alert">{error}</p>}
      <Zone t={t} value={zone} onChange={setZone} />
      <p>{threeCalendarCopy[locale]!.selectDay}</p>
      <ThreeCalendar
        locale={locale}
        timezone={zone}
        value={selectedDay}
        onChange={(day) => {
          setSelectedDay(day);
          setOffset(0);
        }}
      />
      {selectedDay && (
        <button
          onClick={() => {
            setSelectedDay('');
            setOffset(0);
          }}
        >
          {threeCalendarCopy[locale]!.allDates}
        </button>
      )}
      <label>
        {t.period}
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setOffset(0);
          }}
        >
          {(['all', 'future', 'past', 'cancelled'] as const).map((k) => (
            <option key={k} value={k}>
              {t[k]}
            </option>
          ))}
        </select>
      </label>
      <button disabled={busy} onClick={() => void act(load)}>
        {t.refresh}
      </button>
      {!rows.length && <p>{t.empty}</p>}
      {rows.map((r) => (
        <article className="user-card" key={r.id} data-booking-id={r.id}>
          <h3>{r.service?.title ?? t.book}</h3>
          <p>{r.service?.expert_name ?? r.expert_code}</p>
          <time dateTime={r.start_at}>{format(r.start_at, zone, locale)}</time>
          <p>{label(t, r.status)}</p>
          {r.pending && <p role="status">{t.pending}</p>}
          {r.error_code && <p>{failure(t, new Error(r.error_code))}</p>}
          <p>
            {t.policy} {r.service?.cancellation_hours ?? '—'}
          </p>
          {view !== 'admin' && (
            <div className="user-actions">
              {['CONFIRMED', 'COMPLETED', 'RESCHEDULED', 'RESCHEDULE_REQUESTED'].includes(
                r.status,
              ) && (
                <a
                  className="button"
                  href={usersBase + '/' + locale + '/account/messages?booking=' + r.id}
                >
                  {communicationCopy[locale]!.conversation}
                </a>
              )}
              {r.status === 'BOOKING_PENDING_PAYMENT' && view === 'mine' && (
                <a
                  className="button"
                  href={`${usersBase}/${locale}/account/wallet?booking=${r.id}`}
                >
                  {financeCopy[locale]!.pay}
                </a>
              )}
              {r.status === 'HELD' && view === 'mine' && (
                <button
                  disabled={busy || r.pending}
                  onClick={() =>
                    void act(() =>
                      userApi('bookings/scheduled/' + r.id + '/confirm', 'POST', {
                        revision: r.revision,
                        request_key: crypto.randomUUID(),
                      }),
                    )
                  }
                >
                  {t.confirm}
                </button>
              )}
              {['HELD', 'BOOKING_PENDING_PAYMENT', 'CONFIRMED', 'RESCHEDULED'].includes(
                r.status,
              ) && (
                <button
                  disabled={busy || r.pending}
                  onClick={() =>
                    void act(() =>
                      userApi('bookings/scheduled/' + r.id + '/cancel', 'POST', {
                        revision: r.revision,
                        request_key: crypto.randomUUID(),
                      }),
                    )
                  }
                >
                  {t.cancel}
                </button>
              )}
              {['CONFIRMED', 'RESCHEDULED'].includes(r.status) && (
                <>
                  <button disabled={busy || r.pending} onClick={() => setMove(r)}>
                    {t.reschedule}
                  </button>
                  {view === 'expert' && new Date(r.end_at).getTime() <= Date.now() && (
                    <button
                      disabled={busy || r.pending}
                      onClick={() =>
                        void act(() =>
                          userApi('bookings/scheduled/' + r.id + '/complete', 'POST', {
                            revision: r.revision,
                            request_key: crypto.randomUUID(),
                          }),
                        )
                      }
                    >
                      {t.complete}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </article>
      ))}
      <div className="user-actions">
        <button
          disabled={busy || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          {t.previous}
        </button>
        <button disabled={busy || rows.length < 100} onClick={() => setOffset(offset + 100)}>
          {t.next}
        </button>
      </div>
      <h3>{t.notifications}</h3>
      {notes.map((n) => (
        <article className="user-card" key={n.id}>
          <p>{label(t, n.event)}</p>
          <time>{format(n.created_at, zone, locale)}</time>
          {!n.read_at && (
            <button
              disabled={busy}
              onClick={() =>
                void act(() => userApi('bookings/notifications/' + n.id + '/read', 'POST', {}))
              }
            >
              {t.read}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
function HolidayManager({ locale }: { locale: Locale }) {
  const t = schedulingCopy[locale]!,
    [items, setItems] = useState<
      {
        id: string;
        details: {
          title: string;
          start_date: string;
          end_date: string;
          annual: boolean;
          timezone: string;
        };
      }[]
    >([]),
    [hold, setHold] = useState(300),
    [value, setValue] = useState({
      title: '',
      timezone: 'Asia/Tehran',
      calendar: 'iso8601',
      start_date: '',
      end_date: '',
      annual: false,
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setItems(await userApi<typeof items>('availability/holidays'));
    setHold((await userApi<{ hold_seconds: number }>('availability/settings')).hold_seconds);
  };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(failure(t, e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void act(load);
  }, []);
  return (
    <section className="user-card scholar-workspace schedule-workspace">
      <h2>{t.holidays}</h2>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => userApi('availability/settings', 'PUT', { hold_seconds: hold }));
        }}
      >
        <label>
          {t.holdSeconds}
          <input
            type="number"
            min={30}
            max={900}
            value={hold}
            onChange={(e) => setHold(Number(e.target.value))}
            required
          />
        </label>
        <button disabled={busy}>{t.save}</button>
      </form>
      {items.map((h) => (
        <article className="user-card" key={h.id}>
          <h3>{h.details.title}</h3>
          <p>
            <bdi>
              {h.details.start_date} — {h.details.end_date} · {h.details.timezone}
            </bdi>
          </p>
          {h.details.annual && <p>{t.annual}</p>}
          <button
            disabled={busy}
            onClick={() =>
              void act(() => userApi('availability/holidays/' + h.id + '/remove', 'POST', {}))
            }
          >
            {t.remove}
          </button>
        </article>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => userApi('availability/holidays', 'POST', value));
        }}
      >
        <fieldset disabled={busy}>
          <label>
            {t.title}
            <input
              required
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </label>
          <Zone
            t={t}
            value={value.timezone}
            onChange={(timezone) => setValue({ ...value, timezone })}
          />
          <label>
            {t.calendarType}
            <select
              value={value.calendar}
              onChange={(e) => setValue({ ...value, calendar: e.target.value })}
            >
              <option value="iso8601">{t.gregorian}</option>
              <option value="persian">{t.persian}</option>
            </select>
          </label>
          <div className="scholar-grid">
            {(['start_date', 'end_date'] as const).map((k) => (
              <label key={k}>
                {k === 'start_date' ? t.startDate : t.endDate}
                <input
                  required
                  placeholder="YYYY-MM-DD"
                  value={value[k]}
                  onChange={(e) => setValue({ ...value, [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="scholar-check">
            <input
              type="checkbox"
              checked={value.annual}
              onChange={(e) => setValue({ ...value, annual: e.target.checked })}
            />
            {t.annual}
          </label>
          <button>{t.add}</button>
        </fieldset>
      </form>
    </section>
  );
}
export function SchedulingWorkspace({
  locale,
  mode,
}: {
  locale: Locale;
  mode: 'book' | 'calendar' | 'mine' | 'expert' | 'admin' | 'holidays';
}) {
  return mode === 'calendar' ? (
    <CalendarEditor locale={locale} />
  ) : mode === 'book' ? (
    <BookingFlow locale={locale} />
  ) : mode === 'holidays' ? (
    <HolidayManager locale={locale} />
  ) : (
    <BookingList locale={locale} view={mode} />
  );
}
