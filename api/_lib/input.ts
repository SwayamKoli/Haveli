/**
 * Turns an untrusted JSON body into the typed inputs the rules expect.
 * Anything that is the wrong type becomes an empty value, which the
 * validation then reports in plain words.
 */
import { STAGES } from '../../shared/constants';
import type { NewBookingInput, NewRoomInput, RoomManual, Stage } from '../../shared/types';
import { HttpError } from './http';

type Body = Record<string, unknown>;

function text(b: Body, key: string, max: number): string {
  const v = b[key];
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function whole(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  return typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
}

export function parseNewBooking(b: Body): NewBookingInput {
  return {
    name: text(b, 'name', 120),
    mobile: text(b, 'mobile', 20),
    source: text(b, 'source', 40),
    ci: text(b, 'ci', 10),
    co: text(b, 'co', 10),
    room: whole(b.room, NaN),
    advance: whole(b.advance, 0),
    people: whole(b.people, 1),
    eta: text(b, 'eta', 5),
    email: text(b, 'email', 120),
    city: text(b, 'city', 100),
    idType: text(b, 'idType', 40),
    idLast4: text(b, 'idLast4', 8),
    notes: text(b, 'notes', 400),
  };
}

export function parseNewRoom(b: Body): NewRoomInput {
  return { no: whole(b.no, NaN), floor: whole(b.floor, NaN), type: text(b, 'type', 40) };
}

export function parseStageInput(b: Body): { id: string; to: Stage; restore?: RoomManual } {
  const id = text(b, 'id', 40);
  const to = b.to as Stage;
  if (!id || !STAGES.includes(to)) throw new HttpError(400, 'Choose a booking and a stage.');
  const r = b.restore;
  const restore = r === 'available' || r === 'cleaning' || r === 'maintenance' ? r : undefined;
  return { id, to, restore };
}

export function parseRoomStatus(b: Body): { no: number; status: RoomManual } {
  const no = whole(b.no, NaN);
  const s = b.status;
  if (!Number.isInteger(no) || !(s === 'available' || s === 'cleaning' || s === 'maintenance')) {
    throw new HttpError(400, 'Choose a room and a status.');
  }
  return { no, status: s };
}

export function parsePayment(b: Body): { id: string; amount: number } {
  const id = text(b, 'id', 40);
  const amount = whole(b.amount, NaN);
  if (!id) throw new HttpError(400, 'Choose a booking.');
  return { id, amount };
}
