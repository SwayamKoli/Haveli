/**
 * The Clay & Sand look for the Google Sheet: the same warm palette as the app, on every tab.
 *
 * This only changes how the sheet looks (colours, widths, number formats, drop-downs). It never
 * reads or changes a value. It can be applied again at any time: the previous banding and the
 * colour rules it made are replaced, anything else you added yourself is left alone.
 */
import { MANUAL_LABEL, PAY_METHODS, REFUND_METHOD, SOURCES, STAFF_ROLES, STAGE_LABEL } from '../../shared/constants';
import { BOOKINGS_TAB, GUESTS_TAB, PAYMENTS_TAB, ROOMS_TAB, STAFF_TAB, TAB_SPECS, normHeader } from './schema';

type Rgb = { red: number; green: number; blue: number };

const hex = (h: string): Rgb => ({
  red: parseInt(h.slice(1, 3), 16) / 255,
  green: parseInt(h.slice(3, 5), 16) / 255,
  blue: parseInt(h.slice(5, 7), 16) / 255,
});
const color = (h: string) => ({ rgbColor: hex(h) });

export const PALETTE = {
  ink: '#2A1A14',
  muted: '#6E5A4E',
  headBg: '#3B1F17',
  headInk: '#FBEFE0',
  headLine: '#D9714F',
  bandA: '#FFFDF9',
  bandB: '#F6ECDF',
  font: 'Inter',
} as const;

/** One colour of the app per tab, so the tab strip itself is pleasant to look at. */
const TAB_COLOR: Record<string, string> = {
  [BOOKINGS_TAB]: '#B4472A',
  [ROOMS_TAB]: '#C98A2E',
  [GUESTS_TAB]: '#6F9A7E',
  [PAYMENTS_TAB]: '#A8643F',
  [STAFF_TAB]: '#8D7A69',
};

/** Column widths in pixels, by column key. Columns you added yourself are left as they are. */
const WIDTH: Record<string, number> = {
  id: 96,
  no: 84,
  floor: 70,
  type: 120,
  bed: 100,
  cap: 76,
  price: 112,
  manual: 120,
  notes: 260,
  updated: 150,
  name: 190,
  mobile: 130,
  email: 210,
  idType: 130,
  idLast4: 96,
  city: 130,
  created: 150,
  guestId: 96,
  guest: 190,
  room: 100,
  ci: 110,
  co: 110,
  nights: 76,
  discount: 112,
  total: 112,
  paid: 112,
  balance: 112,
  source: 120,
  stage: 124,
  people: 76,
  eta: 120,
  createdBy: 150,
  updatedBy: 150,
  booking: 110,
  at: 150,
  amount: 112,
  method: 120,
  by: 150,
  note: 240,
  username: 140,
  role: 120,
  hash: 130,
  active: 80,
};

const MONEY = new Set(['price', 'discount', 'total', 'paid', 'balance', 'amount']);
const NUMERIC = new Set([...MONEY, 'nights', 'people', 'cap', 'floor']);

type Rule = { col: string; type: 'TEXT_EQ' | 'NUMBER_GREATER' | 'NUMBER_LESS'; value: string; bg?: string; fg: string; bold?: boolean };

const RULES: Record<string, Rule[]> = {
  [BOOKINGS_TAB]: [
    { col: 'stage', type: 'TEXT_EQ', value: STAGE_LABEL.reserved, bg: '#E6ECF8', fg: '#3F5FA8' },
    { col: 'stage', type: 'TEXT_EQ', value: STAGE_LABEL.in, bg: '#FBE3D6', fg: '#A63F23' },
    { col: 'stage', type: 'TEXT_EQ', value: STAGE_LABEL.out, bg: '#E1EFE4', fg: '#2F6B43' },
    { col: 'stage', type: 'TEXT_EQ', value: STAGE_LABEL.cancelled, bg: '#ECE6E0', fg: '#8D7A69' },
    { col: 'balance', type: 'NUMBER_GREATER', value: '0', bg: '#FBEBD2', fg: '#A8660F', bold: true },
  ],
  [ROOMS_TAB]: [
    { col: 'manual', type: 'TEXT_EQ', value: MANUAL_LABEL.available, bg: '#E1EFE4', fg: '#2F6B43' },
    { col: 'manual', type: 'TEXT_EQ', value: MANUAL_LABEL.cleaning, bg: '#FBEBD2', fg: '#A8660F' },
    { col: 'manual', type: 'TEXT_EQ', value: MANUAL_LABEL.maintenance, bg: '#F6DAD6', fg: '#A8332A' },
  ],
  [PAYMENTS_TAB]: [{ col: 'amount', type: 'NUMBER_LESS', value: '0', fg: '#A8332A', bold: true }],
  [STAFF_TAB]: [{ col: 'active', type: 'TEXT_EQ', value: 'No', bg: '#ECE6E0', fg: '#8D7A69' }],
};

/** Drop-down lists. Not strict: a different word is allowed with a small warning, so nothing is ever blocked. */
const LISTS: Record<string, Record<string, string[]>> = {
  [BOOKINGS_TAB]: { stage: Object.values(STAGE_LABEL), source: SOURCES },
  [ROOMS_TAB]: { manual: Object.values(MANUAL_LABEL) },
  [PAYMENTS_TAB]: { method: [...PAY_METHODS, REFUND_METHOD] },
  [STAFF_TAB]: { role: STAFF_ROLES, active: ['Yes', 'No'] },
};

export interface TabFacts {
  tab: string;
  sheetId: number;
  rowCount: number;
  /** Header cells exactly as they are in the sheet. */
  header: unknown[];
  bandedIds: number[];
  /** Colour rules already on the tab, in the order Google keeps them. */
  rules: { index: number; startCol: number; endCol: number; type: string; first: string }[];
}

export type Req = Record<string, unknown>;

const range = (sheetId: number, r0: number, r1: number, c0: number, c1: number) => ({
  sheetId,
  startRowIndex: r0,
  endRowIndex: r1,
  startColumnIndex: c0,
  endColumnIndex: c1,
});

/** Column index of each known column key, found by header text (so reordered sheets still work). */
export function columnsOf(tab: string, header: unknown[]): Record<string, number> {
  const spec = TAB_SPECS.find((t) => t.tab === tab);
  const have = header.map(normHeader);
  const out: Record<string, number> = {};
  for (const c of spec?.cols ?? []) {
    const i = have.findIndex((h) => c.names.some((n) => normHeader(n) === h));
    if (i >= 0) out[c.key] = i;
  }
  return out;
}

/** Builds the requests that style one tab. Pure: the same facts always give the same requests. */
export function styleRequests(f: TabFacts): Req[] {
  const cols = columnsOf(f.tab, f.header);
  const width = Math.max(f.header.length, ...Object.values(cols).map((i) => i + 1), 1);
  const rows = Math.max(f.rowCount, 2);
  const sid = f.sheetId;
  const out: Req[] = [];

  // 1. Take away what an earlier run made, so running again never stacks things up.
  for (const id of f.bandedIds) out.push({ deleteBanding: { bandedRangeId: id } });
  const ours = new Set<string>();
  for (const r of RULES[f.tab] ?? []) if (cols[r.col] !== undefined) ours.add(`${cols[r.col]}|${r.type}|${r.value}`);
  [...f.rules]
    .filter((r) => r.endCol - r.startCol === 1 && ours.has(`${r.startCol}|${r.type}|${r.first}`))
    .sort((a, b) => b.index - a.index)
    .forEach((r) => out.push({ deleteConditionalFormatRule: { sheetId: sid, index: r.index } }));

  // 2. The tab itself: its colour, a frozen header and no grid lines (the banded rows carry the structure).
  out.push({
    updateSheetProperties: {
      properties: { sheetId: sid, tabColorStyle: color(TAB_COLOR[f.tab] ?? '#8D7A69'), gridProperties: { frozenRowCount: 1, hideGridlines: true } },
      fields: 'tabColorStyle,gridProperties.frozenRowCount,gridProperties.hideGridlines',
    },
  });

  // 3. Base text everywhere, then the header row.
  out.push({
    repeatCell: {
      range: range(sid, 0, rows, 0, width),
      cell: { userEnteredFormat: { textFormat: { fontFamily: PALETTE.font, fontSize: 10, foregroundColorStyle: color(PALETTE.ink) }, verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment',
    },
  });
  out.push({
    repeatCell: {
      range: range(sid, 0, 1, 0, width),
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: color(PALETTE.headBg),
          textFormat: { fontFamily: PALETTE.font, fontSize: 10, bold: true, foregroundColorStyle: color(PALETTE.headInk) },
          verticalAlignment: 'MIDDLE',
          horizontalAlignment: 'LEFT',
          borders: { bottom: { style: 'SOLID_MEDIUM', colorStyle: color(PALETTE.headLine) } },
        },
      },
      fields: 'userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment,userEnteredFormat.borders',
    },
  });
  out.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } });
  out.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: rows }, properties: { pixelSize: 28 }, fields: 'pixelSize' } });

  // 4. Warm banded rows.
  out.push({
    addBanding: {
      bandedRange: {
        range: range(sid, 0, rows, 0, width),
        rowProperties: { headerColorStyle: color(PALETTE.headBg), firstBandColorStyle: color(PALETTE.bandA), secondBandColorStyle: color(PALETTE.bandB) },
      },
    },
  });

  // 5. Column by column: width, alignment, money format.
  for (const [key, i] of Object.entries(cols)) {
    if (WIDTH[key]) out.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: WIDTH[key] }, fields: 'pixelSize' } });
    if (NUMERIC.has(key)) {
      const cell: Record<string, unknown> = { horizontalAlignment: 'RIGHT' };
      let fields = 'userEnteredFormat.horizontalAlignment';
      if (MONEY.has(key)) {
        cell.numberFormat = { type: 'NUMBER', pattern: '"₹"#,##0;-"₹"#,##0' };
        fields += ',userEnteredFormat.numberFormat';
      }
      out.push({ repeatCell: { range: range(sid, 0, rows, i, i + 1), cell: { userEnteredFormat: cell }, fields } });
    }
  }

  // 6. Drop-down lists for the columns that only take a few words.
  for (const [key, list] of Object.entries(LISTS[f.tab] ?? {})) {
    const i = cols[key];
    if (i === undefined) continue;
    out.push({
      setDataValidation: {
        range: range(sid, 1, rows, i, i + 1),
        rule: { condition: { type: 'ONE_OF_LIST', values: list.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false },
      },
    });
  }

  // 7. Colour badges (Stage, Status, money still to collect, refunds).
  for (const r of RULES[f.tab] ?? []) {
    const i = cols[r.col];
    if (i === undefined) continue;
    const format: Record<string, unknown> = { textFormat: { foregroundColorStyle: color(r.fg), bold: !!r.bold } };
    if (r.bg) format.backgroundColorStyle = color(r.bg);
    out.push({
      addConditionalFormatRule: {
        index: 0,
        rule: { ranges: [range(sid, 1, rows, i, i + 1)], booleanRule: { condition: { type: r.type, values: [{ userEnteredValue: r.value }] }, format } },
      },
    });
  }
  return out;
}

/** The words for the fields this module asks Google for. */
export const FACTS_FIELDS =
  'sheets(properties(sheetId,title,gridProperties(rowCount)),bandedRanges(bandedRangeId),conditionalFormats(ranges(startColumnIndex,endColumnIndex),booleanRule(condition(type,values))))';

interface RawSheet {
  properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number } };
  bandedRanges?: { bandedRangeId?: number }[];
  conditionalFormats?: { ranges?: { startColumnIndex?: number; endColumnIndex?: number }[]; booleanRule?: { condition?: { type?: string; values?: { userEnteredValue?: string }[] } } }[];
}

export function factsFrom(raw: { sheets?: RawSheet[] }, headers: Map<string, unknown[][]>): TabFacts[] {
  const out: TabFacts[] = [];
  for (const s of raw.sheets ?? []) {
    const tab = s.properties?.title ?? '';
    const spec = TAB_SPECS.find((t) => t.tab === tab);
    if (!spec || s.properties?.sheetId === undefined) continue;
    out.push({
      tab,
      sheetId: s.properties.sheetId,
      rowCount: s.properties.gridProperties?.rowCount ?? 1000,
      header: (headers.get(tab) ?? [])[0] ?? [],
      bandedIds: (s.bandedRanges ?? []).map((b) => b.bandedRangeId).filter((x): x is number => typeof x === 'number'),
      rules: (s.conditionalFormats ?? []).map((c, index) => ({
        index,
        startCol: c.ranges?.[0]?.startColumnIndex ?? -1,
        endCol: c.ranges?.length === 1 ? (c.ranges[0].endColumnIndex ?? -1) : -99,
        type: c.booleanRule?.condition?.type ?? '',
        first: c.booleanRule?.condition?.values?.[0]?.userEnteredValue ?? '',
      })),
    });
  }
  return out;
}
