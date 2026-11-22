/**
 * Which guest is in a room, what state a room is in, and whether two stays clash.
 */
import type { Booking, Room, RoomState } from '../types';

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
