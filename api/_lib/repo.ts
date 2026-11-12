/**
 * Reads and writes the Google Sheet. Every change follows the same pattern:
 *   1. read the sheet fresh,
 *   2. check the business rules (shared/rules.ts),
 *   3. write only the cells that change.
 * Nothing is cached between requests, so edits made by hand in the sheet are
 * always picked up.
 */
import { getAccessToken, sheetsRequest } from './google';
import { configProblems, getConfig } from './env';
import type { Config } from './env';
import { HttpError } from './http';
import {
  BOOKINGS_TAB,
  BOOKING_COLS,
  GUESTS_TAB,
  GUEST_COLS,
  ROOMS_TAB,
  ROOM_COLS,
  colLetter,
  mapHeaders,
} from './schema';
import type { BookingKey, ColSpec, GuestKey, HeaderMap, RoomKey } from './schema';
import { MANUAL_LABEL, STAGE_LABEL, TYPE_DEFAULTS } from '../../shared/constants';
import { diffDays, looseDateToISO, serialToISO, serialToStamp, stampInZone, todayInZone } from '../../shared/dates';
import {
  formatEta,
  money,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  planPayment,
  planRoomStatus,
  planStage,
  validateNewBooking,
  validateNewRoom,
} from '../../shared/rules';
import type {
  Booking,
  DataBundle,
  Guest,
  HealthCheck,
  HealthReport,
  NewBookingInput,
  NewRoomInput,
  Room,
  RoomManual,
  Stage,
} from '../../shared/types';

/* ---------- raw sheet access ---------- */

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

interface Sheet<K extends string> extends HeaderMap<K> {
  tab: string;
  /** Number of columns to write when appending a row. */
  width: number;
  /** Data rows, without the header. Sheet row number = index + 2. */
  rows: Row[];
}

function makeSheet<K extends string>(tab: string, values: Row[] | undefined, specs: ColSpec<K>[]): Sheet<K> {
  const all = values ?? [];
  const header = all[0] ?? [];
  const map = mapHeaders<K>(header, specs);
  const width = Math.max(header.length, ...Object.values<number>(map.idx).map((i) => i + 1), 1);
  return { tab, ...map, width, rows: all.slice(1) };
}

async function readSheets() {
  const q = [ROOMS_TAB, GUESTS_TAB, BOOKINGS_TAB].map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
  const r = await sheetsRequest<{ valueRanges?: { values?: Row[] }[] }>(
    'GET',
    `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  const vr = r.valueRanges ?? [];
  return {
    rooms: makeSheet<RoomKey>(ROOMS_TAB, vr[0]?.values, ROOM_COLS),
    guests: makeSheet<GuestKey>(GUESTS_TAB, vr[1]?.values, GUEST_COLS),
    bookings: makeSheet<BookingKey>(BOOKINGS_TAB, vr[2]?.values, BOOKING_COLS),
  };
}

const cell = (r: Row, i: number): Cell => (i >= 0 ? r[i] : undefined);
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
    const roomNo = num(cell(r, s.idx.room));
    const ci = dateCell(cell(r, s.idx.ci));
    const co = dateCell(cell(r, s.idx.co));
    const stage = parseStage(str(cell(r, s.idx.stage)));
    if (roomNo === null) return void warn.push(`Bookings row ${row} (${id}): the room number is missing.`);
    if (!ci || !co) return void warn.push(`Bookings row ${row} (${id}): check-in or check-out is not a date the app can read.`);
    if (diffDays(ci, co) < 0) return void warn.push(`Bookings row ${row} (${id}): check-out is before check-in.`);
    if (!stage) return void warn.push(`Bookings row ${row} (${id}): stage "${str(cell(r, s.idx.stage))}" is not Reserved, Checked in, Checked out or Cancelled.`);

    const room = rooms.find((x) => x.no === roomNo);
    const nights = diffDays(ci, co);
    const price = num(cell(r, s.idx.price)) ?? room?.price ?? 0;
    const paid = num(cell(r, s.idx.paid)) ?? 0;
    const { total, balance } = money(price, nights, paid);
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
      room: roomNo,
      ci,
      co,
      nights,
      price,
      total,
      paid,
      balance,
      source: str(cell(r, s.idx.source)) || 'Direct',
      stage,
      people: Math.max(1, Math.round(num(cell(r, s.idx.people)) ?? 1)),
      eta: typeof etaRaw === 'number' && etaMin !== null ? formatEta(`${Math.floor(etaMin / 60)}:${String(etaMin % 60).padStart(2, '0')}`) : str(etaRaw),
      etaMin,
      notes: str(cell(r, s.idx.notes)),
      createdAt: stampCell(cell(r, s.idx.created)),
      updatedAt: stampCell(cell(r, s.idx.updated)),
    });
  });
  return out;
}

interface Loaded {
  cfg: Config;
  sheets: Awaited<ReturnType<typeof readSheets>>;
  rooms: RoomRec[];
  guests: GuestRec[];
  bookings: BookingRec[];
  warnings: string[];
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
  const now = new Date();
  return { cfg, sheets, rooms, guests, bookings, warnings, today: todayInZone(cfg.timeZone, now), stamp: stampInZone(cfg.timeZone, now) };
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
    today: L.today,
    warnings: L.warnings,
    mode: 'live',
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

/** Nights / Total / Balance stay live formulas so they also work when someone edits the sheet by hand. */
function bookingFormulas(s: Sheet<BookingKey>, row: number): CellWrite[] {
  const at = (k: BookingKey) => (s.idx[k] >= 0 ? `${colLetter(s.idx[k])}${row}` : null);
  const ci = at('ci');
  const co = at('co');
  const nights = at('nights');
  const price = at('price');
  const total = at('total');
  const paid = at('paid');
  const balance = at('balance');
  const out: CellWrite[] = [];
  const put = (cellRef: string | null, formula: string) => {
    if (cellRef) out.push({ range: `${s.tab}!${cellRef}`, values: [[formula]] });
  };
  if (ci && co) put(nights, `=IF(AND(ISNUMBER(${ci}),ISNUMBER(${co})),${co}-${ci},"")`);
  const nightsExpr = nights ?? (ci && co ? `(${co}-${ci})` : null);
  if (price && nightsExpr) put(total, `=IF(ISNUMBER(${nightsExpr}),${nightsExpr}*${price},"")`);
  if (total && paid) put(balance, `=IF(ISNUMBER(${total}),${total}-N(${paid}),"")`);
  return out;
}

/* ---------- actions ---------- */

async function createBookingNow(input: NewBookingInput) {
  const L = await loadAll();
  const errors = validateNewBooking(input, { rooms: L.rooms, bookings: L.bookings, today: L.today });
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);

  const room = L.rooms.find((r) => r.no === input.room) as RoomRec;
  const name = input.name.trim();
  const mobile = normalizeMobile(input.mobile);
  const email = input.email.trim();
  const city = input.city.trim();
  const idLast4 = input.idLast4.trim();

  let guest: Guest | undefined = L.guests.find((g) => normalizeMobile(g.mobile) === mobile);
  let guestCreated = false;
  const gs = L.sheets.guests;
  if (!guest) {
    const id = nextId('GS', L.guests.map((g) => g.id));
    guest = { id, name, mobile, email, idType: input.idType, idLast4, city, createdAt: L.stamp };
    await appendRow(
      gs,
      buildRow(gs, { id, name: txt(name), mobile: txt(mobile), email: txt(email), idType: input.idType, idLast4: txt(idLast4), city: txt(city), created: txt(L.stamp) }),
    );
    guestCreated = true;
  } else {
    // Returning guest: only fill details the sheet does not have yet.
    const existing = L.guests.find((g) => g.id === guest!.id) as GuestRec;
    const fill: Partial<Record<GuestKey, Cell>> = {};
    if (!existing.email && email) fill.email = txt(email);
    if (!existing.city && city) fill.city = txt(city);
    if (!existing.idType && input.idType) fill.idType = input.idType;
    if (!existing.idLast4 && idLast4) fill.idLast4 = txt(idLast4);
    if (Object.keys(fill).length) {
      await writeCells(cellUpdates(gs, existing.row, fill));
      guest = { ...existing, email: existing.email || email, city: existing.city || city, idType: existing.idType || input.idType, idLast4: existing.idLast4 || idLast4 };
    }
  }

  const bs = L.sheets.bookings;
  const id = nextId('BK', L.bookings.map((b) => b.id));
  const nights = diffDays(input.ci, input.co);
  const advance = Math.round(Number(input.advance) || 0);
  const eta = formatEta(input.eta);
  const row = await appendRow(
    bs,
    buildRow(bs, {
      id,
      guestId: guest.id,
      guest: txt(name),
      room: room.no,
      ci: input.ci,
      co: input.co,
      price: room.price,
      paid: advance,
      source: input.source,
      stage: STAGE_LABEL.reserved,
      people: input.people,
      eta: txt(eta),
      notes: txt(input.notes.trim()),
      created: txt(L.stamp),
      updated: txt(L.stamp),
    }),
  );
  await writeCells(bookingFormulas(bs, row));

  const { total, balance } = money(room.price, nights, advance);
  const booking: Booking = {
    id,
    guestId: guest.id,
    guest: name,
    mobile,
    room: room.no,
    ci: input.ci,
    co: input.co,
    nights,
    price: room.price,
    total,
    paid: advance,
    balance,
    source: input.source,
    stage: 'reserved',
    people: input.people,
    eta,
    etaMin: parseEtaMinutes(eta),
    notes: input.notes.trim(),
    createdAt: L.stamp,
    updatedAt: L.stamp,
  };
  return { booking, guest, guestCreated };
}

async function changeStageNow(id: string, to: Stage, restore?: RoomManual) {
  const L = await loadAll();
  const b = L.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  const room = L.rooms.find((r) => r.no === b.room);
  const plan = planStage(b, room, L.bookings, to, restore);
  if (!plan.ok) throw new HttpError(409, plan.error);

  const writes = cellUpdates(L.sheets.bookings, b.row, { stage: STAGE_LABEL[to], updated: txt(L.stamp) });
  let newRoom: Room | null = null;
  if (plan.roomManual && room) {
    writes.push(...cellUpdates(L.sheets.rooms, room.row, { manual: MANUAL_LABEL[plan.roomManual], updated: txt(L.stamp) }));
    newRoom = { ...pub(room), manual: plan.roomManual };
  }
  await writeCells(writes);
  return { booking: { ...pub(b), stage: to, updatedAt: L.stamp } as Booking, room: newRoom };
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
  const id = nextId('RM', L.rooms.map((r) => r.id));
  const rs = L.sheets.rooms;
  await appendRow(
    rs,
    buildRow(rs, { id, no: input.no, floor: input.floor, type: txt(input.type), bed: txt(bed), cap, price, manual: MANUAL_LABEL.available, notes: '', updated: txt(L.stamp) }),
  );
  const room: Room = { id, no: input.no, floor: input.floor, type: input.type, bed, cap, price, manual: 'available', notes: '' };
  return { room };
}

async function collectPaymentNow(id: string, amount: number) {
  const L = await loadAll();
  const b = L.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  const plan = planPayment(b, amount);
  if (!plan.ok) throw new HttpError(409, plan.error);
  await writeCells(cellUpdates(L.sheets.bookings, b.row, { paid: plan.paid, updated: txt(L.stamp) }));
  const { total, balance } = money(b.price, b.nights, plan.paid);
  return { booking: { ...pub(b), paid: plan.paid, total, balance, updatedAt: L.stamp } as Booking };
}

/* ---------- connection check ---------- */

function why(e: unknown): string {
  return e instanceof HttpError ? e.message : 'Something unexpected went wrong.';
}

export async function health(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const report: HealthReport = { ok: false, checks, sheetTitle: '', sheetUrl: '', counts: { rooms: 0, guests: 0, bookings: 0 } };

  const problems = configProblems();
  checks.push({
    name: 'Server settings',
    ok: problems.length === 0,
    detail: problems.length ? `Missing or invalid: ${problems.join(', ')}` : 'All settings found.',
  });
  if (problems.length) return report;

  const cfg = getConfig();
  report.sheetUrl = `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`;

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

  const wanted = [ROOMS_TAB, GUESTS_TAB, BOOKINGS_TAB];
  const absent = wanted.filter((t) => !tabs.includes(t));
  checks.push({
    name: 'Tabs',
    ok: absent.length === 0,
    detail: absent.length ? `Missing tab(s): ${absent.join(', ')}.` : 'Rooms, Guests and Bookings found.',
  });
  if (absent.length) return report;

  try {
    const sheets = await readSheets();
    for (const s of [sheets.rooms, sheets.guests, sheets.bookings]) {
      checks.push({
        name: `${s.tab} columns`,
        ok: s.missing.length === 0,
        detail: s.missing.length ? `Missing in row 1: ${s.missing.join(', ')}.` : 'All required columns found.',
      });
    }
    if (checks.every((c) => c.ok)) {
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
export const changeStage = (...a: Parameters<typeof changeStageNow>) => exclusive(() => changeStageNow(...a));
export const changeRoomStatus = (...a: Parameters<typeof changeRoomStatusNow>) => exclusive(() => changeRoomStatusNow(...a));
export const addRoom = (...a: Parameters<typeof addRoomNow>) => exclusive(() => addRoomNow(...a));
export const collectPayment = (...a: Parameters<typeof collectPaymentNow>) => exclusive(() => collectPaymentNow(...a));
