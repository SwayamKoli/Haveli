/**
 * Business rules. The server uses these before it writes to the sheet, the
 * website uses the same ones to give instant feedback, and the demo mode
 * uses them to behave exactly like the real thing.
 */
import { ID_TYPES, MAX_STAY_NIGHTS, MOBILE_RE, PAY_METHODS, REFUND_METHOD, SOURCES, STAGE_LABEL } from './constants';
import { diffDays, isISODate } from './dates';
import type {
  Booking,
  BookingFields,
  FieldErrors,
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

/* ---------- rooms ---------- */

export function guestIn(roomNo: number, bookings: Booking[]): Booking | undefined {
  return bookings.find((b) => b.stage === 'in' && b.rooms.includes(roomNo));
}

export function roomState(room: Room, bookings: Booking[]): RoomState {
  if (room.manual !== 'available') return room.manual;
  return guestIn(room.no, bookings) ? 'occupied' : 'available';
}

/** True when two stays overlap. A guest leaving on the 12th does not clash with one arriving on the 12th. */
export function overlaps(aIn: string, aOut: string, bIn: string, bOut: string): boolean {
  return aIn < bOut && aOut > bIn;
}

/** A reserved or checked-in booking holding any of these rooms on an overlapping date. */
export function findClash(
  roomNos: number[],
  ci: string,
  co: string,
  bookings: Booking[],
  excludeId?: string,
): { booking: Booking; room: number } | undefined {
  for (const b of bookings) {
    if (b.id === excludeId || (b.stage !== 'reserved' && b.stage !== 'in') || !overlaps(ci, co, b.ci, b.co)) continue;
    const room = roomNos.find((n) => b.rooms.includes(n));
    if (room !== undefined) return { booking: b, room };
  }
  return undefined;
}

/* ---------- validation ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks the booking form. `paid` is the advance for a new booking, or what has
 * already been paid for an existing one. `existing` is set when editing.
 */
export function validateBooking(
  input: BookingFields,
  ctx: { rooms: Room[]; bookings: Booking[]; today: string },
  paid: number,
  existing?: Booking,
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
  } else if (input.ci < ctx.today && (!existing || existing.ci !== input.ci)) {
    e.ci = 'Check-in cannot be in the past.';
  } else {
    nights = diffDays(input.ci, input.co);
    if (nights < 1) e.out = 'Check-out must be after check-in.';
    else if (nights > MAX_STAY_NIGHTS) e.out = `Stays over ${MAX_STAY_NIGHTS} nights should be split into two bookings.`;
  }

  const wanted = Array.isArray(input.rooms) ? input.rooms : [];
  const rooms: Room[] = [];
  if (wanted.length === 0) e.room = 'Choose at least one room.';
  else if (wanted.length > 12) e.room = 'A single booking can hold up to 12 rooms.';
  else if (new Set(wanted).size !== wanted.length) e.room = 'The same room is chosen twice.';
  else {
    for (const no of wanted) {
      const r = ctx.rooms.find((x) => x.no === no);
      if (!r) {
        e.room = `Room ${no} does not exist.`;
        break;
      }
      rooms.push(r);
    }
  }
  if (!e.room) {
    const maint = rooms.find((r) => r.manual === 'maintenance' && !(existing && existing.rooms.includes(r.no)));
    if (maint) e.room = `Room ${maint.no} is under maintenance.`;
    else if (nights >= 1) {
      const clash = findClash(wanted, input.ci, input.co, ctx.bookings, existing?.id);
      if (clash) e.room = `Room ${clash.room} is taken by ${clash.booking.guest} for part of this stay.`;
    }
  }

  const price = existing && sameRooms(existing.rooms, wanted) ? existing.price : rooms.reduce((s, r) => s + r.price, 0);
  const gross = Math.max(0, price * nights);
  const disc = Number(input.discount ?? 0);
  if (!Number.isFinite(disc) || !Number.isInteger(disc) || disc < 0) e.discount = 'Enter a whole number of rupees, 0 or more.';
  else if (nights >= 1 && !e.room && disc > gross) e.discount = `Discount cannot be more than the stay total (${formatINR(gross)}).`;

  if (nights >= 1 && !e.room && !e.discount) {
    const total = Math.max(0, gross - (Number(input.discount) || 0));
    if (!existing) {
      if (!Number.isFinite(paid) || paid < 0) e.adv = 'Enter 0 or more.';
      else if (paid > total) e.adv = 'Advance is more than the amount payable.';
    } else if (paid > total) {
      e.discount = `The guest has already paid ${formatINR(paid)}, which is more than the new total ${formatINR(total)}.`;
    }
  } else if (!existing && (!Number.isFinite(paid) || paid < 0)) e.adv = 'Enter 0 or more.';

  const people = Number(input.people);
  const cap = rooms.reduce((s, r) => s + r.cap, 0);
  if (!Number.isInteger(people) || people < 1) e.people = 'At least 1 guest.';
  else if (rooms.length && people > cap) e.people = rooms.length === 1 ? `Room ${rooms[0].no} sleeps up to ${cap}.` : `These rooms sleep up to ${cap} in total.`;

  if (input.eta && !formatEta(input.eta)) e.eta = 'Use a time like 14:00.';
  if (input.email && !EMAIL_RE.test(input.email.trim())) e.email = 'That email does not look right.';
  if (input.idLast4 && !/^\d{4}$/.test(input.idLast4.trim())) e.idLast4 = 'Enter exactly the last 4 digits.';
  if (input.idType && !ID_TYPES.includes(input.idType)) e.idType = 'Choose an ID type from the list.';
  if ((input.notes ?? '').length > 300) e.notes = 'Keep notes under 300 characters.';
  if ((input.city ?? '').length > 60) e.city = 'Keep the city under 60 characters.';
  return e;
}

export function validatePayMethod(method: string): string | null {
  return PAY_METHODS.includes(method) ? null : 'Choose how it was paid.';
}

export function sameRooms(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort((x, y) => x - y).every((n, i) => n === [...b].sort((x, y) => x - y)[i]);
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

export interface RoomChange {
  no: number;
  manual: RoomManual;
}

export type StagePlan = { ok: true; stage: Stage; roomChanges: RoomChange[] } | { ok: false; error: string };

/** Checks that a room can take a guest right now (used at check-in and when a stay moves to a room). */
function canHostNow(room: Room, bookings: Booking[], exceptBooking: string): string | null {
  if (room.manual === 'maintenance') return `Room ${room.no} is under maintenance.`;
  const other = bookings.find((x) => x.stage === 'in' && x.rooms.includes(room.no) && x.id !== exceptBooking);
  if (other) return `Room ${room.no} is occupied by ${other.guest}.`;
  return null;
}

/**
 * Decides whether a booking may move to `to`, and what that does to its rooms.
 * `restore` is only used by Undo: it forces rooms back to the statuses they had.
 */
export function planStage(
  booking: Booking,
  rooms: Room[],
  bookings: Booking[],
  to: Stage,
  restore?: Record<number, RoomManual>,
): StagePlan {
  if (booking.stage === to) return { ok: false, error: `Already ${STAGE_LABEL[to].toLowerCase()}.` };
  const missing = booking.rooms.find((n) => !rooms.some((r) => r.no === n));
  if (missing !== undefined) return { ok: false, error: `Room ${missing} is not in the Rooms tab.` };

  if (to === 'cancelled' && booking.stage === 'in') {
    return { ok: false, error: 'Check the guest out instead of cancelling.' };
  }

  const target = new Map<number, RoomManual>();
  if (to === 'in') {
    for (const room of rooms) {
      const problem = canHostNow(room, bookings, booking.id);
      if (problem) return { ok: false, error: problem };
      if (room.manual === 'cleaning') target.set(room.no, 'available');
    }
  }

  if ((to === 'reserved' || to === 'in') && (booking.stage === 'out' || booking.stage === 'cancelled')) {
    const clash = findClash(booking.rooms, booking.ci, booking.co, bookings, booking.id);
    if (clash) return { ok: false, error: `Room ${clash.room} is taken by ${clash.booking.guest} for those dates.` };
  }

  if (to === 'out' && booking.stage === 'in') for (const room of rooms) target.set(room.no, 'cleaning');

  if (restore) for (const [no, manual] of Object.entries(restore)) if (booking.rooms.includes(Number(no))) target.set(Number(no), manual);

  const roomChanges: RoomChange[] = [];
  for (const room of rooms) {
    const manual = target.get(room.no);
    if (manual && manual !== room.manual) roomChanges.push({ no: room.no, manual });
  }
  return { ok: true, stage: to, roomChanges };
}

/**
 * When a checked-in guest is moved to other rooms (or rooms are added), the rooms they
 * leave need cleaning and the new ones must be free.
 */
export function planRoomMove(
  booking: Booking,
  nextNos: number[],
  allRooms: Room[],
  bookings: Booking[],
): { ok: true; roomChanges: RoomChange[] } | { ok: false; error: string } {
  if (booking.stage !== 'in') return { ok: true, roomChanges: [] };
  const roomChanges: RoomChange[] = [];
  for (const no of nextNos) {
    if (booking.rooms.includes(no)) continue;
    const room = allRooms.find((r) => r.no === no);
    if (!room) return { ok: false, error: `Room ${no} does not exist.` };
    const problem = canHostNow(room, bookings, booking.id);
    if (problem) return { ok: false, error: problem };
    if (room.manual === 'cleaning') roomChanges.push({ no, manual: 'available' });
  }
  for (const no of booking.rooms) {
    if (nextNos.includes(no)) continue;
    const room = allRooms.find((r) => r.no === no);
    if (room && room.manual !== 'cleaning') roomChanges.push({ no, manual: 'cleaning' });
  }
  return { ok: true, roomChanges };
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

/**
 * Money in (positive) or money back (negative whole rupees).
 * A refund needs a short reason in `note` (or the method "Refund"), cannot be more than has
 * been paid, and is the one thing still allowed on a cancelled booking.
 */
export function planPayment(
  booking: Booking,
  amount: number,
  method: string,
  note = '',
): { ok: true; paid: number } | { ok: false; error: string } {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0) {
    return { ok: false, error: 'Enter a whole-rupee amount (a minus sign gives money back).' };
  }
  if (amount < 0) {
    if (method !== REFUND_METHOD && validatePayMethod(method)) return { ok: false, error: 'Choose how the money was returned.' };
    if (method !== REFUND_METHOD && note.trim().length < 3) return { ok: false, error: 'Write a short reason for the refund.' };
    if (-amount > booking.paid) {
      return { ok: false, error: booking.paid > 0 ? `Only ${formatINR(booking.paid)} has been paid, so that is the most you can refund.` : 'Nothing has been paid on this booking.' };
    }
    return { ok: true, paid: booking.paid + amount };
  }
  if (booking.stage === 'cancelled') return { ok: false, error: 'This booking is cancelled, so there is nothing to collect.' };
  const m = validatePayMethod(method);
  if (m) return { ok: false, error: m };
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
