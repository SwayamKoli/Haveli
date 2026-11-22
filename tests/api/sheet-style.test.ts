import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { forgetStaffCache } from '../../api/sheets';
import { columnsOf, PALETTE, styleRequests } from '../../api/sheets/style';
import { FakeGoogle } from '../helpers/fakeGoogle';
import { call, setEnv, signIn } from '../helpers/harness';

let g: FakeGoogle;
let owner: string;

beforeEach(async () => {
  g = new FakeGoogle();
  g.install();
  setEnv(g);
  forgetStaffCache();
  g.addRoom(101);
  owner = await signIn();
});
afterEach(() => g.uninstall());

const colOf = (tab: string, header: string): number => {
  const i = (g.tabs[tab][0] as string[]).indexOf(header);
  assert.ok(i >= 0, `no column "${header}" in ${tab}`);
  return i;
};
const rgb = (hex: string) => JSON.stringify({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const TABS = ['Rooms', 'Guests', 'Bookings', 'Payments', 'Staff'];

describe('Clay & Sand look for the Google Sheet', () => {
  it('is for the owner only', async () => {
    g.tabs.Staff.push(['asha', 'Asha', 'Reception', 'x', 'Yes', '']);
    const r = await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: true, password: 'maple-river-41' } });
    assert.equal(r.status, 200);
    const asha = await signIn('asha', 'maple-river-41');
    assert.equal((await call('sheet-setup', { cookie: asha, body: {} })).status, 403);
    assert.equal((await call('sheet-setup', { body: {} })).status, 401);
    assert.equal(g.batches, 0);
  });

  it('styles every tab: colour, frozen header, dark clay header row, banded rows, widths', async () => {
    const r = await call('sheet-setup', { cookie: owner, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.style, /Applied the Clay & Sand look to Rooms, Guests, Bookings, Payments, Staff/);
    for (const tab of TABS) {
      const st = g.style[tab];
      assert.ok(st.tabColor, `${tab} has a tab colour`);
      assert.equal(st.frozen, 1, `${tab} header is frozen`);
      assert.equal(st.gridlinesHidden, true);
      assert.equal(st.headerBg, rgb(PALETTE.headBg), `${tab} header colour`);
      assert.equal(st.font, 'Inter');
      assert.equal(st.banding.length, 1, `${tab} has one set of banded rows`);
      assert.equal(st.rowHeights['0-1'], 38);
      assert.equal(st.rowHeights['1-1000'], 28);
    }
    assert.equal(new Set(TABS.map((t) => g.style[t].tabColor)).size, 5, 'each tab gets its own colour');
    assert.equal(g.style.Bookings.widths[colOf('Bookings', 'Guest name')], 190);
    assert.equal(g.style.Bookings.widths[colOf('Bookings', 'Notes')], 260);
    assert.equal(g.style.Staff.widths[colOf('Staff', 'Active')], 80);
  });

  it('shows money as rupees and right-aligns numbers', async () => {
    await call('sheet-setup', { cookie: owner, body: {} });
    const b = g.style.Bookings;
    for (const h of ['Rate (₹/night)', 'Discount (₹)', 'Total (₹)', 'Paid (₹)', 'Balance (₹)']) {
      assert.equal(b.numberFormats[colOf('Bookings', h)], '"₹"#,##0;-"₹"#,##0', h);
      assert.equal(b.aligned[colOf('Bookings', h)], 'RIGHT', h);
    }
    assert.equal(b.aligned[colOf('Bookings', 'Nights')], 'RIGHT');
    assert.equal(b.numberFormats[colOf('Bookings', 'Nights')], undefined, 'nights is a count, not money');
    assert.equal(g.style.Payments.numberFormats[colOf('Payments', 'Amount (₹)')], '"₹"#,##0;-"₹"#,##0');
    assert.equal(b.aligned[colOf('Bookings', 'Guest name')], undefined, 'names stay left');
  });

  it('colours Stage, Status, balance due and refunds, and adds drop-downs', async () => {
    await call('sheet-setup', { cookie: owner, body: {} });
    const b = g.style.Bookings;
    const stage = colOf('Bookings', 'Stage');
    assert.deepEqual(b.rules.filter((r) => r.startCol === stage).map((r) => r.value).sort(), ['Cancelled', 'Checked in', 'Checked out', 'Reserved']);
    const bal = b.rules.filter((r) => r.startCol === colOf('Bookings', 'Balance (₹)'));
    assert.equal(bal.length, 1);
    assert.equal(bal[0].type, 'NUMBER_GREATER');
    assert.deepEqual(g.style.Rooms.rules.map((r) => r.value).sort(), ['Available', 'Cleaning', 'Maintenance']);
    assert.equal(g.style.Payments.rules[0].type, 'NUMBER_LESS');
    assert.equal(g.style.Staff.rules[0].value, 'No');
    assert.deepEqual(b.validations[stage], ['Reserved', 'Checked in', 'Checked out', 'Cancelled']);
    assert.ok(b.validations[colOf('Bookings', 'Source')].includes('MakeMyTrip'));
    assert.deepEqual(g.style.Rooms.validations[colOf('Rooms', 'Status')], ['Available', 'Cleaning', 'Maintenance']);
    assert.deepEqual(g.style.Staff.validations[colOf('Staff', 'Active')], ['Yes', 'No']);
  });

  it('never reads or changes a single value in the sheet', async () => {
    g.addRoom(102, 'Deluxe', 'Cleaning', 4200);
    g.addRawRow('Staff', ['asha', 'Asha', 'Reception', 'hash', 'Yes', '2026-01-01']);
    const before = JSON.stringify(g.tabs);
    await call('sheet-setup', { cookie: owner, body: {} });
    assert.equal(JSON.stringify(g.tabs), before);
  });

  it('can be run again and again without stacking banding or colour rules', async () => {
    await call('sheet-setup', { cookie: owner, body: {} });
    const once = JSON.stringify(g.style);
    for (let i = 0; i < 3; i++) {
      const r = await call('sheet-setup', { cookie: owner, body: {} });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    for (const tab of TABS) assert.equal(g.style[tab].banding.length, 1, `${tab} banding`);
    assert.equal(g.style.Bookings.rules.length, 5);
    assert.equal(g.style.Rooms.rules.length, 3);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(g.style).map(([k, v]) => [k, { ...v, banding: v.banding.length }]))), JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(once)).map(([k, v]: [string, any]) => [k, { ...v, banding: v.banding.length }]))));
  });

  it('keeps colour rules the owner added by hand', async () => {
    await call('sheet-setup', { cookie: owner, body: {} });
    g.style.Bookings.rules.push({ startCol: 17, endCol: 18, type: 'TEXT_CONTAINS', value: 'VIP' });
    g.style.Bookings.rules.unshift({ startCol: colOf('Bookings', 'Stage'), endCol: colOf('Bookings', 'Stage') + 5, type: 'TEXT_EQ', value: 'Reserved' });
    await call('sheet-setup', { cookie: owner, body: {} });
    assert.ok(g.style.Bookings.rules.some((r) => r.value === 'VIP'), 'the VIP rule is still there');
    assert.ok(g.style.Bookings.rules.some((r) => r.endCol - r.startCol === 5), 'a wider rule on the same column is still there');
    assert.equal(g.style.Bookings.rules.length, 5 + 2);
  });

  it('follows the columns if they were moved around or extra ones were added', async () => {
    const h = g.tabs.Bookings[0] as string[];
    g.tabs.Bookings[0] = ['My own column', ...h.slice().reverse()];
    await call('sheet-setup', { cookie: owner, body: {} });
    const stage = colOf('Bookings', 'Stage');
    assert.ok(g.style.Bookings.rules.some((r) => r.startCol === stage && r.value === 'Checked in'));
    assert.equal(g.style.Bookings.widths[colOf('Bookings', 'Guest name')], 190);
    assert.equal(g.style.Bookings.widths[0], undefined, 'a column the app does not know is left as it is');
    assert.equal(columnsOf('Bookings', g.tabs.Bookings[0]).stage, stage);
  });

  it('"Set up sheet" gives new tabs the look as well, and a styling problem never undoes the setup', async () => {
    g.makeOld();
    const ok = await call('sheet-setup', { cookie: owner, body: {} });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.style, /Applied the Clay & Sand look to .*Payments, Staff/);
    assert.ok(g.style.Staff.tabColor && g.style.Payments.tabColor);
    assert.equal(g.style.Bookings.banding.length, 1);

    g.makeOld();
    g.style = {};
    g.refuseBanding = 'The caller does not have permission';
    const bad = await call('sheet-setup', { cookie: owner, body: {} });
    assert.equal(bad.status, 200, JSON.stringify(bad.body));
    assert.match(bad.body.style, /^Could not apply the Clay & Sand look/);
    assert.ok(bad.body.changes.includes('Added the Payments tab'), 'the tabs were still added');
    assert.deepEqual(g.tabs.Staff[0], ['Username', 'Name', 'Role', 'Password hash', 'Active', 'Created at']);
  });

  it('puts the body text right: dark, not bold, no left-over fill, even on rows an older version added', () => {
    const facts = { tab: 'Guests', sheetId: 4, rowCount: 1000, header: g.tabs.Guests[0], bandedIds: [], rules: [] };
    const reqs = styleRequests(facts) as any[];
    const body = reqs.find((r) => r.repeatCell && r.repeatCell.range.startRowIndex === 1 && r.repeatCell.cell.userEnteredFormat.textFormat);
    assert.ok(body, 'there is a request for the body rows');
    const fmt = body.repeatCell.cell.userEnteredFormat.textFormat;
    assert.deepEqual(fmt.foregroundColorStyle.rgbColor, JSON.parse(rgb(PALETTE.ink)));
    assert.equal(fmt.bold, false);
    assert.match(body.repeatCell.fields, /backgroundColor/);
    assert.match(body.repeatCell.fields, /borders/);
    assert.equal(body.repeatCell.cell.userEnteredFormat.backgroundColorStyle, undefined, 'the fill is cleared, so the banded rows show');
    const head = reqs.find((r) => r.repeatCell && r.repeatCell.range.startRowIndex === 0 && r.repeatCell.range.endRowIndex === 1 && r.repeatCell.cell.userEnteredFormat.textFormat);
    assert.deepEqual(head.repeatCell.cell.userEnteredFormat.textFormat.foregroundColorStyle.rgbColor, JSON.parse(rgb(PALETTE.headInk)));
  });

  it('adds new rows without inserting rows, so a new row never copies the header look', async () => {
    const r = await call('staff-save', { cookie: owner, body: { username: 'ravi', name: 'Ravi', role: 'Reception', active: true, password: 'tulip-moon-63' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(g.appendModes.length > 0);
    assert.ok(g.appendModes.every((m) => m === 'OVERWRITE'), g.appendModes.join(','));
  });

  it('builds the same requests for the same sheet', () => {
    const facts = { tab: 'Rooms', sheetId: 7, rowCount: 1000, header: g.tabs.Rooms[0], bandedIds: [3], rules: [] };
    assert.deepEqual(styleRequests(facts), styleRequests(facts));
    assert.equal((styleRequests(facts)[0] as any).deleteBanding.bandedRangeId, 3);
  });
});
