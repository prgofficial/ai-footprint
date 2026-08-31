import {
  addLocalDays,
  diffLocalDays,
  endOfLocalDayUtc,
  localDateIn,
  startOfLocalDayUtc,
} from '@ai-footprint/database';
import type { RangePreset, ResolvedRange } from '@ai-footprint/shared';

const PRESET_DAYS: Record<Exclude<RangePreset, 'all' | 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '3m': 90,
};

export interface RangeInput {
  range: RangePreset;
  from?: string;
  to?: string;
  timezone: string;
  earliest?: string | null;
}

/**
 * G3: every range is a span of local days converted to UTC instants, so "today" means the
 * user's today and a 30-day window is not silently shifted by their offset.
 */
export function resolveRange(input: RangeInput): ResolvedRange {
  const { timezone } = input;
  const todayLocal = localDateIn(timezone);

  if (input.range === 'custom' && input.from && input.to) {
    const fromDate = localDateIn(timezone, new Date(input.from));
    const toDate = localDateIn(timezone, new Date(input.to));
    return withPrevious(fromDate, toDate, timezone, 'custom');
  }

  if (input.range === 'all') {
    const earliestDate = input.earliest
      ? localDateIn(timezone, new Date(input.earliest))
      : addLocalDays(todayLocal, -365);
    return withPrevious(earliestDate, todayLocal, timezone, 'all');
  }

  const days = PRESET_DAYS[input.range as keyof typeof PRESET_DAYS] ?? 30;
  const fromDate = addLocalDays(todayLocal, -(days - 1));
  return withPrevious(fromDate, todayLocal, timezone, input.range);
}

function withPrevious(
  fromDate: string,
  toDate: string,
  timezone: string,
  preset: RangePreset,
): ResolvedRange {
  const span = Math.max(1, diffLocalDays(fromDate, toDate) + 1);
  const previousTo = addLocalDays(fromDate, -1);
  const previousFrom = addLocalDays(previousTo, -(span - 1));
  return {
    preset,
    from: startOfLocalDayUtc(fromDate, timezone),
    to: endOfLocalDayUtc(toDate, timezone),
    timezone,
    previousFrom: startOfLocalDayUtc(previousFrom, timezone),
    previousTo: endOfLocalDayUtc(previousTo, timezone),
  };
}

export function granularityFor(range: ResolvedRange): 'hour' | 'day' | 'week' {
  const spanMs = Date.parse(range.to) - Date.parse(range.from);
  const days = spanMs / 86_400_000;
  if (days <= 2) return 'hour';
  if (days <= 120) return 'day';
  return 'week';
}

export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
