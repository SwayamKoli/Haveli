/**
 * Small formatting and parsing helpers: mobile numbers, rupees, arrival times, the price of a stay, room lists.
 */
export function normalizeMobile(s: string): string {
  return String(s ?? '').replace(/\D/g, '').slice(-10);
}

export function formatINR(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** "14:00" -> "2:00 PM". Returns "" for anything that is not a valid 24-hour time. */
export function formatEta(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Reads "2:00 PM", "14:00" or a sheet time (fraction of a day) into minutes after midnight. */
export function parseEtaMinutes(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const frac = v - Math.floor(v);
    return Math.round(frac * 1440) % 1440;
  }
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(v ?? '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'PM' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** gross = nights x combined rate; total = gross minus the discount (never below 0). */
export function money(price: number, nights: number, paid: number, discount = 0) {
  const gross = Math.max(0, price * nights);
  const total = Math.max(0, gross - Math.max(0, discount));
  return { gross, total, balance: total - paid };
}

/** "101", "101 & 102", "101, 102 & 103" */
export function roomsLabel(rooms: number[]): string {
  if (rooms.length <= 1) return rooms.join('');
  return `${rooms.slice(0, -1).join(', ')} & ${rooms[rooms.length - 1]}`;
}

/** Reads what a person typed or the sheet holds ("101", "101, 102", 101) into room numbers. */
export function parseRoomList(v: unknown): number[] {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? [v] : [];
  const out: number[] = [];
  for (const part of String(v ?? '').split(/[^0-9]+/)) {
    if (!part) continue;
    const n = Number(part);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
