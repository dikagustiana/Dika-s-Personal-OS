// Wall-clock → fractional hour in a chosen IANA time zone. Pure.

/** The user's own zone, resolved once. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Fractional hour (0 ≤ h < 24) of `date` in `timeZone`. Falls back to UTC for an unknown zone. */
export function hourFloatInZone(date: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone).formatToParts(date);
  } catch {
    parts = formatterFor('UTC').formatToParts(date);
  }
  let h = 0;
  let m = 0;
  let s = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
    else if (p.type === 'second') s = Number(p.value);
  }
  return h + m / 60 + (s + date.getMilliseconds() / 1000) / 3600;
}

/** "18:30" style label for a fractional hour. */
export function formatHour(hour: number): string {
  const w = ((hour % 24) + 24) % 24;
  const h = Math.floor(w);
  const m = Math.floor((w - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A short, useful list for the HUD selector; the system zone is added at runtime. */
export const TIME_ZONE_CHOICES: string[] = [
  'UTC',
  'Asia/Jakarta',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
];
