export { formatINR as inr } from '../../shared/rules';

export function fmtD(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function weekday(iso: string, style: 'long' | 'short' = 'long'): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: style });
}

export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "5 Nov" style label for chart axes. */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;
}

export function rel(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 1 ? `in ${n} days` : `${-n} days ago`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const HUES = ['#a8d8d2', '#bcc7f2', '#f1d2a6', '#d9bdea', '#b0dcab', '#f0bdb6'];

export function hue(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function mobileFmt(m: string): string {
  return m.length === 10 ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : m || '—';
}

export function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Friendly text for anything thrown by the network layer. */
export function errText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}
