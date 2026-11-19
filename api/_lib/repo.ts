/**
 * Reads and writes the Google Sheet. Every change follows the same pattern:
 *   1. read the sheet fresh,
 *   2. check the business rules (shared/rules.ts),
 *   3. write only the cells that change.
 * Nothing is cached between requests, so edits made by hand in the sheet are
 * always picked up.
 */
import { readBackground } from './media';
import { FACTS_FIELDS, factsFrom, styleRequests } from './sheetStyle';
import { getAccessToken, sheetsRequest } from './google';
import { configProblems, getConfig } from './env';
import type { Config } from './env';
import { HttpError } from './http';
import { fingerprint, hashPassword, verifyPassword, dummyHash } from './password';
import {
  BOOKINGS_TAB,
  BOOKING_COLS,
  GUESTS_TAB,
  GUEST_COLS,
  PAYMENTS_TAB,
  PAYMENT_COLS,
  ROOMS_TAB,
  ROOM_COLS,
  STAFF_TAB,
  STAFF_COLS,
  TAB_SPECS,
  colLetter,
  mapHeaders,
  normHeader,
} from './schema';
import type { BookingKey, ColSpec, GuestKey, HeaderMap, PaymentKey, RoomKey, StaffKey } from './schema';
import { MANUAL_LABEL, STAFF_ROLES, STAGE_LABEL, TYPE_DEFAULTS } from '../../shared/constants';
import { diffDays, looseDateToISO, serialToISO, serialToStamp, stampInZone, todayInZone } from '../../shared/dates';
import {
  formatEta,
  money,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  parseRoomList,
  planPayment,
  planRoomMove,
  planRoomStatus,
  planStage,
  sameRooms,
  validateBooking,
  validateNewRoom,
  validatePayMethod,
} from '../../shared/rules';
import type {
  Booking,
  DataBundle,
  EditBookingInput,
  Guest,
  HealthCheck,
  HealthReport,
  NewBookingInput,
  NewRoomInput,
  Payment,
  Room,
  RoomManual,
  Stage,
  StaffMember,
  StaffSaveInput,
  RoomsGenerateInput,
} from '../../shared/types';

/* ---------- raw sheet access ---------- */

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

interface Sheet<K extends string> extends HeaderMap<K> {
  tab: string;
  /** False when the tab does not exist in the spreadsheet yet. */
  present: boolean;
  /** Number of columns to write when appending a row. */
  width: number;
  /** Data rows, without the header. Sheet row number = index + 2. */
  rows: Row[];
}

function makeSheet<K extends string>(tab: string, values: Row[] | undefined, specs: ColSpec<K>[], present = true): Sheet<K> {
  const all = values ?? [];
  const header = all[0] ?? [];
  const map = mapHeaders<K>(header, specs);
  const width = Math.max(header.length, ...Object.values<number>(map.idx).map((i) => i + 1), 1);
  return { tab, present, ...map, width, rows: all.slice(1) };
}

const ALL_TABS = TAB_SPECS.map((t) => t.tab);

async function fetchRanges(tabs: string[]): Promise<Map<string, Row[]>> {
  const q = tabs.map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
  const r = await sheetsRequest<{ valueRanges?: { values?: Row[] }[] }>(
    'GET',
    `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  const out = new Map<string, Row[]>();
  tabs.forEach((t, i) => out.set(t, r.valueRanges?.[i]?.values ?? []));
  return out;
}

async function listTabs(): Promise<string[]> {
  const meta = await sheetsRequest<{ sheets?: { properties?: { title?: string } }[] }>('GET', '?fields=sheets.properties.title');
  return (meta.sheets ?? []).map((x) => x.properties?.title ?? '');
}

/** Reads every tab the app uses. Payments and Staff may be missing (the owner adds them with "Set up sheet"). */
async function readSheets() {
  let present = ALL_TABS;
  let data: Map<string, Row[]>;
  try {
    data = await fetchRanges(ALL_TABS);
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'NO_TAB') throw e;
    const tabs = await listTabs();
    const lacking = TAB_SPECS.find((t) => t.core && !tabs.includes(t.tab));
    if (lacking) throw new HttpError(502, `The sheet has no tab called "${lacking.tab}". Tabs must be named Rooms, Guests and Bookings.`);
    present = ALL_TABS.filter((t) => tabs.includes(t));
    data = await fetchRanges(present);
  }
  const get = (t: string) => data.get(t);
  return {
    rooms: makeSheet<RoomKey>(ROOMS_TAB, get(ROOMS_TAB), ROOM_COLS),
    guests: makeSheet<GuestKey>(GUESTS_TAB, get(GUESTS_TAB), GUEST_COLS),
    bookings: makeSheet<BookingKey>(BOOKINGS_TAB, get(BOOKINGS_TAB), BOOKING_COLS),
    payments: makeSheet<PaymentKey>(PAYMENTS_TAB, get(PAYMENTS_TAB), PAYMENT_COLS, present.includes(PAYMENTS_TAB)),
    staff: makeSheet<StaffKey>(STAFF_TAB, get(STAFF_TAB), STAFF_COLS, present.includes(STAFF_TAB)),
  };
}

type Sheets = Awaited<ReturnType<typeof readSheets>>;

/** Tabs or columns the app wants that the sheet does not have yet. */
function gaps(sheets: Sheets): string[] {
  const out: string[] = [];
  const check = <K extends string>(s: Sheet<K>, specs: ColSpec<K>[]) => {
    if (!s.present) out.push(`tab ${s.tab}`);
    else {
      const m = specs.filter((c) => s.idx[c.key] < 0).map((c) => c.names[0]);
      if (m.length) out.push(`${s.tab}: ${m.join(', ')}`);
    }
  };
  check(sheets.rooms, ROOM_COLS);
  check(sheets.guests, GUEST_COLS);
  check(sheets.bookings, BOOKING_COLS);
  check(sheets.payments, PAYMENT_COLS);
  check(sheets.staff, STAFF_COLS);
  return out;
}

const cell = (r: Row, i: number): Cell => (i >= 0 ? r[i] : undefined);
/** Every ID in a tab's ID column, including rows the app could not read, so a new ID never reuses one. */
const rawIds = <K extends string>(s: Sheet<K>, key: K): string[] => s.rows.map((r) => str(cell(r, s.idx[key])));
const isBlank = (r: Row) => r.every((c) => c === '' || c === null || c === undefined);

function str(v: Cell): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[₹,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function dateCell(v: Cell): string | null {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToISO(v) : null;
  if (typeof v === 'string') return looseDateToISO(v);
  return null;
}

function stampCell(v: Cell): string {
  return typeof v === 'number' ? serialToStamp(v) : str(v);
}

/**
 * Text typed into a cell by a guest or staff member must never be read as a
 * formula, so a leading apostrophe forces Sheets to keep it as plain text.
 */
const txt = (s: string): string => (s === '' ? '' : `'${s}`);

/* ---------- reading entities ---------- */

type RoomRec = Room & { row: number };
type GuestRec = Guest & { row: number };
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

function parseRooms(s: Sheet<RoomKey>, warn: string[]): RoomRec[] {
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

function parseGuests(s: Sheet<GuestKey>, warn: string[]): GuestRec[] {
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

function parseBookings(s: Sheet<BookingKey>, rooms: RoomRec[], guests: GuestRec[], warn: string[]): BookingRec[] {
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

interface StaffRec extends StaffMember {
  row: number;
  hash: string;
}

function parseStaff(s: Sheet<StaffKey>): StaffRec[] {
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

interface Loaded {
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

async function loadAll(): Promise<Loaded> {
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
function assertReady(L: Loaded): void {
  if (L.gaps.length) {
    throw new HttpError(409, 'The sheet needs a quick one-time setup before this can be saved. Ask the owner to open Settings and press "Set up sheet".', undefined, 'SETUP');
  }
}

function pub<T extends { row: number }>(rec: T): Omit<T, 'row'> {
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

/* ---------- writing ---------- */

function buildRow<K extends string>(s: Sheet<K>, vals: Partial<Record<K, Cell>>): Row {
  const row: Row = new Array<Cell>(s.width).fill('');
  for (const key of Object.keys(vals) as K[]) {
    const i = s.idx[key];
    if (i >= 0) row[i] = vals[key];
  }
  return row;
}

interface CellWrite {
  range: string;
  values: Cell[][];
}

function cellUpdates<K extends string>(s: Sheet<K>, rowNo: number, vals: Partial<Record<K, Cell>>): CellWrite[] {
  const out: CellWrite[] = [];
  for (const key of Object.keys(vals) as K[]) {
    const i = s.idx[key];
    if (i >= 0) out.push({ range: `${s.tab}!${colLetter(i)}${rowNo}`, values: [[vals[key]]] });
  }
  return out;
}

async function writeCells(data: CellWrite[]): Promise<void> {
  if (!data.length) return;
  await sheetsRequest('POST', '/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data });
}

/** Adds a row at the bottom of the tab and returns its row number. */
async function appendRow<K extends string>(s: Sheet<K>, values: Row): Promise<number> {
  const r = await sheetsRequest<{ updates?: { updatedRange?: string } }>(
    'POST',
    `/values/${encodeURIComponent(`${s.tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: [values] },
  );
  const m = /!\$?[A-Z]+\$?(\d+)/.exec(r.updates?.updatedRange ?? '');
  if (!m) throw new HttpError(502, 'Google saved the row but did not say where. Refresh to check.');
  return Number(m[1]);
}

/** Adds several rows at the bottom of the tab in one call. */
async function appendRows<K extends string>(s: Sheet<K>, values: Row[]): Promise<void> {
  if (!values.length) return;
  await sheetsRequest('POST', `/values/${encodeURIComponent(`${s.tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values });
}

/** Nights / Total / Balance stay live formulas so they also work when someone edits the sheet by hand. */
function bookingFormulas(s: Sheet<BookingKey>, row: number): CellWrite[] {
  const at = (k: BookingKey) => (s.idx[k] >= 0 ? `${colLetter(s.idx[k])}${row}` : null);
  const ci = at('ci');
  const co = at('co');
  const nights = at('nights');
  const price = at('price');
  const discount = at('discount');
  const total = at('total');
  const paid = at('paid');
  const balance = at('balance');
  const out: CellWrite[] = [];
  const put = (cellRef: string | null, formula: string) => {
    if (cellRef) out.push({ range: `${s.tab}!${cellRef}`, values: [[formula]] });
  };
  if (ci && co) put(nights, `=IF(AND(ISNUMBER(${ci}),ISNUMBER(${co})),${co}-${ci},"")`);
  const nightsExpr = nights ?? (ci && co ? `(${co}-${ci})` : null);
  if (price && nightsExpr) {
    const off = discount ? `-N(${discount})` : '';
    put(total, `=IF(ISNUMBER(${nightsExpr}),MAX(0,${nightsExpr}*${price}${off}),"")`);
  }
  if (total && paid) put(balance, `=IF(ISNUMBER(${total}),${total}-N(${paid}),"")`);
  return out;
}

/** One room goes in as a number, several as text like "101, 102". */
const roomCell = (nos: number[]): Cell => (nos.length === 1 ? nos[0] : txt(nos.join(', ')));

/* ---------- actions ---------- */

/** Finds or creates the guest for a booking and returns their ID. Fills in details the sheet does not have yet. */
async function resolveGuest(
  L: Loaded,
  f: { name: string; mobile: string; email: string; city: string; idType: string; idLast4: string },
): Promise<{ guest: Guest; created: boolean }> {
  const gs = L.sheets.guests;
  const found = L.guests.find((g) => normalizeMobile(g.mobile) === f.mobile);
  if (!found) {
    const id = nextId('GS', rawIds(gs, 'id'));
    const guest: Guest = { id, name: f.name, mobile: f.mobile, email: f.email, idType: f.idType, idLast4: f.idLast4, city: f.city, createdAt: L.stamp };
    await appendRow(
      gs,
      buildRow(gs, { id, name: txt(f.name), mobile: txt(f.mobile), email: txt(f.email), idType: f.idType, idLast4: txt(f.idLast4), city: txt(f.city), created: txt(L.stamp) }),
    );
    L.guests.push({ ...guest, row: gs.rows.length + 2 });
    gs.rows.push([]);
    return { guest, created: true };
  }
  const fill: Partial<Record<GuestKey, Cell>> = {};
  if (!found.email && f.email) fill.email = txt(f.email);
  if (!found.city && f.city) fill.city = txt(f.city);
  if (!found.idType && f.idType) fill.idType = f.idType;
  if (!found.idLast4 && f.idLast4) fill.idLast4 = txt(f.idLast4);
  if (Object.keys(fill).length) await writeCells(cellUpdates(gs, found.row, fill));
  return {
    guest: { ...pub(found), email: found.email || f.email, city: found.city || f.city, idType: found.idType || f.idType, idLast4: found.idLast4 || f.idLast4 },
    created: false,
  };
}

const roomsOf = (L: Loaded, nos: number[]): RoomRec[] => nos.map((n) => L.rooms.find((r) => r.no === n)).filter((r): r is RoomRec => !!r);

function roomWrites(L: Loaded, changes: { no: number; manual: RoomManual }[]): { writes: CellWrite[]; rooms: Room[] } {
  const writes: CellWrite[] = [];
  const rooms: Room[] = [];
  for (const c of changes) {
    const room = L.rooms.find((r) => r.no === c.no);
    if (!room) continue;
    writes.push(...cellUpdates(L.sheets.rooms, room.row, { manual: MANUAL_LABEL[c.manual], updated: txt(L.stamp) }));
    rooms.push({ ...pub(room), manual: c.manual });
  }
  return { writes, rooms };
}

async function logPayment(L: Loaded, p: { bookingId: string; amount: number; method: string; by: string; note: string }): Promise<Payment> {
  const ps = L.sheets.payments;
  const id = nextId('PY', rawIds(ps, 'id'));
  await appendRow(ps, buildRow(ps, { id, booking: p.bookingId, at: txt(L.stamp), amount: p.amount, method: p.method, by: txt(p.by), note: txt(p.note) }));
  const pay: Payment = { id, bookingId: p.bookingId, at: L.stamp, amount: p.amount, method: p.method, by: p.by, note: p.note };
  L.payments.push(pay);
  ps.rows.push([id]);
  return pay;
}

async function createBookingNow(input: NewBookingInput, by: string) {
  const L = await loadAll();
  assertReady(L);
  const advance = Math.round(Number(input.advance) || 0);
  const errors = validateBooking(input, { rooms: L.rooms, bookings: L.bookings, today: L.today }, advance);
  const m = advance > 0 ? validatePayMethod(input.method) : null;
  if (m) errors.method = m;
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);

  const rooms = roomsOf(L, input.rooms);
  const price = rooms.reduce((sum, r) => sum + r.price, 0);
  const name = input.name.trim();
  const mobile = normalizeMobile(input.mobile);
  const { guest, created: guestCreated } = await resolveGuest(L, {
    name,
    mobile,
    email: input.email.trim(),
    city: input.city.trim(),
    idType: input.idType,
    idLast4: input.idLast4.trim(),
  });

  const bs = L.sheets.bookings;
  const id = nextId('BK', rawIds(bs, 'id'));
  const nights = diffDays(input.ci, input.co);
  const discount = Math.round(Number(input.discount) || 0);
  const eta = formatEta(input.eta);
  const row = await appendRow(
    bs,
    buildRow(bs, {
      id,
      guestId: guest.id,
      guest: txt(name),
      room: roomCell(input.rooms),
      ci: input.ci,
      co: input.co,
      price,
      discount,
      paid: advance,
      source: input.source,
      stage: STAGE_LABEL.reserved,
      people: input.people,
      eta: txt(eta),
      notes: txt(input.notes.trim()),
      createdBy: txt(by),
      updatedBy: txt(by),
      created: txt(L.stamp),
      updated: txt(L.stamp),
    }),
  );
  await writeCells(bookingFormulas(bs, row));
  const payment = advance > 0 ? await logPayment(L, { bookingId: id, amount: advance, method: input.method, by, note: 'Advance at booking' }) : null;

  const { gross, total, balance } = money(price, nights, advance, discount);
  const booking: Booking = {
    id,
    guestId: guest.id,
    guest: name,
    mobile,
    rooms: [...input.rooms],
    ci: input.ci,
    co: input.co,
    nights,
    price,
    discount,
    gross,
    total,
    paid: advance,
    balance,
    source: input.source,
    stage: 'reserved',
    people: input.people,
    eta,
    etaMin: parseEtaMinutes(eta),
    notes: input.notes.trim(),
    createdBy: by,
    updatedBy: by,
    createdAt: L.stamp,
    updatedAt: L.stamp,
  };
  return { booking, guest, guestCreated, payment };
}

async function updateBookingNow(input: EditBookingInput, by: string) {
  const L = await loadAll();
  assertReady(L);
  const b = L.bookings.find((x) => x.id === input.id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  if (b.stage === 'cancelled') throw new HttpError(409, 'This booking is cancelled. Move it back to Reserved before editing it.');

  if (b.stage === 'out' && (input.ci !== b.ci || input.co !== b.co || !sameRooms(b.rooms, input.rooms))) {
    throw new HttpError(409, 'The dates and rooms of a stay that has finished cannot be changed. You can still fix the guest details, notes, source and discount.');
  }
  const errors = validateBooking(input, { rooms: L.rooms, bookings: L.bookings, today: L.today }, b.paid, b);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);
  const move = planRoomMove(b, input.rooms, L.rooms, L.bookings);
  if (!move.ok) throw new HttpError(409, move.error);

  const rooms = roomsOf(L, input.rooms);
  const price = sameRooms(b.rooms, input.rooms) ? b.price : rooms.reduce((sum, r) => sum + r.price, 0);
  const name = input.name.trim();
  const mobile = normalizeMobile(input.mobile);
  const email = input.email.trim();
  const city = input.city.trim();
  const idLast4 = input.idLast4.trim();
  const gs = L.sheets.guests;

  // The guest: fix their details if the mobile is unchanged, otherwise move the booking to the right guest.
  const cur = L.guests.find((g) => g.id === b.guestId);
  let guestId = b.guestId;
  let guestOut: Guest | undefined;
  const detail = (g: GuestRec): Partial<Record<GuestKey, Cell>> => {
    const w: Partial<Record<GuestKey, Cell>> = {};
    if (g.name !== name) w.name = txt(name);
    if (g.email !== email) w.email = txt(email);
    if (g.city !== city) w.city = txt(city);
    if (g.idType !== input.idType) w.idType = input.idType;
    if (g.idLast4 !== idLast4) w.idLast4 = txt(idLast4);
    return w;
  };
  if (cur && normalizeMobile(cur.mobile) === mobile) {
    const w = detail(cur);
    if (Object.keys(w).length) await writeCells(cellUpdates(gs, cur.row, w));
    guestOut = { ...pub(cur), name, email, city, idType: input.idType, idLast4 };
  } else {
    const other = L.guests.find((g) => normalizeMobile(g.mobile) === mobile);
    const usedElsewhere = cur ? L.bookings.some((x) => x.id !== b.id && x.guestId === cur.id) : true;
    if (other) {
      guestId = other.id;
      const fill: Partial<Record<GuestKey, Cell>> = {};
      if (!other.email && email) fill.email = txt(email);
      if (!other.city && city) fill.city = txt(city);
      if (!other.idType && input.idType) fill.idType = input.idType;
      if (!other.idLast4 && idLast4) fill.idLast4 = txt(idLast4);
      if (Object.keys(fill).length) await writeCells(cellUpdates(gs, other.row, fill));
      guestOut = { ...pub(other) };
    } else if (cur && !usedElsewhere) {
      await writeCells(cellUpdates(gs, cur.row, { ...detail(cur), mobile: txt(mobile) }));
      guestOut = { ...pub(cur), name, mobile, email, city, idType: input.idType, idLast4 };
    } else {
      const r = await resolveGuest(L, { name, mobile, email, city, idType: input.idType, idLast4 });
      guestId = r.guest.id;
      guestOut = r.guest;
    }
  }

  const nights = diffDays(input.ci, input.co);
  const discount = Math.round(Number(input.discount) || 0);
  const eta = formatEta(input.eta);
  const writes = cellUpdates(L.sheets.bookings, b.row, {
    guestId,
    guest: txt(name),
    room: roomCell(input.rooms),
    ci: input.ci,
    co: input.co,
    price,
    discount,
    source: input.source,
    people: input.people,
    eta: txt(eta),
    notes: txt(input.notes.trim()),
    updatedBy: txt(by),
    updated: txt(L.stamp),
  });
  const moved = roomWrites(L, move.roomChanges);
  writes.push(...moved.writes);
  await writeCells(writes);

  const { gross, total, balance } = money(price, nights, b.paid, discount);
  const booking: Booking = {
    ...pub(b),
    guestId,
    guest: name,
    mobile,
    rooms: [...input.rooms],
    ci: input.ci,
    co: input.co,
    nights,
    price,
    discount,
    gross,
    total,
    balance,
    source: input.source,
    people: input.people,
    eta,
    etaMin: parseEtaMinutes(eta),
    notes: input.notes.trim(),
    updatedBy: by,
    updatedAt: L.stamp,
  };
  return { booking, guest: guestOut, rooms: moved.rooms };
}

async function changeStageNow(id: string, to: Stage, restore: Record<number, RoomManual> | undefined, by: string) {
  const L = await loadAll();
  assertReady(L);
  const b = L.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  const plan = planStage(b, roomsOf(L, b.rooms), L.bookings, to, restore);
  if (!plan.ok) throw new HttpError(409, plan.error);

  const writes = cellUpdates(L.sheets.bookings, b.row, { stage: STAGE_LABEL[to], updatedBy: txt(by), updated: txt(L.stamp) });
  const moved = roomWrites(L, plan.roomChanges);
  writes.push(...moved.writes);
  await writeCells(writes);
  return { booking: { ...pub(b), stage: to, updatedBy: by, updatedAt: L.stamp } as Booking, rooms: moved.rooms };
}

async function changeRoomStatusNow(no: number, to: RoomManual) {
  const L = await loadAll();
  const room = L.rooms.find((r) => r.no === no);
  if (!room) throw new HttpError(404, 'That room was not found. Refresh and try again.');
  const plan = planRoomStatus(room, L.bookings, to);
  if (!plan.ok) throw new HttpError(409, plan.error);
  await writeCells(cellUpdates(L.sheets.rooms, room.row, { manual: MANUAL_LABEL[to], updated: txt(L.stamp) }));
  return { room: { ...pub(room), manual: to } as Room };
}

async function addRoomNow(input: NewRoomInput) {
  const L = await loadAll();
  const knownTypes = Array.from(new Set([...L.rooms.map((r) => r.type), ...Object.keys(TYPE_DEFAULTS)]));
  const errors = validateNewRoom(input, L.rooms, knownTypes);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);

  const sample = L.rooms.find((r) => r.type === input.type);
  const def = TYPE_DEFAULTS[input.type];
  const bed = sample?.bed ?? def?.bed ?? '';
  const cap = sample?.cap ?? def?.cap ?? 2;
  const price = sample?.price ?? def?.price ?? 0;
  const rs = L.sheets.rooms;
  const id = nextId('RM', rawIds(rs, 'id'));
  await appendRow(
    rs,
    buildRow(rs, { id, no: input.no, floor: input.floor, type: txt(input.type), bed: txt(bed), cap, price, manual: MANUAL_LABEL.available, notes: '', updated: txt(L.stamp) }),
  );
  const room: Room = { id, no: input.no, floor: input.floor, type: input.type, bed, cap, price, manual: 'available', notes: '' };
  return { room };
}

/** Owner quick start: rooms 101..1nn, 201..2nn, and so on. Rooms that already exist are left alone. */
async function generateRoomsNow(input: RoomsGenerateInput) {
  const L = await loadAll();
  assertReady(L);
  const knownTypes = Array.from(new Set([...L.rooms.map((r) => r.type), ...Object.keys(TYPE_DEFAULTS)]));
  const e: Record<string, string> = {};
  if (!Number.isInteger(input.floors) || input.floors < 1 || input.floors > 9) e.floors = 'Choose 1 to 9 floors.';
  if (!Number.isInteger(input.perFloor) || input.perFloor < 1 || input.perFloor > 30) e.perFloor = 'Choose 1 to 30 rooms per floor.';
  if (!Number.isInteger(input.rate) || input.rate < 100 || input.rate > 200000) e.rate = 'Enter a nightly rate between ₹100 and ₹2,00,000.';
  if (!knownTypes.includes(input.type)) e.type = 'Choose a room type from the list.';
  if (Object.keys(e).length) throw new HttpError(422, 'Please fix the highlighted fields.', e);

  const sample = L.rooms.find((r) => r.type === input.type);
  const def = TYPE_DEFAULTS[input.type];
  const bed = sample?.bed ?? def?.bed ?? '';
  const cap = sample?.cap ?? def?.cap ?? 2;
  const have = new Set(L.rooms.map((r) => r.no));
  const rs = L.sheets.rooms;
  const ids = rawIds(rs, 'id');
  const rooms: Room[] = [];
  const rows: Row[] = [];
  let skipped = 0;
  for (let floor = 1; floor <= input.floors; floor++) {
    for (let n = 1; n <= input.perFloor; n++) {
      const no = floor * 100 + n;
      if (have.has(no)) {
        skipped++;
        continue;
      }
      const id = nextId('RM', ids);
      ids.push(id);
      rooms.push({ id, no, floor, type: input.type, bed, cap, price: input.rate, manual: 'available', notes: '' });
      rows.push(buildRow(rs, { id, no, floor, type: txt(input.type), bed: txt(bed), cap, price: input.rate, manual: MANUAL_LABEL.available, notes: '', updated: txt(L.stamp) }));
    }
  }
  await appendRows(rs, rows);
  return { added: rooms.length, skipped, rooms };
}

async function collectPaymentNow(id: string, amount: number, method: string, note: string, by: string) {
  const L = await loadAll();
  assertReady(L);
  const b = L.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  const plan = planPayment(b, amount, method, note);
  if (!plan.ok) throw new HttpError(409, plan.error);
  const payment = await logPayment(L, { bookingId: id, amount, method, by, note });
  await writeCells(cellUpdates(L.sheets.bookings, b.row, { paid: plan.paid, updatedBy: txt(by), updated: txt(L.stamp) }));
  const { gross, total, balance } = money(b.price, b.nights, plan.paid, b.discount);
  return { booking: { ...pub(b), paid: plan.paid, gross, total, balance, updatedBy: by, updatedAt: L.stamp } as Booking, payment };
}

/* ---------- employees ---------- */

const STAFF_TTL_MS = 20_000;
let staffCache: { at: number; list: StaffRec[] } | null = null;

async function readStaff(): Promise<StaffRec[]> {
  let values: Row[] = [];
  try {
    values = (await fetchRanges([STAFF_TAB])).get(STAFF_TAB) ?? [];
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'NO_TAB') throw e;
  }
  const sheet = makeSheet<StaffKey>(STAFF_TAB, values, STAFF_COLS);
  return sheet.missing.length ? [] : parseStaff(sheet);
}

async function staffList(force = false): Promise<StaffRec[]> {
  if (!force && staffCache && Date.now() - staffCache.at < STAFF_TTL_MS) return staffCache.list;
  const list = await readStaff();
  staffCache = { at: Date.now(), list };
  return list;
}

export function forgetStaffCache(): void {
  staffCache = null;
}

/** Checks an employee's own password. Returns them, or null for a wrong username or password. */
export async function verifyEmployee(username: string, password: string): Promise<StaffMember & { fp: string } | null> {
  const rec = (await staffList(true)).find((x) => x.username === username);
  if (!rec) {
    await verifyPassword(password, await dummyHash()); // same effort as a real check
    return null;
  }
  if (!rec.active || !(await verifyPassword(password, rec.hash))) return null;
  return { ...stripStaff(rec), fp: fingerprint(rec.hash) };
}

/** For the owner signing in to an employee's account: the employee must exist and be active. */
export async function findActiveEmployee(username: string): Promise<StaffMember | null> {
  const rec = (await staffList(true)).find((x) => x.username === username);
  return rec && rec.active ? stripStaff(rec) : null;
}

/** Is this signed-in employee still allowed in (not switched off, password not changed since)? */
export async function employeeStillValid(username: string, fp: string, viaOwner: boolean): Promise<boolean> {
  const rec = (await staffList()).find((x) => x.username === username);
  if (!rec || !rec.active) return false;
  return viaOwner || fingerprint(rec.hash) === fp;
}

function stripStaff(r: StaffRec): StaffMember {
  return { username: r.username, name: r.name, role: r.role, active: r.active, createdAt: r.createdAt };
}

export async function listStaff(): Promise<StaffMember[]> {
  return (await staffList(true)).map(stripStaff);
}

async function saveStaffNow(input: StaffSaveInput, by: string): Promise<StaffMember[]> {
  const cfg = getConfig();
  const sheets = await readSheets();
  if (!sheets.staff.present || sheets.staff.missing.length) {
    throw new HttpError(409, 'The Staff tab is not set up yet. Press "Set up sheet" first.', undefined, 'SETUP');
  }
  const list = parseStaff(sheets.staff);
  const username = input.username.trim().toLowerCase();
  const existing = list.find((x) => x.username === username);
  const e: Record<string, string> = {};
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(username)) e.username = 'Use 3 to 24 letters, numbers, dots, dashes or underscores.';
  else if (username === cfg.ownerUsername) e.username = 'That username is the owner account.';
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) e.name = 'Enter the employee name.';
  if (!STAFF_ROLES.includes(input.role)) e.role = 'Choose a role.';
  const pw = input.password ?? '';
  if (!existing && !pw) e.password = 'Set a password for this employee.';
  if (pw && (pw.length < 6 || pw.length > 72)) e.password = 'Use 6 to 72 characters.';
  if (Object.keys(e).length) throw new HttpError(422, 'Please fix the highlighted fields.', e);

  const ss = sheets.staff;
  const now = stampInZone(cfg.timeZone, new Date());
  const hash = pw ? await hashPassword(pw) : '';
  if (existing) {
    const w: Partial<Record<StaffKey, Cell>> = { name: txt(name), role: input.role, active: input.active ? 'Yes' : 'No' };
    if (hash) w.hash = txt(hash);
    await writeCells(cellUpdates(ss, existing.row, w));
  } else {
    await appendRow(ss, buildRow(ss, { username: txt(username), name: txt(name), role: input.role, hash: txt(hash), active: input.active ? 'Yes' : 'No', created: txt(now) }));
  }
  void by;
  forgetStaffCache();
  return listStaff();
}

/* ---------- one-click sheet setup ---------- */

async function setupSheetNow(): Promise<{ changes: string[]; style: string }> {
  getConfig();
  const changes: string[] = [];
  const have = await listTabs();
  const add = TAB_SPECS.filter((t) => !have.includes(t.tab));
  if (add.length) {
    await sheetsRequest('POST', ':batchUpdate', {
      requests: add.map((t) => ({ addSheet: { properties: { title: t.tab, gridProperties: { frozenRowCount: 1 } } } })),
    });
    for (const t of add) changes.push(`Added the ${t.tab} tab`);
  }
  const now = await fetchRanges(TAB_SPECS.map((t) => t.tab));
  const writes: CellWrite[] = [];
  for (const t of TAB_SPECS) {
    const header = (now.get(t.tab) ?? [])[0] ?? [];
    const have2 = header.map(normHeader);
    const missing = t.cols.filter((c) => !c.names.some((n) => have2.includes(normHeader(n))));
    if (!missing.length) continue;
    const start = header.length;
    writes.push({ range: `${t.tab}!${colLetter(start)}1`, values: [missing.map((c) => c.names[0])] });
    if (!add.some((x) => x.tab === t.tab)) changes.push(`Added columns to ${t.tab}: ${missing.map((c) => c.names[0]).join(', ')}`);
  }
  await writeCells(writes);
  forgetStaffCache();
  let style: string;
  try {
    style = (await styleSheetNow()).changes.join(' ');
  } catch (e) {
    // The sheet works without its colours, so a styling problem never undoes the setup.
    style = `Could not apply the Clay & Sand look: ${why(e)}`;
  }
  return { changes, style };
}

/* ---------- the Clay & Sand look for the sheet ---------- */

async function styleSheetNow(): Promise<{ changes: string[] }> {
  getConfig();
  const have = await listTabs();
  const present = ALL_TABS.filter((t) => have.includes(t));
  if (!present.length) throw new HttpError(409, 'There are no Haveli tabs in the sheet yet. Press "Set up sheet" first.', undefined, 'SETUP');
  const raw = await sheetsRequest<Parameters<typeof factsFrom>[0]>('GET', `?fields=${encodeURIComponent(FACTS_FIELDS)}`);
  const headers = await fetchRanges(present);
  const facts = factsFrom(raw, headers).filter((f) => present.includes(f.tab));
  const requests = facts.flatMap(styleRequests);
  if (requests.length) await sheetsRequest('POST', ':batchUpdate', { requests });
  return { changes: [`Applied the Clay & Sand look to ${facts.map((f) => f.tab).join(', ')}`] };
}

/** Colours, widths, number formats and drop-downs for every tab. Never touches a value. Safe to run again. */
export const styleSheet = () => exclusive(() => styleSheetNow());

/* ---------- connection check ---------- */

function why(e: unknown): string {
  return e instanceof HttpError ? e.message : 'Something unexpected went wrong.';
}

export async function health(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const report: HealthReport = { ok: false, checks, sheetTitle: '', counts: { rooms: 0, guests: 0, bookings: 0 }, setupNeeded: false };

  const problems = configProblems();
  checks.push({
    name: 'Server settings',
    ok: problems.length === 0,
    detail: problems.length ? `Missing or invalid: ${problems.join(', ')}` : 'All settings found.',
  });
  if (problems.length) return report;

  const cfg = getConfig();

  try {
    await getAccessToken();
    checks.push({ name: 'Google sign-in', ok: true, detail: `Signed in as ${cfg.saEmail}.` });
  } catch (e) {
    checks.push({ name: 'Google sign-in', ok: false, detail: why(e) });
    return report;
  }

  let tabs: string[] = [];
  try {
    const meta = await sheetsRequest<{ properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] }>(
      'GET',
      '?fields=properties.title,sheets.properties.title',
    );
    report.sheetTitle = meta.properties?.title ?? '';
    tabs = (meta.sheets ?? []).map((s) => s.properties?.title ?? '');
    checks.push({ name: 'Sheet access', ok: true, detail: `Opened "${report.sheetTitle}".` });
  } catch (e) {
    checks.push({ name: 'Sheet access', ok: false, detail: why(e) });
    return report;
  }

  const absent = ALL_TABS.filter((t) => !tabs.includes(t));
  report.setupNeeded = absent.length > 0;
  checks.push({
    name: 'Tabs',
    ok: absent.length === 0,
    detail: absent.length ? `Missing tab(s): ${absent.join(', ')}.` : 'Rooms, Guests, Bookings, Payments and Staff found.',
  });

  try {
    const sheets = await readSheets();
    const missing = gaps(sheets);
    if (missing.length) report.setupNeeded = true;
    for (const s of [sheets.rooms, sheets.guests, sheets.bookings]) {
      checks.push({
        name: `${s.tab} columns`,
        ok: s.missing.length === 0,
        detail: s.missing.length ? `Missing in row 1: ${s.missing.join(', ')}.` : 'All required columns found.',
      });
    }
    if (missing.length) checks.push({ name: 'Setup', ok: false, detail: `Needs adding: ${missing.join(' · ')}. Press "Set up sheet".` });
    if (sheets.rooms.missing.length + sheets.guests.missing.length + sheets.bookings.missing.length === 0) {
      const warnings: string[] = [];
      const rooms = parseRooms(sheets.rooms, warnings);
      const guests = parseGuests(sheets.guests, warnings);
      const bookings = parseBookings(sheets.bookings, rooms, guests, warnings);
      report.counts = { rooms: rooms.length, guests: guests.length, bookings: bookings.length };
      checks.push({
        name: 'Rows',
        ok: warnings.length === 0,
        detail: warnings.length
          ? `${warnings.length} row(s) need attention. First: ${warnings[0]}`
          : `${rooms.length} rooms, ${guests.length} guests, ${bookings.length} bookings.`,
      });
    }
  } catch (e) {
    checks.push({ name: 'Reading data', ok: false, detail: why(e) });
  }
  report.ok = checks.every((c) => c.ok);
  return report;
}

/** The link to the spreadsheet itself. Only handed out after the owner password is confirmed. */
export function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${getConfig().sheetId}/edit`;
}

/**
 * Writes run one at a time. Two people saving at the same moment would otherwise both
 * read the sheet before either wrote, so a room could be double-booked or an ID reused.
 * (This guards one running copy of the app, which is how it is meant to be used.)
 */
let writeTail: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = writeTail.then(job, job);
  writeTail = run.catch(() => undefined);
  return run;
}

export const createBooking = (...a: Parameters<typeof createBookingNow>) => exclusive(() => createBookingNow(...a));
export const updateBooking = (...a: Parameters<typeof updateBookingNow>) => exclusive(() => updateBookingNow(...a));
export const changeStage = (...a: Parameters<typeof changeStageNow>) => exclusive(() => changeStageNow(...a));
export const changeRoomStatus = (...a: Parameters<typeof changeRoomStatusNow>) => exclusive(() => changeRoomStatusNow(...a));
export const generateRooms = (...a: Parameters<typeof generateRoomsNow>) => exclusive(() => generateRoomsNow(...a));
export const addRoom = (...a: Parameters<typeof addRoomNow>) => exclusive(() => addRoomNow(...a));
export const collectPayment = (...a: Parameters<typeof collectPaymentNow>) => exclusive(() => collectPaymentNow(...a));
export const saveStaff = (...a: Parameters<typeof saveStaffNow>) => exclusive(() => saveStaffNow(...a));
export const setupSheet = () => exclusive(() => setupSheetNow());

