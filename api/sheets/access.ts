/**
 * Raw access to the sheet: reading ranges, cell helpers, writing cells, and the queue that lets only one change run at a time.
 */
import { looseDateToISO, serialToISO, serialToStamp } from '../../shared/dates';
import { HttpError } from '../lib/http';
import { sheetsRequest } from './google';
import {
  BOOKING_COLS,
  BOOKINGS_TAB,
  colLetter,
  GUEST_COLS,
  GUESTS_TAB,
  mapHeaders,
  PAYMENT_COLS,
  PAYMENTS_TAB,
  ROOM_COLS,
  ROOMS_TAB,
  STAFF_COLS,
  STAFF_TAB,
  TAB_SPECS,
  type BookingKey,
  type ColSpec,
  type GuestKey,
  type HeaderMap,
  type PaymentKey,
  type RoomKey,
  type StaffKey,
} from './schema';

export type Cell = string | number | boolean | null | undefined;

export type Row = Cell[];

export interface Sheet<K extends string> extends HeaderMap<K> {
  tab: string;
  /** False when the tab does not exist in the spreadsheet yet. */
  present: boolean;
  /** Number of columns to write when appending a row. */
  width: number;
  /** Data rows, without the header. Sheet row number = index + 2. */
  rows: Row[];
}

export function makeSheet<K extends string>(tab: string, values: Row[] | undefined, specs: ColSpec<K>[], present = true): Sheet<K> {
  const all = values ?? [];
  const header = all[0] ?? [];
  const map = mapHeaders<K>(header, specs);
  const width = Math.max(header.length, ...Object.values<number>(map.idx).map((i) => i + 1), 1);
  return { tab, present, ...map, width, rows: all.slice(1) };
}

export const ALL_TABS = TAB_SPECS.map((t) => t.tab);

export async function fetchRanges(tabs: string[]): Promise<Map<string, Row[]>> {
  const q = tabs.map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
  const r = await sheetsRequest<{ valueRanges?: { values?: Row[] }[] }>(
    'GET',
    `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  const out = new Map<string, Row[]>();
  tabs.forEach((t, i) => out.set(t, r.valueRanges?.[i]?.values ?? []));
  return out;
}

export async function listTabs(): Promise<string[]> {
  const meta = await sheetsRequest<{ sheets?: { properties?: { title?: string } }[] }>('GET', '?fields=sheets.properties.title');
  return (meta.sheets ?? []).map((x) => x.properties?.title ?? '');
}

/** Reads every tab the app uses. Payments and Staff may be missing (the owner adds them with "Set up sheet"). */
export async function readSheets() {
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

export type Sheets = Awaited<ReturnType<typeof readSheets>>;

/** Tabs or columns the app wants that the sheet does not have yet. */
export function gaps(sheets: Sheets): string[] {
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

export const cell = (r: Row, i: number): Cell => (i >= 0 ? r[i] : undefined);

/** Every ID in a tab's ID column, including rows the app could not read, so a new ID never reuses one. */
export const rawIds = <K extends string>(s: Sheet<K>, key: K): string[] => s.rows.map((r) => str(cell(r, s.idx[key])));

export const isBlank = (r: Row) => r.every((c) => c === '' || c === null || c === undefined);

export function str(v: Cell): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

export function num(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[₹,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function dateCell(v: Cell): string | null {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToISO(v) : null;
  if (typeof v === 'string') return looseDateToISO(v);
  return null;
}

export function stampCell(v: Cell): string {
  return typeof v === 'number' ? serialToStamp(v) : str(v);
}

/**
 * Text typed into a cell by a guest or staff member must never be read as a
 * formula, so a leading apostrophe forces Sheets to keep it as plain text.
 */
export const txt = (s: string): string => (s === '' ? '' : `'${s}`);

export function buildRow<K extends string>(s: Sheet<K>, vals: Partial<Record<K, Cell>>): Row {
  const row: Row = new Array<Cell>(s.width).fill('');
  for (const key of Object.keys(vals) as K[]) {
    const i = s.idx[key];
    if (i >= 0) row[i] = vals[key];
  }
  return row;
}

export interface CellWrite {
  range: string;
  values: Cell[][];
}

export function cellUpdates<K extends string>(s: Sheet<K>, rowNo: number, vals: Partial<Record<K, Cell>>): CellWrite[] {
  const out: CellWrite[] = [];
  for (const key of Object.keys(vals) as K[]) {
    const i = s.idx[key];
    if (i >= 0) out.push({ range: `${s.tab}!${colLetter(i)}${rowNo}`, values: [[vals[key]]] });
  }
  return out;
}

export async function writeCells(data: CellWrite[]): Promise<void> {
  if (!data.length) return;
  await sheetsRequest('POST', '/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data });
}

/** Adds a row at the bottom of the tab and returns its row number. */
export async function appendRow<K extends string>(s: Sheet<K>, values: Row): Promise<number> {
  const r = await sheetsRequest<{ updates?: { updatedRange?: string } }>(
    'POST',
    `/values/${encodeURIComponent(`${s.tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`,
    { values: [values] },
  );
  const m = /!\$?[A-Z]+\$?(\d+)/.exec(r.updates?.updatedRange ?? '');
  if (!m) throw new HttpError(502, 'Google saved the row but did not say where. Refresh to check.');
  return Number(m[1]);
}

/** Adds several rows at the bottom of the tab in one call. */
export async function appendRows<K extends string>(s: Sheet<K>, values: Row[]): Promise<void> {
  if (!values.length) return;
  await sheetsRequest('POST', `/values/${encodeURIComponent(`${s.tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`, { values });
}

export function why(e: unknown): string {
  return e instanceof HttpError ? e.message : 'Something unexpected went wrong.';
}

/**
 * Writes run one at a time. Two people saving at the same moment would otherwise both
 * read the sheet before either wrote, so a room could be double-booked or an ID reused.
 * (This guards one running copy of the app, which is how it is meant to be used.)
 */
let writeTail: Promise<unknown> = Promise.resolve();

export function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = writeTail.then(job, job);
  writeTail = run.catch(() => undefined);
  return run;
}
