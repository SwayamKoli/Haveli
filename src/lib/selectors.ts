/**
 * Everything the screens show is worked out here from the three lists
 * (rooms, guests, bookings), so the numbers always agree with each other.
 */
import { TYPE_DEFAULTS } from '../../shared/constants';
import { addDays, diffDays, weekdayMon0 } from '../../shared/dates';
import { guestIn, roomState } from '../../shared/rules';
import type { Booking, DataBundle, Guest, Room, RoomState } from '../../shared/types';
import { dayLabel } from './format';

export { guestIn, roomState };

type D = Pick<DataBundle, 'rooms' | 'bookings' | 'today'>;

export function counts(d: Pick<D, 'rooms' | 'bookings'>): Record<RoomState, number> {
  const c: Record<RoomState, number> = { available: 0, occupied: 0, cleaning: 0, maintenance: 0 };
  for (const r of d.rooms) c[roomState(r, d.bookings)]++;
  return c;
}

export function daysFrom(today: string, iso: string): number {
  return diffDays(today, iso);
}

/** The bookings that count as a sold night on `date`. Past = what happened, future = what is reserved. */
export function nightsOn(d: D, date: string): Booking[] {
  if (date === d.today) return d.bookings.filter((b) => b.stage === 'in' && b.ci <= date);
  if (date > d.today) return d.bookings.filter((b) => (b.stage === 'reserved' || b.stage === 'in') && b.ci <= date && date < b.co);
  return d.bookings.filter((b) => (b.stage === 'in' || b.stage === 'out') && b.ci <= date && date < b.co);
}

export function revenueOn(d: D, date: string): number {
  return nightsOn(d, date).reduce((s, b) => s + b.price, 0);
}

export function occupancyPct(d: D, date: string): number {
  return d.rooms.length ? Math.round((nightsOn(d, date).length / d.rooms.length) * 100) : 0;
}

export function arrivalsToday(d: D): Booking[] {
  return d.bookings.filter(
    (b) => (b.ci === d.today && (b.stage === 'reserved' || b.stage === 'in')) || (b.stage === 'reserved' && b.ci < d.today && b.co > d.today),
  );
}

/** Guests due out today, plus anyone still in the room after their check-out day. */
export function departuresToday(d: D): Booking[] {
  return d.bookings.filter((b) => (b.co === d.today && (b.stage === 'in' || b.stage === 'out')) || (b.stage === 'in' && b.co < d.today));
}

export function weekOccupancy(d: D): { dow: number; days: { date: string; pct: number }[] } {
  const dow = weekdayMon0(d.today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(d.today, i - dow);
    return { date, pct: occupancyPct(d, date) };
  });
  return { dow, days };
}

export function revenueSeries(d: D, n: number): { vals: number[]; labels: string[] } {
  const dates = Array.from({ length: n }, (_, i) => addDays(d.today, i - (n - 1)));
  return { vals: dates.map((x) => revenueOn(d, x)), labels: dates.map(dayLabel) };
}

export interface RoomTypeInfo {
  type: string;
  price: number;
  bed: string;
  cap: number;
}

/** Room types in the sheet (with their rate), plus the standard ones if not used yet. */
export function roomTypes(rooms: Room[]): RoomTypeInfo[] {
  const out: RoomTypeInfo[] = [];
  for (const r of rooms) if (!out.some((t) => t.type === r.type)) out.push({ type: r.type, price: r.price, bed: r.bed, cap: r.cap });
  for (const [type, def] of Object.entries(TYPE_DEFAULTS)) if (!out.some((t) => t.type === type)) out.push({ type, ...def });
  return out;
}

export interface GuestSummary {
  key: string;
  id: string;
  name: string;
  mobile: string;
  city: string;
  stays: number;
  last: string;
  billed: number;
  due: number;
  status: 'in' | 'upcoming' | 'past' | 'none';
  rooms: number[];
}

/** One row per guest, using the Guests tab plus any booking whose guest row is missing. */
export function guestSummaries(d: { guests: Guest[]; bookings: Booking[] }): GuestSummary[] {
  const byGuest = new Map<string, Booking[]>();
  const orphan = new Map<string, Booking[]>();
  const known = new Set(d.guests.map((g) => g.id));
  for (const b of d.bookings) {
    if (b.guestId && known.has(b.guestId)) byGuest.set(b.guestId, [...(byGuest.get(b.guestId) ?? []), b]);
    else orphan.set(b.guest.toLowerCase(), [...(orphan.get(b.guest.toLowerCase()) ?? []), b]);
  }
  const summarise = (key: string, id: string, name: string, mobile: string, city: string, list: Booking[]): GuestSummary => {
    const real = list.filter((b) => b.stage !== 'cancelled');
    const status = list.some((b) => b.stage === 'in') ? 'in' : list.some((b) => b.stage === 'reserved') ? 'upcoming' : real.length ? 'past' : 'none';
    return {
      key,
      id,
      name,
      mobile,
      city,
      stays: real.length,
      last: real.reduce((m, b) => (b.ci > m ? b.ci : m), ''),
      billed: real.reduce((s, b) => s + b.total, 0),
      due: real.reduce((s, b) => s + b.balance, 0),
      status,
      rooms: Array.from(new Set(list.map((b) => b.room))),
    };
  };
  const out: GuestSummary[] = d.guests.map((g) => summarise(g.id, g.id, g.name, g.mobile, g.city, byGuest.get(g.id) ?? []));
  for (const [k, list] of orphan) out.push(summarise(`name:${k}`, '', list[0].guest, list[0].mobile, '', list));
  return out.sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name));
}

export function attentionRooms(d: Pick<D, 'rooms'>): Room[] {
  return d.rooms.filter((r) => r.manual !== 'available');
}
