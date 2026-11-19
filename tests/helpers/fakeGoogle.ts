/**
 * A pretend Google: the token endpoint and the parts of the Sheets API the app
 * uses, backed by plain arrays. It behaves like Sheets does for the things that
 * matter here: USER_ENTERED turns "2026-11-11" into a date number, a leading
 * apostrophe keeps text as text, "=..." becomes a formula.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

type Cell = string | number | undefined;

export const SHEET_ID = 'test-sheet-id';

const HEADERS = {
  Rooms: ['Room ID', 'Room No', 'Floor', 'Type', 'Bed', 'Sleeps', 'Rate (₹/night)', 'Status', 'Notes', 'Updated at'],
  Guests: ['Guest ID', 'Name', 'Mobile', 'Email', 'ID type', 'ID last 4', 'City', 'Created at'],
  /** The v0.1 layout: no Discount / Created by / Updated by yet. */
  Bookings: [
    'Booking ID', 'Guest ID', 'Guest name', 'Room No', 'Check-in', 'Check-out', 'Nights', 'Rate (₹/night)',
    'Total (₹)', 'Paid (₹)', 'Balance (₹)', 'Source', 'Stage', 'Guests', 'Expected arrival', 'Notes',
    'Created at', 'Updated at',
  ],
  /** What "Set up sheet" produces. */
  BookingsFull: [
    'Booking ID', 'Guest ID', 'Guest name', 'Room No', 'Check-in', 'Check-out', 'Nights', 'Rate (₹/night)',
    'Discount (₹)', 'Total (₹)', 'Paid (₹)', 'Balance (₹)', 'Source', 'Stage', 'Guests', 'Expected arrival', 'Notes',
    'Created by', 'Updated by', 'Created at', 'Updated at',
  ],
  Payments: ['Payment ID', 'Booking ID', 'Date', 'Amount (₹)', 'Method', 'Received by', 'Note'],
  Staff: ['Username', 'Name', 'Role', 'Password hash', 'Active', 'Created at'],
} as const;

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function isoToSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

export class FakeGoogle {
  tabs: Record<string, Cell[][]> = {
    Rooms: [[...HEADERS.Rooms]],
    Guests: [[...HEADERS.Guests]],
    Bookings: [[...HEADERS.BookingsFull]],
    Payments: [[...HEADERS.Payments]],
    Staff: [[...HEADERS.Staff]],
  };

  /** An old (v0.1) sheet: three tabs, no discount or audit columns. */
  makeOld(): void {
    this.tabs = { Rooms: this.tabs.Rooms, Guests: this.tabs.Guests, Bookings: [[...HEADERS.Bookings]] };
  }
  /** Formulas written by the app, keyed like "Bookings!G2". */
  formulas: Record<string, string> = {};
  calls: string[] = [];
  /** How many batchUpdate calls succeeded. */
  batches = 0;
  /** When set, adding banded rows is refused with this message (to test that styling never breaks setup). */
  refuseBanding: string | null = null;

  /** Fail the next call to Sheets with this HTTP status. */
  failNextWith: number | null = null;

  /** What the Clay & Sand styling requests did, per tab (the fake keeps the same kind of state Google does). */
  style: Record<string, FakeStyle> = {};
  private nextSheetId = 100;
  private nextBandId = 1;

  privateKey: string;
  clientEmail = 'haveli-bot@haveli-test.iam.gserviceaccount.com';
  private publicKey: KeyObject;
  private realFetch: typeof fetch | undefined;

  constructor() {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.publicKey = pair.publicKey;
  }

  install(): void {
    this.realFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown, init?: RequestInit) => this.handle(String(input), init ?? {})) as typeof fetch;
  }

  uninstall(): void {
    if (this.realFetch) globalThis.fetch = this.realFetch;
  }

  /** Put a whole row in a tab, the way a person typing in the sheet would. */
  addRawRow(tab: string, row: Cell[]): void {
    this.tabs[tab].push(row);
  }

  addRoom(no: number, type = 'Standard', manual = 'Available', rate = 2800): void {
    const n = this.tabs.Rooms.length;
    this.addRawRow('Rooms', [`RM${String(n).padStart(4, '0')}`, no, Math.floor(no / 100), type, 'Double', 2, rate, manual, '', '']);
  }

  /** Everything below the header in a tab. */
  rows(tab: string): Cell[][] {
    return this.tabs[tab].slice(1);
  }

  private styleOf(tab: string): FakeStyle {
    return (this.style[tab] ??= { sheetId: this.nextSheetId++, banding: [], rules: [], validations: {}, widths: {}, numberFormats: {}, aligned: {}, rowHeights: {} });
  }

  private tabOfSheetId(id: unknown): string | undefined {
    return Object.keys(this.tabs).find((t) => this.styleOf(t).sheetId === id);
  }

  /** Applies the styling requests the way Google would (in order, and refusing what Google refuses). Returns an error message or null. */
  private applyStyle(r: Record<string, any>): string | null {
    const kind = Object.keys(r)[0];
    const q = r[kind];
    const tabName = (id: unknown) => this.tabOfSheetId(id);
    switch (kind) {
      case 'addSheet':
        return null;
      case 'updateSheetProperties': {
        const t = tabName(q.properties.sheetId);
        if (!t) return 'No sheet with that id.';
        const st = this.styleOf(t);
        if (q.properties.tabColorStyle) st.tabColor = JSON.stringify(q.properties.tabColorStyle.rgbColor);
        if (q.properties.gridProperties?.frozenRowCount !== undefined) st.frozen = q.properties.gridProperties.frozenRowCount;
        if (q.properties.gridProperties?.hideGridlines !== undefined) st.gridlinesHidden = q.properties.gridProperties.hideGridlines;
        return null;
      }
      case 'repeatCell': {
        const t = tabName(q.range.sheetId);
        if (!t) return 'No sheet with that id.';
        const st = this.styleOf(t);
        if (q.range.endRowIndex > 5000) return 'Range is outside the grid.';
        const f = q.cell.userEnteredFormat ?? {};
        if (q.range.startRowIndex === 0 && q.range.endRowIndex === 1 && f.backgroundColorStyle) st.headerBg = JSON.stringify(f.backgroundColorStyle.rgbColor);
        if (f.numberFormat) st.numberFormats[q.range.startColumnIndex] = f.numberFormat.pattern;
        if (f.horizontalAlignment && q.range.endColumnIndex - q.range.startColumnIndex === 1) st.aligned[q.range.startColumnIndex] = f.horizontalAlignment;
        if (f.textFormat?.fontFamily) st.font = f.textFormat.fontFamily;
        return null;
      }
      case 'updateDimensionProperties': {
        const t = tabName(q.range.sheetId);
        if (!t) return 'No sheet with that id.';
        const st = this.styleOf(t);
        if (q.range.dimension === 'COLUMNS') st.widths[q.range.startIndex] = q.properties.pixelSize;
        else st.rowHeights[`${q.range.startIndex}-${q.range.endIndex}`] = q.properties.pixelSize;
        return null;
      }
      case 'deleteBanding': {
        for (const t of Object.keys(this.style)) {
          const i = this.style[t].banding.findIndex((b) => b.id === q.bandedRangeId);
          if (i >= 0) {
            this.style[t].banding.splice(i, 1);
            return null;
          }
        }
        return `No banded range with id ${q.bandedRangeId}.`;
      }
      case 'addBanding': {
        const t = tabName(q.bandedRange.range.sheetId);
        if (!t) return 'No sheet with that id.';
        const st = this.styleOf(t);
        if (this.refuseBanding) return this.refuseBanding;
        if (st.banding.length) return 'You cannot add alternating colors to a range that already has them.';
        st.banding.push({ id: this.nextBandId++ });
        return null;
      }
      case 'setDataValidation': {
        const t = tabName(q.range.sheetId);
        if (!t) return 'No sheet with that id.';
        this.styleOf(t).validations[q.range.startColumnIndex] = q.rule.condition.values.map((v: { userEnteredValue: string }) => v.userEnteredValue);
        return null;
      }
      case 'addConditionalFormatRule': {
        const rule = q.rule;
        const t = tabName(rule.ranges[0].sheetId);
        if (!t) return 'No sheet with that id.';
        const c = rule.booleanRule.condition;
        this.styleOf(t).rules.splice(q.index ?? 0, 0, {
          startCol: rule.ranges[0].startColumnIndex,
          endCol: rule.ranges[0].endColumnIndex,
          type: c.type,
          value: c.values[0].userEnteredValue,
          bg: rule.booleanRule.format.backgroundColorStyle ? JSON.stringify(rule.booleanRule.format.backgroundColorStyle.rgbColor) : undefined,
        });
        return null;
      }
      case 'deleteConditionalFormatRule': {
        const t = tabName(q.sheetId);
        if (!t) return 'No sheet with that id.';
        const list = this.styleOf(t).rules;
        if (!list[q.index]) return 'No rule at that index.';
        list.splice(q.index, 1);
        return null;
      }
      default:
        return `Unknown request: ${kind}`;
    }
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private parseInput(v: unknown, ref: string): Cell {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return undefined;
    if (v.startsWith("'")) return v.slice(1);
    if (v.startsWith('=')) {
      if (ref) this.formulas[ref] = v;
      return '';
    }
    if (ref) delete this.formulas[ref];
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return isoToSerial(v);
    if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return v;
  }

  private async handle(url: string, init: RequestInit): Promise<Response> {
    const u = new URL(url);
    this.calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search ? '?…' : ''}`);

    if (u.origin === 'https://oauth2.googleapis.com') {
      const params = new URLSearchParams(String(init.body));
      const [h, c, s] = (params.get('assertion') ?? '').split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(this.publicKey, Buffer.from(s ?? '', 'base64url'));
      const claim = JSON.parse(Buffer.from(c ?? '', 'base64url').toString()) as { iss?: string; scope?: string };
      if (!ok || claim.iss !== this.clientEmail || !claim.scope?.includes('spreadsheets')) {
        return this.json(400, { error: 'invalid_grant', error_description: 'bad assertion' });
      }
      return this.json(200, { access_token: 'tok', expires_in: 3600 });
    }

    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== 'Bearer tok') return this.json(401, { error: { message: 'no token' } });
    if (this.failNextWith) {
      const status = this.failNextWith;
      this.failNextWith = null;
      return this.json(status, { error: { message: 'forced failure' } });
    }

    const base = `/v4/spreadsheets/${SHEET_ID}`;
    if (!u.pathname.startsWith(base)) return this.json(404, { error: { message: 'not found' } });
    const rest = decodeURIComponent(u.pathname.slice(base.length));
    const method = init.method ?? 'GET';
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (rest === ':batchUpdate' && method === 'POST') {
      for (const r of (body.requests as Record<string, any>[]) ?? []) {
        const title = r.addSheet?.properties.title as string | undefined;
        if (title) this.tabs[title] = [[]];
        const problem = this.applyStyle(r);
        if (problem) return this.json(400, { error: { message: problem } });
      }
      this.batches++;
      return this.json(200, { replies: [] });
    }
    if (rest === '' && method === 'GET') {
      return this.json(200, {
        properties: { title: 'Haveli (test)' },
        sheets: Object.keys(this.tabs).map((title) => {
          const st = this.styleOf(title);
          return {
            properties: { title, sheetId: st.sheetId, gridProperties: { rowCount: 1000 } },
            bandedRanges: st.banding.map((b) => ({ bandedRangeId: b.id })),
            conditionalFormats: st.rules.map((r) => ({
              ranges: [{ startColumnIndex: r.startCol, endColumnIndex: r.endCol }],
              booleanRule: { condition: { type: r.type, values: [{ userEnteredValue: r.value }] } },
            })),
          };
        }),
      });
    }

    if (rest === '/values:batchGet' && method === 'GET') {
      const names = u.searchParams.getAll('ranges');
      const unknown = names.find((n) => !this.tabs[n]);
      if (unknown) return this.json(400, { error: { message: `Unable to parse range: ${unknown}` } });
      const valueRanges = names.map((n) => {
        const rows = this.tabs[n].map((r) => {
          const copy = [...r];
          while (copy.length && (copy[copy.length - 1] === '' || copy[copy.length - 1] === undefined)) copy.pop();
          return copy;
        });
        while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
        return { range: n, values: rows };
      });
      return this.json(200, { valueRanges });
    }

    const append = /^\/values\/([^!]+)!A1:append$/.exec(rest);
    if (append && method === 'POST') {
      const tab = append[1];
      const incoming = (body.values as unknown[][]) ?? [];
      const first = this.tabs[tab].length + 1;
      let width = 1;
      for (const raw of incoming) {
        const row = raw.map((v) => this.parseInput(v, ''));
        width = Math.max(width, row.length);
        this.tabs[tab].push(row);
      }
      const last = String.fromCharCode(65 + Math.max(0, width - 1));
      return this.json(200, { updates: { updatedRange: `${tab}!A${first}:${last}${this.tabs[tab].length}` } });
    }

    if (rest === '/values:batchUpdate' && method === 'POST') {
      const data = body.data as { range: string; values: unknown[][] }[];
      for (const d of data) {
        const m = /^([^!]+)!([A-Z]+)(\d+)$/.exec(d.range);
        if (!m) return this.json(400, { error: { message: `Unable to parse range: ${d.range}` } });
        const tab = this.tabs[m[1]];
        if (!tab) return this.json(400, { error: { message: `Unable to parse range: ${d.range}` } });
        const row = Number(m[3]) - 1;
        const col = colIndex(m[2]);
        while (tab.length <= row) tab.push([]);
        d.values[0].forEach((v, k) => {
          tab[row][col + k] = this.parseInput(v, k === 0 ? d.range : '');
        });
      }
      return this.json(200, { totalUpdatedCells: data.length });
    }

    return this.json(404, { error: { message: `fake google: unhandled ${method} ${rest}` } });
  }
}

export interface FakeStyle {
  sheetId: number;
  tabColor?: string;
  frozen?: number;
  gridlinesHidden?: boolean;
  headerBg?: string;
  font?: string;
  banding: { id: number }[];
  rules: { startCol: number; endCol: number; type: string; value: string; bg?: string }[];
  validations: Record<number, string[]>;
  widths: Record<number, number>;
  numberFormats: Record<number, string>;
  aligned: Record<number, string>;
  rowHeights: Record<string, number>;
}
