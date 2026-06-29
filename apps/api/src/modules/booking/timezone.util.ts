/**
 * Timezone helpers for the public booking engine.
 *
 * The API has NO date library (no luxon / date-fns-tz / dayjs) — we rely on the
 * platform `Intl` API, which ships full IANA tz data in Node 18+. These helpers
 * convert between a "wall-clock time in some IANA timezone" and an absolute UTC
 * instant, correctly across DST transitions.
 *
 * The core trick (`getTimeZoneOffsetMs`): format a known UTC instant *as if it
 * were in the target tz*, parse the resulting wall-clock components back into a
 * UTC timestamp, and the difference is the tz's offset at that instant. Because
 * we ask Intl for the offset *at a specific instant*, the answer already
 * reflects whatever DST rule is in force then — no hard-coded offsets.
 */

/**
 * Offset of `timeZone` from UTC, in milliseconds, at the given absolute
 * instant `date`. Positive for zones ahead of UTC (e.g. +03:00 → +10800000).
 *
 * How it works: we format `date` into the tz's local wall-clock parts, rebuild
 * a UTC timestamp from those parts, and subtract the original UTC time. The
 * delta IS the offset, capturing DST automatically since Intl applies the rule
 * active at `date`.
 */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
  }
  // Intl can emit hour '24' at midnight for hour12:false — normalise to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  // Treat the formatted wall-clock components as if they were UTC.
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock date + time *in `timeZone`* to the absolute UTC `Date`.
 *
 *   wallTimeToUtc('2026-07-15', 9, 30, 'America/New_York')
 *     → the Date instant that reads 09:30 on a NY clock on that day.
 *
 * DST correctness: the offset depends on the instant, but the instant is what
 * we're solving for — a chicken-and-egg. We resolve it by computing the offset
 * twice: first using a naive guess (the wall time treated as UTC), then again
 * using that first estimate. Two iterations are sufficient for every real IANA
 * zone, including the ambiguous/skipped hour around a DST switch (the second
 * pass lands on the correct side of the transition).
 */
export function wallTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  // Naive guess: pretend the wall time is already UTC.
  const guessUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0);
  // Offset at that guessed instant, then correct.
  const offset1 = getTimeZoneOffsetMs(new Date(guessUtcMs), timeZone);
  const corrected1 = guessUtcMs - offset1;
  // Re-evaluate the offset at the corrected instant (handles DST boundaries).
  const offset2 = getTimeZoneOffsetMs(new Date(corrected1), timeZone);
  return new Date(guessUtcMs - offset2);
}

/**
 * Lowercase 3-letter weekday key ('mon'..'sun') for the given wall-clock day
 * (`ymd`) *as observed in `timeZone`*. We anchor to local noon of that day to
 * stay clear of any midnight DST edge that could flip the date.
 */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function weekdayKeyInTz(ymd: string, timeZone: string): string {
  const noonUtc = wallTimeToUtc(ymd, 12, 0, timeZone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  });
  // 'short' → e.g. 'Wed'; map via a reference date instead to avoid locale drift.
  const idx = dtfWeekdayIndex(noonUtc, timeZone);
  void dtf;
  return WEEKDAY_KEYS[idx];
}

/** 0 (Sun) .. 6 (Sat) for `date` as observed in `timeZone`. */
function dtfWeekdayIndex(date: Date, timeZone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
  const lookup: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return lookup[wd] ?? 0;
}

/** "HH:MM" → minutes since midnight. Returns null if malformed. */
export function parseHhMm(s: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** True if `tz` is a valid IANA timezone the runtime can format. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
