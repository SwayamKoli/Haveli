/**
 * Checks on what staff type: a booking, a payment method, a new room. Returns messages, never throws.
 */
import { ID_TYPES, MAX_STAY_NIGHTS, MOBILE_RE, PAY_METHODS, SOURCES } from '../constants';
import { diffDays, isISODate } from '../dates';
import type { Booking, BookingFields, FieldErrors, NewRoomInput, Room } from '../types';
import { formatEta, formatINR } from './format';
import { findClash } from './rooms';

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
