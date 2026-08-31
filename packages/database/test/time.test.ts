import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  diffLocalDays,
  endOfLocalDayUtc,
  localStamp,
  offsetMinutesFor,
  startOfLocalDayUtc,
} from '../src/time';

describe('localStamp', () => {
  it('shifts a UTC instant into the local day, hour and weekday', () => {
    const stamp = localStamp('2026-03-01T23:30:00.000Z', -8 * 60);
    expect(stamp.localDate).toBe('2026-03-01');
    expect(stamp.localHour).toBe(15);

    const rollover = localStamp('2026-03-01T23:30:00.000Z', 5 * 60 + 30);
    expect(rollover.localDate).toBe('2026-03-02');
    expect(rollover.localHour).toBe(5);
  });

  it('never throws on an unparseable timestamp', () => {
    expect(() => localStamp('not-a-date', 0)).not.toThrow();
  });
});

describe('offsetMinutesFor', () => {
  it('resolves fixed and half-hour zones', () => {
    expect(offsetMinutesFor('UTC', new Date('2026-06-15T12:00:00Z'))).toBe(0);
    expect(offsetMinutesFor('Asia/Kolkata', new Date('2026-06-15T12:00:00Z'))).toBe(330);
  });

  it('tracks daylight saving transitions', () => {
    const winter = offsetMinutesFor('America/New_York', new Date('2026-01-15T12:00:00Z'));
    const summer = offsetMinutesFor('America/New_York', new Date('2026-07-15T12:00:00Z'));
    expect(winter).toBe(-300);
    expect(summer).toBe(-240);
  });
});

describe('local day boundaries', () => {
  it('brackets a local day in UTC', () => {
    const start = startOfLocalDayUtc('2026-06-15', 'Asia/Kolkata');
    const end = endOfLocalDayUtc('2026-06-15', 'Asia/Kolkata');
    expect(start).toBe('2026-06-14T18:30:00.000Z');
    expect(end).toBe('2026-06-15T18:29:59.999Z');
  });

  it('adds and diffs days across a month boundary', () => {
    expect(addLocalDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffLocalDays('2026-01-01', '2026-02-01')).toBe(31);
  });
});
