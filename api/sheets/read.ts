/**
 * Reads the whole sheet and turns its rows into rooms, guests, bookings, payments and staff. Rows it cannot read become warnings.
 */
import { TYPE_DEFAULTS } from '../../shared/constants';
import { diffDays, stampInZone, todayInZone } from '../../shared/dates';
import { formatEta, money, normalizeMobile, parseEtaMinutes, parseRoomList } from '../../shared/rules';
import type {
  Booking,
  DataBundle,
  Guest,
  Payment,
  Room,
  RoomManual,
  StaffMember,
  Stage,
} from '../../shared/types';
import { getConfig, type Config } from '../lib/env';
import { HttpError } from '../lib/http';
import { readBackground } from '../media/media';
import {
  cell,
  dateCell,
  gaps,
  isBlank,
  num,
  readSheets,
  stampCell,
  str,
  type Sheet,
  type Sheets,
} from './access';
import type { BookingKey, GuestKey, PaymentKey, RoomKey, StaffKey } from './schema';

export type RoomRec = Room & { row: number };

export type GuestRec = Guest & { row: number };

type BookingRec = Booking & { row: number };

function parseManual(s: string): RoomManual | null {
  const t = s.toLowerCase();
  if (t === '' || t === 'available' || t === 'occupied') return 'available';
  if (t === 'cleaning' || t === 'maintenance') return t;
  return null;
}

function parseStage(s: string): Stage | null {
  const t = s.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  if (t === 'reserved') return 'reserved';
  if (t === 'checked in') return 'in';
  if (t === 'checked out') return 'out';
  if (t === 'cancelled' || t === 'canceled') return 'cancelled';
  return null;
}

export function parseRooms(s: Sheet<RoomKey>, warn: string[]): RoomRec[] {
  const out: RoomRec[] = [];
  const seen = new Set<number>();
  s.rows.forEach((r, i) => {
    const row = i + 2;
    if (isBlank(r)) return;
    const no = num(cell(r, s.idx.no));
    if (no === null || !Number.isInteger(no) || no <= 0) {
      warn.push(`Rooms row ${row}: the room number is missing or not a whole number.`);
      return;
    }
    if (seen.has(no)) {
      warn.push(`Rooms row ${row}: room ${no} is listed twice, so this row is ignored.`);
      return;
    }
    const type = str(cell(r, s.idx.type));
    if (!type) {
      warn.push(`Rooms row ${row}: room ${no} has no type.`);
      return;
    }
    const manual = parseManual(str(cell(r, s.idx.manual)));
    if (manual === null) warn.push(`Rooms row ${row}: status "${str(cell(r, s.idx.manual))}" is not Available, Cleaning or Maintenance. Treated as Available.`);
    const def = TYPE_DEFAULTS[type];
    seen.add(no);
    out.push({
      row,
      id: str(cell(r, s.idx.id)),
      no,
      floor: num(cell(r, s.idx.floor)) ?? Math.floor(no / 100),
      type,
      bed: str(cell(r, s.idx.bed)) || def?.bed || '',
      cap: num(cell(r, s.idx.cap)) ?? def?.cap ?? 2,
      price: num(cell(r, s.idx.price)) ?? def?.price ?? 0,
      manual: manual ?? 'available',
      notes: str(cell(r, s.idx.notes)),
    });
  });
  return out;
}

export function parseGuests(s: Sheet<GuestKey>, warn: string[]): GuestRec[] {
  const out: GuestRec[] = [];
  s.rows.forEach((r, i) => {
    const row = i + 2;
    if (isBlank(r)) return;
    const id = str(cell(r, s.idx.id));
    const name = str(cell(r, s.idx.name));
    if (!id || !name) {
      warn.push(`Guests row ${row}: needs both a Guest ID and a Name.`);
      return;
    }
    out.push({
      row,
      id,
      name,
      mobile: normalizeMobile(str(cell(r, s.idx.mobile))),
      email: str(cell(r, s.idx.email)),
      idType: str(cell(r, s.idx.idType)),
      idLast4: str(cell(r, s.idx.idLast4)),
      city: str(cell(r, s.idx.city)),
      createdAt: stampCell(cell(r, s.idx.created)),
    });
  });
  return out;
}

export function parseBookings(s: Sheet<BookingKey>, rooms: RoomRec[], guests: GuestRec[], warn: string[]): BookingRec[] {
  const out: BookingRec[] = [];
  const mobiles = new Map(guests.map((g) => [g.id, g.mobile]));
  const seen = new Set<string>();
  s.rows.forEach((r, i) => {
    const row = i + 2;
    if (isBlank(r)) return;
    const id = str(cell(r, s.idx.id));
    if (!id) {
      warn.push(`Bookings row ${row}: there is no Booking ID.`);
      return;
    }
    if (seen.has(id)) {
      warn.push(`Bookings row ${row}: ${id} appears twice, so this row is ignored.`);
      return;
    }
    const roomNos = parseRoomList(cell(r, s.idx.room));
    const ci = dateCell(cell(r, s.idx.ci));
    const co = dateCell(cell(r, s.idx.co));
    const stage = parseStage(str(cell(r, s.idx.stage)));
    if (!roomNos.length) return void warn.push(`Bookings row ${row} (${id}): the room number is missing.`);
    if (!ci || !co) return void warn.push(`Bookings row ${row} (${id}): check-in or check-out is not a date the app can read.`);
    if (diffDays(ci, co) < 0) return void warn.push(`Bookings row ${row} (${id}): check-out is before check-in.`);
    if (!stage) return void warn.push(`Bookings row ${row} (${id}): stage "${str(cell(r, s.idx.stage))}" is not Reserved, Checked in, Checked out or Cancelled.`);

    const nights = diffDays(ci, co);
    const roomRate = roomNos.reduce((sum, n) => sum + (rooms.find((x) => x.no === n)?.price ?? 0), 0);
    const price = num(cell(r, s.idx.price)) ?? roomRate;
    const paid = num(cell(r, s.idx.paid)) ?? 0;
    const discount = Math.max(0, Math.round(num(cell(r, s.idx.discount)) ?? 0));
    const { gross, total, balance } = money(price, nights, paid, discount);
    const guestId = str(cell(r, s.idx.guestId));
    const etaRaw = cell(r, s.idx.eta);
    const etaMin = parseEtaMinutes(etaRaw);
    seen.add(id);
    out.push({
      row,
      id,
      guestId,
      guest: str(cell(r, s.idx.guest)) || 'Guest',
      mobile: mobiles.get(guestId) ?? '',
      rooms: roomNos,
      ci,
      co,
      nights,
      price,
      discount: Math.min(discount, gross),
      gross,
      total,
      paid,
      balance,
      source: str(cell(r, s.idx.source)) || 'Direct',
      stage,
      people: Math.max(1, Math.round(num(cell(r, s.idx.people)) ?? 1)),
      eta: typeof etaRaw === 'number' && etaMin !== null ? formatEta(`${Math.floor(etaMin / 60)}:${String(etaMin % 60).padStart(2, '0')}`) : str(etaRaw),
      etaMin,
      notes: str(cell(r, s.idx.notes)),
      createdBy: str(cell(r, s.idx.createdBy)),
      updatedBy: str(cell(r, s.idx.updatedBy)),
      createdAt: stampCell(cell(r, s.idx.created)),
      updatedAt: stampCell(cell(r, s.idx.updated)),
    });
  });
  return out;
}

function parsePayments(s: Sheet<PaymentKey>, bookings: BookingRec[], warn: string[]): Payment[] {
  const out: Payment[] = [];
  const known = new Set(bookings.map((b) => b.id));
  s.rows.forEach((r, i) => {
    if (isBlank(r)) return;
    const row = i + 2;
    const amount = num(cell(r, s.idx.amount));
    const at = stampCell(cell(r, s.idx.at));
    const bookingId = str(cell(r, s.idx.booking));
    if (amount === null || !/^\d{4}-\d{2}-\d{2}/.test(at)) {
      warn.push(`Payments row ${row}: the amount or date could not be read.`);
      return;
    }
    if (!known.has(bookingId)) return; // payment for a booking that is not in the sheet any more
    out.push({ id: str(cell(r, s.idx.id)), bookingId, at, amount, method: str(cell(r, s.idx.method)) || 'Cash', by: str(cell(r, s.idx.by)), note: str(cell(r, s.idx.note)) });
  });
  return out;
}

export interface StaffRec extends StaffMember {
  row: number;
  hash: string;
}

export function parseStaff(s: Sheet<StaffKey>): StaffRec[] {
  const out: StaffRec[] = [];
  const seen = new Set<string>();
  s.rows.forEach((r, i) => {
    const username = str(cell(r, s.idx.username)).toLowerCase();
    if (!username || seen.has(username)) return;
    seen.add(username);
    const active = !/^(no|false|0|n|inactive|off)$/i.test(str(cell(r, s.idx.active)));
    out.push({
      row: i + 2,
      username,
      name: str(cell(r, s.idx.name)) || username,
      role: str(cell(r, s.idx.role)) || 'Reception',
      hash: str(cell(r, s.idx.hash)),
      active,
      createdAt: stampCell(cell(r, s.idx.created)),
    });
  });
  return out;
}

export interface Loaded {
  cfg: Config;
  sheets: Sheets;
  rooms: RoomRec[];
  guests: GuestRec[];
  bookings: BookingRec[];
  payments: Payment[];
  warnings: string[];
  gaps: string[];
  today: string;
  stamp: string;
}

export async function loadAll(): Promise<Loaded> {
  const cfg = getConfig();
  const sheets = await readSheets();
  for (const s of [sheets.rooms, sheets.guests, sheets.bookings]) {
    if (s.missing.length) {
      throw new HttpError(502, `The ${s.tab} tab is missing these columns in row 1: ${s.missing.join(', ')}.`);
    }
  }
  const warnings: string[] = [];
  const rooms = parseRooms(sheets.rooms, warnings);
  const guests = parseGuests(sheets.guests, warnings);
  const bookings = parseBookings(sheets.bookings, rooms, guests, warnings);
  const payments = sheets.payments.present && !sheets.payments.missing.length ? parsePayments(sheets.payments, bookings, warnings) : [];
  const now = new Date();
  return { cfg, sheets, rooms, guests, bookings, payments, warnings, gaps: gaps(sheets), today: todayInZone(cfg.timeZone, now), stamp: stampInZone(cfg.timeZone, now) };
}

/** Saving needs the newer tabs and columns (discount, who did it, payments). */
export function assertReady(L: Loaded): void {
  if (L.gaps.length) {
    throw new HttpError(409, 'The sheet needs a quick one-time setup before this can be saved. Ask the owner to open Settings and press "Set up sheet".', undefined, 'SETUP');
  }
}

export function pub<T extends { row: number }>(rec: T): Omit<T, 'row'> {
  const { row: _row, ...rest } = rec;
  return rest;
}

export async function loadBundle(): Promise<DataBundle> {
  const L = await loadAll();
  return {
    rooms: L.rooms.map(pub),
    guests: L.guests.map(pub),
    bookings: L.bookings.map(pub),
    payments: L.payments,
    today: L.today,
    warnings: L.warnings,
    setupNeeded: L.gaps.length > 0,
    mode: 'live',
    background: readBackground(),
  };
}
