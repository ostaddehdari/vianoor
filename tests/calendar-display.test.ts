import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  calendarParts,
  civilDate,
  monthCells,
  monthWindow,
  primaryCalendar,
} from '../packages/ui/src/calendar-dates.js';
import { threeCalendarCopy } from '../packages/ui/src/three-calendar-copy.js';
import { schedulingCopy } from '../packages/ui/src/scheduling-copy.js';

test('language selects primary calendar and all three dates retain the same civil day', () => {
  assert.equal(primaryCalendar('fa-IR'), 'persian');
  assert.equal(primaryCalendar('ar-SA'), 'islamic-umalqura');
  assert.equal(primaryCalendar('en-US'), 'gregory');
  assert.deepEqual(calendarParts('2026-09-27', 'persian'), { year: 1405, month: 7, day: 5 });
  assert.deepEqual(calendarParts('2026-09-27', 'gregory'), { year: 2026, month: 9, day: 27 });
  assert.deepEqual(calendarParts('2026-09-27', 'islamic-umalqura'), {
    year: 1448,
    month: 4,
    day: 16,
  });
  assert.equal(civilDate(new Date('2026-09-27T21:00:00Z'), 'Asia/Tehran'), '2026-09-28');
  assert.equal(civilDate(new Date('2026-09-27T01:00:00Z'), 'America/New_York'), '2026-09-26');
});
test('month boundaries follow the selected calendar across leap years and lunar month lengths', () => {
  assert.equal(monthWindow('2026-09-27', 'persian').start, '2026-09-23');
  assert.equal(monthWindow('2026-09-27', 'persian').end, '2026-10-22');
  assert.equal(monthWindow('2024-02-15', 'gregory').end, '2024-02-29');
  for (const kind of ['persian', 'islamic-umalqura', 'gregory'] as const) {
    let date = '2024-01-01';
    for (let n = 0; n < 48; n++) {
      const month = monthWindow(date, kind);
      assert.equal(calendarParts(month.start, kind).day, 1);
      assert.equal(calendarParts(month.next, kind).day, 1);
      assert.equal(addDays(month.end, 1), month.next);
      assert.equal(monthWindow(month.next, kind).previous, month.end);
      const cells = monthCells(date, kind, 'fa');
      assert.equal(cells.days.length % 7, 0);
      assert.equal(new Date(cells.days[0]! + 'T12:00Z').getUTCDay(), 6);
      assert.equal(new Set(cells.days).size, cells.days.length);
      assert.ok(cells.days.includes(month.start) && cells.days.includes(month.end));
      date = month.next;
    }
  }
  assert.equal(
    new Date(monthCells('2026-09-27', 'gregory', 'en').days[0]! + 'T12:00Z').getUTCDay(),
    1,
  );
});
test('calendar and scheduling translations have matching nonempty leaves', () => {
  const leaves = (value: unknown, prefix = ''): string[] =>
    typeof value === 'string'
      ? (assert.ok(value.trim()), [prefix])
      : Object.entries(value as object)
          .flatMap(([k, v]) => leaves(v, prefix + '.' + k))
          .sort();
  assert.deepEqual(leaves(threeCalendarCopy.fa), leaves(threeCalendarCopy.en));
  assert.deepEqual(leaves(threeCalendarCopy.ar), leaves(threeCalendarCopy.en));
  assert.deepEqual(leaves(schedulingCopy.fa), leaves(schedulingCopy.en));
});
