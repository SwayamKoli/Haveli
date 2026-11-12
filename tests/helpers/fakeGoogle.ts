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
  Bookings: [
    'Booking ID', 'Guest ID', 'Guest name', 'Room No', 'Check-in', 'Check-out', 'Nights', 'Rate (₹/night)',
    'Total (₹)', 'Paid (₹)', 'Balance (₹)', 'Source', 'Stage', 'Guests', 'Expected arrival', 'Notes',
    'Created at', 'Updated at',
  ],
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
    Bookings: [[...HEADERS.Bookings]],
  };
  /** Formulas written by the app, keyed like "Bookings!G2". */
  formulas: Record<string, string> = {};
  calls: string[] = [];
  /** Fail the next call to Sheets with this HTTP status. */
  failNextWith: number | null = null;

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

    if (rest === '' && method === 'GET') {
      return this.json(200, {
        properties: { title: 'Haveli (test)' },
        sheets: Object.keys(this.tabs).map((title) => ({ properties: { title } })),
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
      const row = ((body.values as Cell[][])[0] ?? []).map((v) => this.parseInput(v, ''));
      this.tabs[tab].push(row);
      const n = this.tabs[tab].length;
      const last = String.fromCharCode(65 + Math.max(0, row.length - 1));
      return this.json(200, { updates: { updatedRange: `${tab}!A${n}:${last}${n}` } });
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
        tab[row][col] = this.parseInput(d.values[0][0], d.range);
      }
      return this.json(200, { totalUpdatedCells: data.length });
    }

    return this.json(404, { error: { message: `fake google: unhandled ${method} ${rest}` } });
  }
}
