import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { getPreviousCalendarWeekRange, getPreviousCalendarMonthRange, getMonthRangeOffset } from './dateRanges.js';

const TZ = 'Europe/Bucharest';

function toDate(isoOrDt) {
  if (typeof isoOrDt === 'string') return new Date(isoOrDt);
  if (isoOrDt.toJSDate) return isoOrDt.toJSDate();
  return isoOrDt;
}

describe('getPreviousCalendarWeekRange', () => {
  it('returns previous week for a Monday morning run (09:30 Europe/Bucharest)', () => {
    const mondayMorning = DateTime.fromISO('2026-01-26T09:30:00', { zone: TZ });
    const { periodStart, periodEnd, label } = getPreviousCalendarWeekRange(toDate(mondayMorning));
    expect(label).toBe('2026-01-19..2026-01-25');
    expect(periodStart).toContain('2026-01-19');
    expect(periodStart).toMatch(/00:00:00/);
    expect(periodEnd).toContain('2026-01-25');
    expect(periodEnd).toMatch(/23:59:59/);
  });

  it('returns previous week for a run during DST (spring forward 2025 - Monday after Mar 30)', () => {
    const afterSpringForward = DateTime.fromISO('2025-03-31T09:30:00', { zone: TZ });
    const { periodStart, periodEnd, label } = getPreviousCalendarWeekRange(toDate(afterSpringForward));
    expect(label).toBe('2025-03-24..2025-03-30');
    expect(periodStart).toContain('2025-03-24');
    expect(periodEnd).toContain('2025-03-30');
  });

  it('returns previous week for a run during DST (fall back 2025 - Monday after Oct 26)', () => {
    const afterFallBack = DateTime.fromISO('2025-10-27T09:30:00', { zone: TZ });
    const { periodStart, periodEnd, label } = getPreviousCalendarWeekRange(toDate(afterFallBack));
    expect(label).toBe('2025-10-20..2025-10-26');
    expect(periodStart).toContain('2025-10-20');
    expect(periodEnd).toContain('2025-10-26');
  });

  it('returns previous week for a Wednesday run', () => {
    const wednesday = DateTime.fromISO('2026-01-22T14:00:00', { zone: TZ });
    const { label } = getPreviousCalendarWeekRange(toDate(wednesday));
    expect(label).toBe('2026-01-12..2026-01-18');
  });

  it('returns previous week for a run on Sunday (current week still in progress)', () => {
    const sunday = DateTime.fromISO('2026-01-25T23:59:00', { zone: TZ });
    const { label } = getPreviousCalendarWeekRange(toDate(sunday));
    expect(label).toBe('2026-01-12..2026-01-18');
  });
});

describe('getPreviousCalendarMonthRange', () => {
  it('returns previous month (December) for a run on Jan 5th', () => {
    const jan5 = DateTime.fromISO('2026-01-05T09:30:00', { zone: TZ });
    const { periodStart, periodEnd, label } = getPreviousCalendarMonthRange(toDate(jan5));
    expect(label).toBe('2025-12-01..2025-12-31');
    expect(periodStart).toContain('2025-12-01');
    expect(periodStart).toMatch(/00:00:00/);
    expect(periodEnd).toContain('2025-12-31');
    expect(periodEnd).toMatch(/23:59:59/);
  });

  it('returns previous month for a run during DST transition month (April 2026)', () => {
    const april = DateTime.fromISO('2026-04-05T09:30:00', { zone: TZ });
    const { label } = getPreviousCalendarMonthRange(toDate(april));
    expect(label).toBe('2026-03-01..2026-03-31');
  });

  it('returns previous month for a run on Oct 26 2025 (DST end day)', () => {
    const oct26 = DateTime.fromISO('2025-10-26T12:00:00', { zone: TZ });
    const { label } = getPreviousCalendarMonthRange(toDate(oct26));
    expect(label).toBe('2025-09-01..2025-09-30');
  });

  it('returns November for a run on Dec 1st', () => {
    const dec1 = DateTime.fromISO('2025-12-01T09:30:00', { zone: TZ });
    const { label } = getPreviousCalendarMonthRange(toDate(dec1));
    expect(label).toBe('2025-11-01..2025-11-30');
  });
});

describe('getMonthRangeOffset', () => {
  it('offset 0 equals previous calendar month', () => {
    const jan5 = DateTime.fromISO('2026-01-05T09:30:00', { zone: TZ });
    const prev = getPreviousCalendarMonthRange(toDate(jan5));
    const off0 = getMonthRangeOffset(toDate(jan5), 0);
    expect(off0.label).toBe(prev.label);
    expect(off0.periodStart).toBe(prev.periodStart);
  });

  it('offset -1 returns 2 months ago, offset -2 returns 3 months ago', () => {
    const jan5 = DateTime.fromISO('2026-01-05T09:30:00', { zone: TZ });
    const off0 = getMonthRangeOffset(toDate(jan5), 0);
    const off1 = getMonthRangeOffset(toDate(jan5), -1);
    const off2 = getMonthRangeOffset(toDate(jan5), -2);
    expect(off0.label).toContain('2025-12');
    expect(off1.label).toContain('2025-11');
    expect(off2.label).toContain('2025-10');
  });
});
