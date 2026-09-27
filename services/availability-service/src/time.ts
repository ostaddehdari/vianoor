import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
export const timezone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      return (
        (value === 'UTC' || value.includes('/')) &&
        !!new Intl.DateTimeFormat('en', { timeZone: value })
      );
    } catch {
      return false;
    }
  }, 'IANA timezone required');
export const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => Temporal.Instant.from(value).toString());
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const weeklyRule = z
  .object({
    day: z.number().int().min(1).max(7),
    start: clock,
    end: z.union([clock, z.literal('24:00')]),
  })
  .strict()
  .refine((r) => r.start < r.end);
export const calendarSchema = z
  .object({
    timezone,
    weekly: z.array(weeklyRule).max(35),
    breaks: z.array(weeklyRule).max(35),
    buffer_before: z.number().int().min(0).max(180),
    buffer_after: z.number().int().min(0).max(180),
    min_notice_minutes: z.number().int().min(0).max(10080),
    horizon_days: z.number().int().min(1).max(366),
    cancellation_hours: z.number().int().min(0).max(720),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (c) =>
      !c.weekly.some((r, i) =>
        c.weekly.some((s, j) => j > i && r.day === s.day && r.start < s.end && s.start < r.end),
      ),
    'Overlapping rules',
  );
export type Calendar = z.infer<typeof calendarSchema>;
export type Window = { start: number; end: number };
export type Exception = {
  id?: string;
  kind: 'AVAILABLE' | 'UNAVAILABLE';
  start_at: string;
  end_at: string;
};
export const exceptionSchema = z
  .object({
    kind: z.enum(['AVAILABLE', 'UNAVAILABLE']),
    start_at: instant,
    end_at: instant,
    title: z.string().trim().min(1).max(120),
  })
  .strict()
  .refine(
    (e) =>
      Date.parse(e.end_at) > Date.parse(e.start_at) &&
      Date.parse(e.end_at) - Date.parse(e.start_at) <= 31 * 86400000,
  );
export const holidaySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    timezone,
    calendar: z.enum(['iso8601', 'persian']),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    annual: z.boolean(),
  })
  .strict()
  .refine((h) => {
    try {
      const s = calendarDate(h.start_date, h.calendar),
        e = calendarDate(h.end_date, h.calendar);
      return Temporal.PlainDate.compare(s, e) <= 0 && s.until(e).days <= 31;
    } catch {
      return false;
    }
  });
export type Holiday = z.infer<typeof holidaySchema>;
export function calendarDate(value: string, calendar: string) {
  const [year, month, day] = value.split('-').map(Number);
  return Temporal.PlainDate.from(
    { year: year!, month: month!, day: day!, calendar },
    { overflow: 'reject' },
  );
}
export function resolveLocal(
  value: string,
  zone: string,
  disambiguation: 'reject' | 'earlier' | 'later' = 'reject',
) {
  timezone.parse(zone);
  return Temporal.PlainDateTime.from(value)
    .toZonedDateTime(zone, { disambiguation })
    .toInstant()
    .toString();
}
const ms = (v: Temporal.ZonedDateTime) => v.epochMilliseconds;
function edge(day: Temporal.PlainDate, time: string, zone: string, end = false) {
  if (time === '24:00') return ms(day.add({ days: 1 }).toZonedDateTime(zone));
  return ms(
    day.toPlainDateTime(time).toZonedDateTime(zone, { disambiguation: end ? 'later' : 'earlier' }),
  );
}
export function mergeWindows(windows: Window[]): Window[] {
  const result: Window[] = [];
  for (const w of windows.filter((w) => w.end > w.start).sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else result.push({ ...w });
  }
  return result;
}
export function subtractWindows(windows: Window[], blocked: Window[]): Window[] {
  let result = mergeWindows(windows);
  for (const b of mergeWindows(blocked))
    result = result.flatMap((w) =>
      w.start >= b.end || w.end <= b.start
        ? [w]
        : [
            { start: w.start, end: Math.min(w.end, b.start) },
            { start: Math.max(w.start, b.end), end: w.end },
          ].filter((x) => x.end > x.start),
    );
  return result;
}
function holidayBlocks(h: Holiday, from: number, to: number): Window[] {
  let day = Temporal.Instant.fromEpochMilliseconds(from)
    .toZonedDateTimeISO(h.timezone)
    .toPlainDate()
    .subtract({ days: 1 });
  const end = Temporal.Instant.fromEpochMilliseconds(to)
    .toZonedDateTimeISO(h.timezone)
    .toPlainDate()
    .add({ days: 1 });
  const startDate = calendarDate(h.start_date, h.calendar),
    endDate = calendarDate(h.end_date, h.calendar);
  const first = startDate.month * 100 + startDate.day,
    last = endDate.month * 100 + endDate.day;
  const windows: Window[] = [];
  while (Temporal.PlainDate.compare(day, end) <= 0) {
    const local = day.withCalendar(h.calendar),
      md = local.month * 100 + local.day;
    const match = h.annual
      ? first <= last
        ? md >= first && md <= last
        : md >= first || md <= last
      : Temporal.PlainDate.compare(day, startDate) >= 0 &&
        Temporal.PlainDate.compare(day, endDate) <= 0;
    if (match)
      windows.push({
        start: edge(day, '00:00', h.timezone),
        end: edge(day, '24:00', h.timezone, true),
      });
    day = day.add({ days: 1 });
  }
  return windows;
}
export function generateSlots(
  calendar: Calendar,
  exceptions: Exception[],
  holidays: Holiday[],
  from: number,
  to: number,
  duration: number,
) {
  let day = Temporal.Instant.fromEpochMilliseconds(from)
    .toZonedDateTimeISO(calendar.timezone)
    .toPlainDate()
    .subtract({ days: 1 });
  const end = Temporal.Instant.fromEpochMilliseconds(to)
    .toZonedDateTimeISO(calendar.timezone)
    .toPlainDate()
    .add({ days: 1 });
  const open: Window[] = [],
    blocked: Window[] = [];
  while (Temporal.PlainDate.compare(day, end) <= 0) {
    for (const [rules, target] of [
      [calendar.weekly, open],
      [calendar.breaks, blocked],
    ] as const)
      for (const rule of rules.filter((r) => r.day === day.dayOfWeek)) {
        const start = edge(day, rule.start, calendar.timezone),
          finish = edge(day, rule.end, calendar.timezone, true);
        // Nonexistent local boundaries must not silently invent working time in the DST gap.
        const wall = Temporal.Instant.fromEpochMilliseconds(start)
          .toZonedDateTimeISO(calendar.timezone)
          .toPlainTime()
          .toString()
          .slice(0, 5);
        if (wall === rule.start) target.push({ start, end: finish });
      }
    day = day.add({ days: 1 });
  }
  for (const e of exceptions)
    (e.kind === 'AVAILABLE' ? open : blocked).push({
      start: Date.parse(e.start_at),
      end: Date.parse(e.end_at),
    });
  for (const h of holidays) blocked.push(...holidayBlocks(h, from, to));
  const result: { start_at: string; end_at: string; busy_start: string; busy_end: string }[] = [];
  const before = calendar.buffer_before * 60000,
    after = calendar.buffer_after * 60000,
    length = duration * 60000;
  for (const window of subtractWindows(open, blocked))
    for (
      let start = window.start + before;
      start + length + after <= window.end;
      start += length + before + after
    )
      if (start >= from && start < to)
        result.push({
          start_at: new Date(start).toISOString(),
          end_at: new Date(start + length).toISOString(),
          busy_start: new Date(start - before).toISOString(),
          busy_end: new Date(start + length + after).toISOString(),
        });
  return result;
}
