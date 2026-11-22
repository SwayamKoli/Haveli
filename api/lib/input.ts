/**
 * Turns an untrusted JSON body into the typed inputs the rules expect.
 * Anything that is the wrong type becomes an empty value, which the
 * validation then reports in plain words.
 */
import { STAGES } from '../../shared/constants';
import type {
  BookingFields,
  EditBookingInput,
  NewBookingInput,
  NewRoomInput,
  RoomManual,
  RoomsGenerateInput,
  StaffSaveInput,
  Stage,
} from '../../shared/types';
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

function roomList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const list = v.slice(0, 20).map((x) => whole(x, NaN));
  // Never quietly drop a room the form sent: that would book fewer rooms than asked for.
  if (list.some((n) => !Number.isInteger(n))) {
    throw new HttpError(422, 'Please fix the highlighted fields.', { room: 'Choose valid rooms.' });
  }
  return list;
}

function bookingFields(b: Body): BookingFields {
  return {
    name: text(b, 'name', 120),
    mobile: text(b, 'mobile', 20),
    source: text(b, 'source', 40),
    ci: text(b, 'ci', 10),
    co: text(b, 'co', 10),
    rooms: roomList(b.rooms),
    discount: whole(b.discount, 0),
    people: whole(b.people, 1),
    eta: text(b, 'eta', 5),
    email: text(b, 'email', 120),
    city: text(b, 'city', 100),
    idType: text(b, 'idType', 40),
    idLast4: text(b, 'idLast4', 8),
    notes: text(b, 'notes', 400),
  };
}

export function parseNewBooking(b: Body): NewBookingInput {
  return { ...bookingFields(b), advance: whole(b.advance, 0), method: text(b, 'method', 20) || 'Cash' };
}

export function parseEditBooking(b: Body): EditBookingInput {
  const id = text(b, 'id', 40);
  if (!id) throw new HttpError(400, 'Choose a booking.');
  return { ...bookingFields(b), id };
}

export function parseNewRoom(b: Body): NewRoomInput {
  return { no: whole(b.no, NaN), floor: whole(b.floor, NaN), type: text(b, 'type', 40) };
}

export function parseStageInput(b: Body): { id: string; to: Stage; restore?: Record<number, RoomManual> } {
  const id = text(b, 'id', 40);
  const to = b.to as Stage;
  if (!id || !STAGES.includes(to)) throw new HttpError(400, 'Choose a booking and a stage.');
  let restore: Record<number, RoomManual> | undefined;
  if (b.restore && typeof b.restore === 'object' && !Array.isArray(b.restore)) {
    restore = {};
    for (const [no, v] of Object.entries(b.restore as Body)) {
      if (Number.isInteger(Number(no)) && (v === 'available' || v === 'cleaning' || v === 'maintenance')) restore[Number(no)] = v;
    }
  }
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

export function parsePayment(b: Body): { id: string; amount: number; method: string; note: string } {
  const id = text(b, 'id', 40);
  const amount = whole(b.amount, NaN);
  if (!id) throw new HttpError(400, 'Choose a booking.');
  return { id, amount, method: text(b, 'method', 20) || 'Cash', note: text(b, 'note', 120) };
}

export function parseRoomsGenerate(b: Body): RoomsGenerateInput {
  return { floors: whole(b.floors, NaN), perFloor: whole(b.perFloor, NaN), rate: whole(b.rate, NaN), type: text(b, 'type', 40) || 'Standard' };
}

export function parseStaffSave(b: Body): StaffSaveInput {
  return {
    username: text(b, 'username', 40),
    name: text(b, 'name', 80),
    role: text(b, 'role', 30),
    active: b.active !== false,
    password: typeof b.password === 'string' ? b.password.slice(0, 100) : '',
  };
}
