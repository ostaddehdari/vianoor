import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarSchema,
  holidaySchema,
  timezone,
  resolveLocal,
  generateSlots,
  subtractWindows,
  type Calendar,
} from '../services/availability-service/src/time.js';
const calendar: Calendar = {
  timezone: 'Asia/Tehran',
  weekly: [{ day: 4, start: '09:00', end: '12:00' }],
  breaks: [],
  buffer_before: 0,
  buffer_after: 15,
  min_notice_minutes: 0,
  horizon_days: 90,
  cancellation_hours: 24,
  revision: 0,
};
test('IANA zones preserve Tehran offset; DST gap rejects and overlap is explicit', () => {
  assert.equal(resolveLocal('2026-10-01T18:00', 'Asia/Tehran'), '2026-10-01T14:30:00Z');
  assert.equal(timezone.safeParse('+03:30').success, false);
  assert.equal(timezone.safeParse('Unknown/Place').success, false);
  assert.throws(() => resolveLocal('2026-03-08T02:30', 'America/New_York'));
  assert.throws(() => resolveLocal('2026-11-01T01:30', 'America/New_York'));
  const early = Date.parse(resolveLocal('2026-11-01T01:30', 'America/New_York', 'earlier'));
  const late = Date.parse(resolveLocal('2026-11-01T01:30', 'America/New_York', 'later'));
  assert.equal(late - early, 3600000);
});
test('slots include buffers and subtract lunch and unavailable exceptions', () => {
  const from = Date.parse('2026-10-01T00:00:00Z'),
    to = from + 86400000;
  const slots = generateSlots(calendar, [], [], from, to, 30);
  assert.deepEqual(
    slots.map((s) => s.start_at),
    [
      '2026-10-01T05:30:00.000Z',
      '2026-10-01T06:15:00.000Z',
      '2026-10-01T07:00:00.000Z',
      '2026-10-01T07:45:00.000Z',
    ],
  );
  const blocked = generateSlots(
    { ...calendar, breaks: [{ day: 4, start: '10:00', end: '11:00' }] },
    [],
    [],
    from,
    to,
    30,
  );
  assert.equal(blocked.length, 2);
  const extra = generateSlots(
    { ...calendar, weekly: [] },
    [
      { kind: 'AVAILABLE', start_at: '2026-10-01T16:00:00Z', end_at: '2026-10-01T18:00:00Z' },
      { kind: 'UNAVAILABLE', start_at: '2026-10-01T16:30:00Z', end_at: '2026-10-01T17:00:00Z' },
    ],
    [],
    from,
    to,
    30,
  );
  assert.deepEqual(
    extra.map((s) => s.start_at),
    ['2026-10-01T17:00:00.000Z'],
  );
});
test('DST forward and backward days produce unique UTC slots with real elapsed durations', () => {
  const cal = {
    ...calendar,
    timezone: 'America/New_York',
    weekly: [{ day: 7, start: '01:00', end: '04:00' }],
    buffer_after: 0,
  };
  for (const [date, count] of [
    ['2026-03-08', 4],
    ['2026-11-01', 8],
  ] as const) {
    const from = Date.parse(date + 'T00:00:00Z'),
      slots = generateSlots(cal, [], [], from, from + 86400000, 30);
    assert.equal(slots.length, count);
    assert.equal(new Set(slots.map((s) => s.start_at)).size, count);
    for (const s of slots) assert.equal(Date.parse(s.end_at) - Date.parse(s.start_at), 1800000);
  }
});
test('Gregorian and Persian recurring holidays block whole local days', () => {
  const h = holidaySchema.parse({
    title: 'Nowruz',
    timezone: 'Asia/Tehran',
    calendar: 'persian',
    start_date: '1405-01-01',
    end_date: '1405-01-05',
    annual: true,
  });
  const from = Date.parse('2026-03-21T00:00:00Z'),
    cal = { ...calendar, weekly: [{ day: 6, start: '09:00', end: '12:00' }] };
  assert.equal(generateSlots(cal, [], [h], from, from + 86400000, 30).length, 0);
  assert.ok(generateSlots(cal, [], [], from, from + 86400000, 30).length > 0);
  assert.equal(holidaySchema.safeParse({ ...h, start_date: '1405-13-01' }).success, false);
});
test('overlapping or overnight rules require explicit separate intervals', () => {
  assert.equal(
    calendarSchema.safeParse({ ...calendar, weekly: [{ day: 1, start: '22:00', end: '02:00' }] })
      .success,
    false,
  );
  assert.equal(
    calendarSchema.safeParse({
      ...calendar,
      weekly: [
        { day: 1, start: '09:00', end: '11:00' },
        { day: 1, start: '10:00', end: '12:00' },
      ],
    }).success,
    false,
  );
  assert.deepEqual(
    subtractWindows(
      [{ start: 0, end: 100 }],
      [
        { start: 20, end: 40 },
        { start: 30, end: 60 },
      ],
    ),
    [
      { start: 0, end: 20 },
      { start: 60, end: 100 },
    ],
  );
});
