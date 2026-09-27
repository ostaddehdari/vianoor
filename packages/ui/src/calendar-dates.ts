export type CalendarKind = 'persian' | 'islamic-umalqura' | 'gregory';
export const calendarKinds: CalendarKind[] = ['persian', 'islamic-umalqura', 'gregory'];
export function primaryCalendar(language: string): CalendarKind {
  return language.startsWith('fa')
    ? 'persian'
    : language.startsWith('ar')
      ? 'islamic-umalqura'
      : 'gregory';
}
export function civilDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  return ['year', 'month', 'day'].map((k) => parts.find((p) => p.type === k)!.value).join('-');
}
export function addDays(day: string, count: number): string {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function calendarParts(day: string, calendar: CalendarKind) {
  const parts = new Intl.DateTimeFormat('en', {
    calendar,
    numberingSystem: 'latn',
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(day + 'T12:00:00Z'));
  const value = (key: string) => Number(parts.find((p) => p.type === key)!.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}
export function monthWindow(day: string, calendar: CalendarKind) {
  const current = calendarParts(day, calendar);
  const start = addDays(day, 1 - current.day);
  let end = addDays(start, 28);
  while (calendarParts(end, calendar).month === current.month) end = addDays(end, 1);
  return { start, end: addDays(end, -1), next: end, previous: addDays(start, -1) };
}
export function monthCells(day: string, calendar: CalendarKind, language: string) {
  const month = monthWindow(day, calendar);
  const weekStart = /^(fa|ar)/.test(language) ? 6 : 1;
  const weekday = new Date(month.start + 'T12:00:00Z').getUTCDay();
  const first = addDays(month.start, -((weekday - weekStart + 7) % 7));
  const length =
    Math.ceil((Date.parse(month.end) - Date.parse(first) + 86400000) / (7 * 86400000)) * 7;
  return { ...month, days: Array.from({ length }, (_, i) => addDays(first, i)) };
}
