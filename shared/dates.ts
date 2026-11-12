/**
 * Date helpers. Every date in the app is a plain "YYYY-MM-DD" string so that
 * time zones can never shift a booking by a day.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True for a real calendar date such as 2026-02-28 (and false for 2026-02-30). */
export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toMs(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Add (or subtract) whole days. */
export function addDays(iso: string, n: number): string {
  return new Date(toMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** Day of week with Monday = 0 and Sunday = 6. */
export function weekdayMon0(iso: string): number {
  return (new Date(toMs(iso)).getUTCDay() + 6) % 7;
}

/** Today's date as seen on the wall clock in `timeZone`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** "2026-11-11 08:33" in `timeZone`. Used for the Created at / Updated at columns. */
export function stampInZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
}

/** Google Sheets stores dates as days since 1899-12-30. */
export function serialToISO(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

/** A sheet date-time (days with a fraction) as "YYYY-MM-DD HH:MM". */
export function serialToStamp(serial: number): string {
  const day = Math.floor(serial);
  const mins = Math.round((serial - day) * 1440);
  const h = Math.floor(mins / 60) % 24;
  return `${serialToISO(day)} ${String(h).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * Best-effort reading of a date typed into the sheet by hand. Understands
 * 2026-11-11, 11/11/2026 and 11-11-2026 (day first, as is usual in India).
 */
export function looseDateToISO(s: string): string | null {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) {
    const out = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
    return isISODate(out) ? out : null;
  }
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t);
  if (dmy) {
    const out = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return isISODate(out) ? out : null;
  }
  return null;
}
