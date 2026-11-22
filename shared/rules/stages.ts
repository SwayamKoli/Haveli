/**
 * Moving a booking between stages (reserved, checked in, checked out, cancelled), moving rooms, and recording payments.
 */
import { REFUND_METHOD, STAGE_LABEL } from '../constants';
import type { Booking, Room, RoomManual, Stage } from '../types';
import { formatINR } from './format';
import { findClash, roomState } from './rooms';
import { validatePayMethod } from './validation';

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
