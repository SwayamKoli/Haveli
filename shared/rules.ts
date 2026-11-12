/**
 * Business rules. The server uses these before it writes to the sheet, the
 * website uses the same ones to give instant feedback, and the demo mode
 * uses them to behave exactly like the real thing.
 */
import { ID_TYPES, MAX_STAY_NIGHTS, MOBILE_RE, SOURCES, STAGE_LABEL } from './constants';
import { diffDays, isISODate } from './dates';
import type {
  Booking,
  FieldErrors,
  NewBookingInput,
  NewRoomInput,
  Room,
  RoomManual,
  RoomState,
  Stage,
} from './types';

/* ---------- small helpers ---------- */

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

export function money(price: number, nights: number, paid: number) {
  const total = Math.max(0, price * nights);
  return { total, balance: total - paid };
}

/* ---------- rooms ---------- */

export function guestIn(roomNo: number, bookings: Booking[]): Booking | undefined {
  return bookings.find((b) => b.stage === 'in' && b.room === roomNo);
}

export function roomState(room: Room, bookings: Booking[]): RoomState {
  if (room.manual !== 'available') return room.manual;
  return guestIn(room.no, bookings) ? 'occupied' : 'available';
}

/** True when two stays overlap. A guest leaving on the 12th does not clash with one arriving on the 12th. */
export function overlaps(aIn: string, aOut: string, bIn: string, bOut: string): boolean {
  return aIn < bOut && aOut > bIn;
}

/** A reserved or checked-in booking for the same room that overlaps these dates. */
export function findClash(
  roomNo: number,
  ci: string,
  co: string,
  bookings: Booking[],
  excludeId?: string,
): Booking | undefined {
  return bookings.find(
    (b) =>
      b.id !== excludeId &&
      b.room === roomNo &&
      (b.stage === 'reserved' || b.stage === 'in') &&
      overlaps(ci, co, b.ci, b.co),
  );
}

/* ---------- validation ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateNewBooking(
  input: NewBookingInput,
  ctx: { rooms: Room[]; bookings: Booking[]; today: string },
): FieldErrors {
  const e: FieldErrors = {};
  const name = (input.name ?? '').trim();
  if (name.length < 2) e.name = 'Enter the guest name.';
  else if (name.length > 80) e.name = 'Keep the name under 80 characters.';

  if (!MOBILE_RE.test(String(input.mobile ?? '').trim())) e.mob = 'Enter a 10-digit Indian mobile number.';
  if (!SOURCES.includes(input.source)) e.source = 'Choose a source from the list.';

  let nights = 0;
  if (!isISODate(input.ci) || !isISODate(input.co)) {
    e.out = 'Choose valid dates.';
  } else if (input.ci < ctx.today) {
    e.ci = 'Check-in cannot be in the past.';
  } else {
    nights = diffDays(input.ci, input.co);
    if (nights < 1) e.out = 'Check-out must be after check-in.';
    else if (nights > MAX_STAY_NIGHTS) e.out = `Stays over ${MAX_STAY_NIGHTS} nights should be split into two bookings.`;
  }

  const room = ctx.rooms.find((r) => r.no === input.room);
  if (!room) {
    e.room = 'Choose a room.';
  } else if (room.manual === 'maintenance') {
    e.room = `Room ${room.no} is under maintenance.`;
  } else if (nights >= 1) {
    const clash = findClash(room.no, input.ci, input.co, ctx.bookings);
    if (clash) e.room = `Room ${room.no} is taken by ${clash.guest} for part of this stay.`;
  }

  const adv = Number(input.advance);
  if (!Number.isFinite(adv) || adv < 0) e.adv = 'Enter 0 or more.';
  else if (room && nights >= 1 && adv > room.price * nights) e.adv = 'Advance is more than the stay total.';

  const people = Number(input.people);
  if (!Number.isInteger(people) || people < 1) e.people = 'At least 1 guest.';
  else if (room && people > room.cap) e.people = `Room ${room.no} sleeps up to ${room.cap}.`;

  if (input.eta && !formatEta(input.eta)) e.eta = 'Use a time like 14:00.';
  if (input.email && !EMAIL_RE.test(input.email.trim())) e.email = 'That email does not look right.';
  if (input.idLast4 && !/^\d{4}$/.test(input.idLast4.trim())) e.idLast4 = 'Enter exactly the last 4 digits.';
  if (input.idType && !ID_TYPES.includes(input.idType)) e.idType = 'Choose an ID type from the list.';
  if ((input.notes ?? '').length > 300) e.notes = 'Keep notes under 300 characters.';
  if ((input.city ?? '').length > 60) e.city = 'Keep the city under 60 characters.';
  return e;
}

export function validateNewRoom(input: NewRoomInput, rooms: Room[], knownTypes: string[]): FieldErrors {
  const e: FieldErrors = {};
  if (!Number.isInteger(input.no) || input.no < 1 || input.no > 9999) e.no = 'Enter a room number between 1 and 9999.';
  else if (rooms.some((r) => r.no === input.no)) e.no = `Room ${input.no} already exists.`;
  if (!Number.isInteger(input.floor) || input.floor < 0 || input.floor > 60) e.floor = 'Choose a floor.';
  if (!knownTypes.includes(input.type)) e.type = 'Choose a room type from the list.';
  return e;
}

/* ---------- moving a booking between stages ---------- */

export type StagePlan =
  | { ok: true; stage: Stage; /** New manual status for the room, or null to leave it. */ roomManual: RoomManual | null }
  | { ok: false; error: string };

/**
 * Decides whether a booking may move to `to`, and what that does to the room.
 * `restore` is only used by Undo: it forces the room back to a known status.
 */
export function planStage(
  booking: Booking,
  room: Room | undefined,
  bookings: Booking[],
  to: Stage,
  restore?: RoomManual,
): StagePlan {
  if (booking.stage === to) return { ok: false, error: `Already ${STAGE_LABEL[to].toLowerCase()}.` };
  if (!room) return { ok: false, error: `Room ${booking.room} is not in the Rooms tab.` };

  if (to === 'cancelled' && booking.stage === 'in') {
    return { ok: false, error: 'Check the guest out instead of cancelling.' };
  }

  let roomManual: RoomManual | null = null;

  if (to === 'in') {
    if (room.manual === 'maintenance') return { ok: false, error: `Room ${room.no} is under maintenance.` };
    const other = bookings.find((x) => x.stage === 'in' && x.room === room.no && x.id !== booking.id);
    if (other) return { ok: false, error: `Room ${room.no} is occupied by ${other.guest}.` };
    if (room.manual === 'cleaning') roomManual = 'available';
  }

  if ((to === 'reserved' || to === 'in') && (booking.stage === 'out' || booking.stage === 'cancelled')) {
    const clash = findClash(booking.room, booking.ci, booking.co, bookings, booking.id);
    if (clash) return { ok: false, error: `Room ${booking.room} is taken by ${clash.guest} for those dates.` };
  }

  if (to === 'out' && booking.stage === 'in') roomManual = 'cleaning';

  if (restore) roomManual = restore;
  if (roomManual === room.manual) roomManual = null;
  return { ok: true, stage: to, roomManual };
}

export function planRoomStatus(
  room: Room,
  bookings: Booking[],
  to: RoomManual,
): { ok: true } | { ok: false; error: string } {
  if (to !== 'available' && roomState(room, bookings) === 'occupied') {
    return { ok: false, error: `Check out the guest in room ${room.no} first.` };
  }
  return { ok: true };
}

export function planPayment(
  booking: Booking,
  amount: number,
): { ok: true; paid: number } | { ok: false; error: string } {
  if (booking.stage === 'cancelled') return { ok: false, error: 'This booking is cancelled, so there is nothing to collect.' };
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: 'Enter a whole-rupee amount above zero.' };
  }
  if (amount > booking.balance) {
    return { ok: false, error: booking.balance > 0 ? `Only ${formatINR(booking.balance)} is due.` : 'This booking is already fully paid.' };
  }
  return { ok: true, paid: booking.paid + amount };
}

/** Next ID like BK0007, based on the biggest number already used. */
export function nextId(prefix: string, existing: string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = /(\d+)\s*$/.exec(id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + String(max + 1).padStart(4, '0');
}
