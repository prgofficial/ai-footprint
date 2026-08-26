/**
 * G3: bucketing analytics in UTC makes "most active hours" meaningless. Every event stores
 * the local date/hour/weekday it happened at, derived once from its captured offset.
 */
export interface LocalStamp {
  localDate: string;
  localHour: number;
  localWeekday: number;
}

export function localStamp(timestampIso: string, tzOffsetMinutes: number): LocalStamp {
  const utcMs = Date.parse(timestampIso);
  const shifted = new Date((Number.isNaN(utcMs) ? 0 : utcMs) + tzOffsetMinutes * 60_000);
  const y = shifted.getUTCFullYear();
  const m = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${shifted.getUTCDate()}`.padStart(2, '0');
  return {
    localDate: `${y}-${m}-${d}`,
    localHour: shifted.getUTCHours(),
    localWeekday: shifted.getUTCDay(),
  };
}

export function offsetMinutesFor(timeZone: string, at: Date = new Date()): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return -at.getTimezoneOffset();
  }
}

/** Local wall-clock date string in the given IANA zone. */
export function localDateIn(timeZone: string, at: Date = new Date()): string {
  return localStamp(at.toISOString(), offsetMinutesFor(timeZone, at)).localDate;
}

export function startOfLocalDayUtc(localDate: string, timeZone: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  const offset = offsetMinutesFor(timeZone, new Date(guess));
  return new Date(guess - offset * 60_000).toISOString();
}

export function endOfLocalDayUtc(localDate: string, timeZone: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  const offset = offsetMinutesFor(timeZone, new Date(guess));
  return new Date(guess - offset * 60_000).toISOString();
}

export function addLocalDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const next = new Date(base + days * 86_400_000);
  return `${next.getUTCFullYear()}-${`${next.getUTCMonth() + 1}`.padStart(2, '0')}-${`${next.getUTCDate()}`.padStart(2, '0')}`;
}

export function diffLocalDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}
