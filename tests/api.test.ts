import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { forgetStaffCache } from '../api/_lib/repo';
import { createToken, verifyToken } from '../api/_lib/session';
import type { SessionUser } from '../api/_lib/session';
import { addDays, todayInZone } from '../shared/dates';
import { FakeGoogle, SHEET_ID } from './helpers/fakeGoogle';
import { OWNER, PASSWORD, SECRET, call, setEnv, signIn } from './helpers/harness';

const TODAY = todayInZone('Asia/Kolkata');
let g: FakeGoogle;
let owner: string; // cookie of the owner

/** A booking as the form sends it. Room 101 is 2,800 a night, room 102 is 4,200. */
function newBooking(over: Record<string, unknown> = {}) {
  return {
    name: 'Neha Kulkarni', mobile: '9876543210', source: 'Direct', ci: TODAY, co: addDays(TODAY, 2), rooms: [101], discount: 0,
    advance: 1000, method: 'Cash', people: 2, eta: '14:00', email: 'neha@example.com', city: 'Pune', idType: 'Aadhaar', idLast4: '4321', notes: '',
    ...over,
  };
}

/** The same fields for an edit. */
function editBody(id: string, over: Record<string, unknown> = {}) {
  const { advance: _a, method: _m, ...rest } = newBooking();
  return { ...rest, id, ...over };
}

const colOf = (tab: string, header: string): number => {
  const i = (g.tabs[tab][0] as string[]).indexOf(header);
  assert.ok(i >= 0, `no column "${header}" in ${tab}`);
  return i;
};
const cellAt = (tab: string, row: number, header: string) => g.rows(tab)[row][colOf(tab, header)];
/** Put a row in a tab by header name, the way someone typing in the sheet would. */
function raw(tab: string, vals: Record<string, string | number>): void {
  g.addRawRow(tab, (g.tabs[tab][0] as string[]).map((h) => vals[h] ?? ''));
}

async function makeStaff(username = 'asha', password = 'asha-pass-1', name = 'Asha Verma', role = 'Reception') {
  const r = await call('staff-save', { cookie: owner, body: { username, name, role, active: true, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return signIn(username, password);
}

async function created(over: Record<string, unknown> = {}, cookie = owner) {
  const r = await call('booking-create', { cookie, body: newBooking(over) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.booking as { id: string; [k: string]: any };
}

beforeEach(async () => {
  g = new FakeGoogle();
  g.install();
  setEnv(g);
  forgetStaffCache();
  g.addRoom(101);
  g.addRoom(102, 'Deluxe', 'Available', 4200);
  g.addRoom(103, 'Standard', 'Maintenance');
  g.addRoom(104);
  g.addRoom(105);
  owner = await signIn();
});
afterEach(() => g.uninstall());

/* ------------------------------------------------------------------ sign-in */

describe('sign-in', () => {
  it('reports setup problems by name only, never by value', async () => {
    setEnv(g, { SHEET_ID: undefined, OWNER_PASSWORD: 'short' });
    const r = await call('session');
    assert.equal(r.body.configured, false);
    assert.deepEqual(r.body.missing, ['SHEET_ID', 'OWNER_PASSWORD (use at least 8 characters)']);
    assert.equal(r.body.hotel, 'Test Hotel');
    assert.equal(JSON.stringify(r.body).includes('short'), false);
    assert.equal((await call('login', { body: { username: OWNER, password: 'x' } })).status, 503);
  });

  it('still accepts APP_PASSWORD from older installs as the owner password', async () => {
    setEnv(g, { OWNER_PASSWORD: undefined, APP_PASSWORD: PASSWORD });
    const r = await call('login', { body: { username: OWNER, password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.equal(r.body.staff.owner, true);
  });

  it('signs the owner in with username and password, and says who they are', async () => {
    const ok = await call('login', { body: { username: ' Owner ', password: PASSWORD } });
    assert.equal(ok.status, 200);
    const setCookie = String(ok.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Secure/);
    assert.deepEqual(ok.body.staff, { username: 'owner', name: 'Test Owner', role: 'Owner', owner: true, viaOwner: false });
    assert.equal(ok.body.hotel, 'Test Hotel');
    const s = await call('session', { cookie: owner });
    assert.equal(s.body.authenticated, true);
    assert.equal(s.body.staff.username, 'owner');
  });

  it('rejects wrong, blank and unknown credentials without setting a cookie', async () => {
    for (const body of [
      { username: OWNER, password: 'nope' },
      { username: OWNER, password: '' },
      { username: '', password: PASSWORD },
      { username: 'nobody', password: 'nope' },
      { username: 'nobody', password: PASSWORD },
      { password: PASSWORD },
      {},
    ]) {
      const r = await call('login', { body });
      assert.equal(r.status, 401, JSON.stringify(body));
      assert.equal(r.headers['set-cookie'], undefined);
      assert.equal(r.body.error, 'The username or password is not right.');
    }
  });

  it('locks out an address after repeated wrong passwords', async () => {
    for (let i = 0; i < 8; i++) await call('login', { body: { username: OWNER, password: 'wrong' }, ip: '203.0.113.9' });
    const r = await call('login', { body: { username: OWNER, password: PASSWORD }, ip: '203.0.113.9' });
    assert.equal(r.status, 429);
    assert.equal((await call('login', { body: { username: OWNER, password: PASSWORD }, ip: '203.0.113.10' })).status, 200);
  });

  it('keeps data private without a valid cookie', async () => {
    assert.equal((await call('data')).status, 401);
    assert.equal((await call('data', { cookie: 'haveli_session=v1.9999999999.forged' })).status, 401);
    assert.equal((await call('data', { cookie: 'haveli_session=v2.e30.forged' })).status, 401);
    assert.equal((await call('data', { cookie: owner })).status, 200);
  });

  it('refuses changes that lack the anti-forgery header', async () => {
    const r = await call('room-status', { cookie: owner, noCsrf: true, body: { no: 101, status: 'cleaning' } });
    assert.equal(r.status, 403);
  });

  it('signed tokens carry who is signed in, expire, and cannot be tampered with', () => {
    const who: SessionUser = { u: 'asha', n: 'Asha Verma', r: 'Reception', o: false, v: false, k: 'abcdef' };
    const t = createToken(SECRET, who, 1_000_000);
    assert.deepEqual(verifyToken(SECRET, t, 2_000_000), who);
    assert.equal(verifyToken(SECRET, t, 1_000_000 + 13 * 3600 * 1000), null, 'a shift is 12 hours');
    assert.equal(verifyToken('another-secret-another-secret!!', t, 2_000_000), null);
    const [v, body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...who, o: true, e: 9_999_999_999 })).toString('base64url');
    assert.equal(verifyToken(SECRET, `${v}.${forged}.${sig}`, 2_000_000), null, 'cannot make yourself owner');
    assert.equal(verifyToken(SECRET, `v1.${body}.${sig}`, 2_000_000), null);
    assert.equal(verifyToken(SECRET, null), null);
  });
});

/* -------------------------------------------------------------- staff & owner */

describe('staff accounts and the owner password', () => {
  it('lets the owner add an employee; the password is stored only as a hash', async () => {
    await makeStaff();
    const row = g.rows('Staff')[0];
    assert.equal(row[0], 'asha');
    assert.equal(row[1], 'Asha Verma');
    assert.equal(row[2], 'Reception');
    assert.match(String(row[3]), /^scrypt\$16384\$8\$1\$/);
    assert.equal(row[4], 'Yes');
    assert.equal(JSON.stringify(g.tabs).includes('asha-pass-1'), false, 'the password itself is nowhere in the sheet');
    const list = await call('staff-list', { cookie: owner });
    assert.deepEqual(list.body.staff.map((s: any) => [s.username, s.name, s.role, s.active]), [['asha', 'Asha Verma', 'Reception', true]]);
    assert.equal(JSON.stringify(list.body).includes('scrypt'), false, 'hashes never leave the server');
  });

  it('signs an employee in with their own username and password', async () => {
    await makeStaff();
    const r = await call('login', { body: { username: 'ASHA', password: 'asha-pass-1' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.staff, { username: 'asha', name: 'Asha Verma', role: 'Reception', owner: false, viaOwner: false });
    assert.equal((await call('login', { body: { username: 'asha', password: 'wrong-pass' } })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: 'asha-pass-1' } })).status, 401, 'an employee password never opens the owner account');
  });

  it('lets the owner password open any employee account, and records "(via owner)"', async () => {
    await makeStaff();
    const r = await call('login', { body: { username: 'asha', password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.staff, { username: 'asha', name: 'Asha Verma', role: 'Reception', owner: false, viaOwner: true });
    const viaOwner = String(r.headers['set-cookie']).split(';')[0];
    const b = await created({}, viaOwner);
    assert.equal(b.createdBy, 'Asha Verma (via owner)');
    assert.equal(cellAt('Bookings', 0, 'Created by'), 'Asha Verma (via owner)');
    assert.equal((await call('login', { body: { username: 'nobody', password: PASSWORD } })).status, 401);
  });

  it('does not let an employee (or the owner acting as one) use owner-only powers', async () => {
    const own = await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    for (const cookie of [own, via]) {
      for (const [action, body] of [
        ['staff-list', undefined],
        ['staff-save', { username: 'bob', name: 'Bob Roy', role: 'Reception', password: 'bobs-pass-1' }],
        ['health', undefined],
        ['sheet-setup', {}],
        ['rooms-generate', { floors: 1, perFloor: 2, rate: 2000 }],
      ] as const) {
        const r = await call(action, { cookie, body });
        assert.equal(r.status, 403, action);
        assert.equal(r.body.error, 'Only the owner can do this.');
      }
    }
    assert.equal((await call('staff-list', { cookie: owner })).status, 200);
    assert.equal((await call('health', { cookie: owner })).status, 200);
  });

  it('shows the owner password never opens a switched-off employee', async () => {
    await makeStaff();
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: false, password: '' } });
    assert.equal((await call('login', { body: { username: 'asha', password: PASSWORD } })).status, 401);
    assert.equal((await call('login', { body: { username: 'asha', password: 'asha-pass-1' } })).status, 401);
  });

  it('signs an employee out the moment the owner switches them off', async () => {
    const own = await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    assert.equal((await call('data', { cookie: own })).status, 200);
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: false, password: '' } });
    assert.equal((await call('data', { cookie: own })).status, 401);
    assert.equal((await call('data', { cookie: via })).status, 401);
    assert.equal((await call('session', { cookie: own })).body.authenticated, false);
  });

  it('signs an employee out when their password is changed, and the new one works', async () => {
    const own = await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha V.', role: 'Manager', active: true, password: 'new-pass-22' } });
    assert.equal((await call('data', { cookie: own })).status, 401);
    assert.equal((await call('data', { cookie: via })).status, 200, 'the owner is still in, acting as them');
    assert.equal((await call('login', { body: { username: 'asha', password: 'asha-pass-1' } })).status, 401);
    const ok = await call('login', { body: { username: 'asha', password: 'new-pass-22' } });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.staff.name, ok.body.staff.role], ['Asha V.', 'Manager']);
  });

  it('signs the owner (and anyone in via the owner) out when the owner password changes', async () => {
    await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    setEnv(g, { OWNER_PASSWORD: 'a brand new owner password' });
    assert.equal((await call('data', { cookie: owner })).status, 401);
    assert.equal((await call('data', { cookie: via })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: PASSWORD } })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: 'a brand new owner password' } })).status, 200);
  });

  it('checks the employee form and explains each mistake', async () => {
    const bad = await call('staff-save', { cookie: owner, body: { username: 'A!', name: 'x', role: 'King', password: 'abc' } });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.fields.username && bad.body.fields.name && bad.body.fields.role && bad.body.fields.password);
    const noPw = await call('staff-save', { cookie: owner, body: { username: 'bobby', name: 'Bobby Roy', role: 'Reception', password: '' } });
    assert.equal(noPw.status, 422);
    assert.equal(noPw.body.fields.password, 'Set a password for this employee.');
    const clash = await call('staff-save', { cookie: owner, body: { username: OWNER, name: 'Fake Owner', role: 'Manager', password: 'whatever-1' } });
    assert.equal(clash.body.fields.username, 'That username is the owner account.');
    assert.equal(g.rows('Staff').length, 0);
  });

  it('keeps employee names, usernames and roles from becoming formulas', async () => {
    const evil = '=HYPERLINK("http://evil.example","x")';
    await call('staff-save', { cookie: owner, body: { username: 'evil.one', name: evil, role: 'Reception', password: 'pass-word-1' } });
    assert.equal(g.rows('Staff')[0][1], evil);
    assert.equal(Object.keys(g.formulas).some((k) => k.startsWith('Staff!')), false);
  });

  it('edits an existing employee without needing a new password', async () => {
    const own = await makeStaff();
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Accounts', active: true, password: '' } });
    assert.equal(g.rows('Staff').length, 1);
    assert.equal(g.rows('Staff')[0][2], 'Accounts');
    assert.equal((await call('data', { cookie: own })).status, 200, 'same password, so still signed in');
  });

  it('asks for the one-time setup when the Staff tab does not exist yet', async () => {
    delete g.tabs.Staff;
    const r = await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', password: 'asha-pass-1' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SETUP');
    assert.equal((await call('login', { body: { username: 'asha', password: 'asha-pass-1' } })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: PASSWORD } })).status, 200, 'the owner can always get in');
  });
});

/* ------------------------------------------------------------- the sheet link */

describe('the link to the Google Sheet', () => {
  it('needs a signed-in person and the owner password', async () => {
    assert.equal((await call('sheet-link', { body: { password: PASSWORD } })).status, 401);
    for (const password of ['wrong', '', undefined, 12345]) {
      const r = await call('sheet-link', { cookie: owner, body: { password } });
      assert.equal(r.status, 401);
      assert.equal(JSON.stringify(r.body).includes(SHEET_ID), false);
    }
    const ok = await call('sheet-link', { cookie: owner, body: { password: PASSWORD } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.url, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  });

  it('works for an employee only when they type the owner password', async () => {
    const own = await makeStaff();
    assert.equal((await call('sheet-link', { cookie: own, body: { password: 'asha-pass-1' } })).status, 401);
    assert.equal((await call('sheet-link', { cookie: own, body: { password: PASSWORD } })).status, 200);
  });

  it('slows down guessing the owner password', async () => {
    for (let i = 0; i < 8; i++) await call('sheet-link', { cookie: owner, body: { password: 'guess' }, ip: '198.51.100.7' });
    assert.equal((await call('sheet-link', { cookie: owner, body: { password: PASSWORD }, ip: '198.51.100.7' })).status, 429);
  });

  it('is the only place the sheet address is ever sent', async () => {
    await created();
    for (const [action, cookie] of [['data', owner], ['session', owner], ['health', owner], ['staff-list', owner]] as const) {
      const text = JSON.stringify((await call(action, { cookie })).body);
      assert.equal(text.includes(SHEET_ID), false, action);
      assert.equal(text.includes('docs.google.com'), false, action);
      assert.equal(text.includes(PASSWORD), false, action);
      assert.equal(text.includes('PRIVATE KEY'), false, action);
    }
  });
});

/* ---------------------------------------------------------------- reading */

describe('reading the sheet', () => {
  it('returns rooms, payments and today in the hotel time zone, with no internal row numbers', async () => {
    const r = await call('data', { cookie: owner });
    assert.equal(r.body.mode, 'live');
    assert.equal(r.body.today, TODAY);
    assert.equal(r.body.setupNeeded, false);
    assert.deepEqual(r.body.payments, []);
    assert.equal(r.body.rooms.length, 5);
    assert.deepEqual(r.body.rooms[1], { id: 'RM0002', no: 102, floor: 1, type: 'Deluxe', bed: 'Double', cap: 2, price: 4200, manual: 'available', notes: '' });
    assert.equal(r.body.rooms[2].manual, 'maintenance');
    assert.equal(r.body.rooms[0].row, undefined);
  });

  it('understands rows typed by hand (several rooms, a discount) and reports rows it cannot read', async () => {
    raw('Guests', { 'Guest ID': 'GS0001', Name: 'Old Guest', Mobile: 9812345678 });
    raw('Bookings', { 'Booking ID': 'BK0001', 'Guest ID': 'GS0001', 'Guest name': 'Old Guest', 'Room No': '101, 102', 'Check-in': '12/11/2026', 'Check-out': '14/11/2026', 'Rate (₹/night)': 7000, 'Discount (₹)': 1000, 'Paid (₹)': 500, Source: 'Walk-in', Stage: 'checked in', 'Expected arrival': '2:30 PM' });
    raw('Bookings', { 'Booking ID': 'BK0002', 'Guest ID': 'GS0001', 'Guest name': 'Old Guest', 'Room No': 101, 'Check-in': 'sometime', 'Check-out': '14/11/2026', 'Rate (₹/night)': 2800, Source: 'Direct', Stage: 'Reserved' });
    raw('Bookings', { 'Booking ID': 'BK0003', 'Guest ID': 'GS0001', 'Guest name': 'Old Guest', 'Room No': 102, 'Check-in': '15/11/2026', 'Check-out': '16/11/2026', 'Rate (₹/night)': 4200, Source: 'Direct', Stage: 'Maybe' });
    raw('Bookings', { 'Booking ID': 'BK0004', 'Guest ID': 'GS0001', 'Guest name': 'Old Guest', 'Room No': '', 'Check-in': '15/11/2026', 'Check-out': '16/11/2026', Stage: 'Reserved' });
    const r = await call('data', { cookie: owner });
    assert.equal(r.body.bookings.length, 1);
    const b = r.body.bookings[0];
    assert.deepEqual(
      [b.rooms, b.ci, b.co, b.nights, b.price, b.gross, b.discount, b.total, b.balance, b.stage, b.etaMin, b.mobile],
      [[101, 102], '2026-11-12', '2026-11-14', 2, 7000, 14000, 1000, 13000, 12500, 'in', 870, '9812345678'],
    );
    assert.equal(r.body.warnings.length, 3);
    assert.match(r.body.warnings[0], /Bookings row 3 \(BK0002\).*not a date/);
    assert.match(r.body.warnings[1], /stage "Maybe"/);
    assert.match(r.body.warnings[2], /BK0004.*room number is missing/);
  });

  it('never gives a new booking an ID that a row it could not read already uses', async () => {
    raw('Bookings', { 'Booking ID': 'BK0007', 'Guest ID': 'GS0001', 'Guest name': 'Broken', 'Room No': 101, 'Check-in': 'whenever', 'Check-out': 'later', Stage: 'Reserved' });
    const b = await created();
    assert.equal(b.id, 'BK0008');
  });

  it('names the missing column instead of failing mysteriously', async () => {
    g.tabs.Bookings[0] = g.tabs.Bookings[0].map((h) => (h === 'Check-in' ? 'Arrive' : h));
    const r = await call('data', { cookie: owner });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Bookings tab is missing these columns in row 1: Check-in/);
  });

  it('copes with columns in a different order', async () => {
    g.tabs.Rooms = [['Status', 'Rate (₹/night)', 'Type', 'Room No'], ['Cleaning', 3000, 'Suite', 777]];
    const r = await call('data', { cookie: owner });
    assert.deepEqual([r.body.rooms[0].no, r.body.rooms[0].manual, r.body.rooms[0].price, r.body.rooms[0].floor], [777, 'cleaning', 3000, 7]);
  });

  it('turns Google errors into plain advice', async () => {
    g.failNextWith = 403;
    const r = await call('data', { cookie: owner });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Share the sheet with haveli-bot@haveli-test\.iam\.gserviceaccount\.com/);
    delete g.tabs.Guests;
    const r2 = await call('data', { cookie: owner });
    assert.match(r2.body.error, /no tab called "Guests"/);
  });

  it('reads an older sheet, says setup is needed, and refuses to save until the owner has run it', async () => {
    g.makeOld();
    const r = await call('data', { cookie: owner });
    assert.equal(r.status, 200);
    assert.equal(r.body.setupNeeded, true);
    assert.deepEqual(r.body.payments, []);
    const save = await call('booking-create', { cookie: owner, body: newBooking() });
    assert.equal(save.status, 409);
    assert.equal(save.body.code, 'SETUP');
    assert.match(save.body.error, /Set up sheet/);
    assert.equal(g.rows('Bookings').length, 0);
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: 'BK0001', amount: 100 } })).body.code, 'SETUP');
  });
});

/* ---------------------------------------------------------------- creating */

describe('creating bookings', () => {
  it('saves the guest, booking and advance as real dates, text and live formulas', async () => {
    const r = await call('booking-create', { cookie: owner, body: newBooking() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.guestCreated, true);
    const b = r.body.booking;
    assert.deepEqual(
      [b.id, b.guestId, b.rooms, b.nights, b.price, b.discount, b.gross, b.total, b.paid, b.balance, b.stage, b.eta, b.etaMin, b.createdBy, b.updatedBy],
      ['BK0001', 'GS0001', [101], 2, 2800, 0, 5600, 5600, 1000, 4600, 'reserved', '2:00 PM', 840, 'Test Owner', 'Test Owner'],
    );
    assert.deepEqual([r.body.payment.id, r.body.payment.amount, r.body.payment.method, r.body.payment.by], ['PY0001', 1000, 'Cash', 'Test Owner']);

    const guest = g.rows('Guests')[0];
    assert.deepEqual(guest.slice(0, 7), ['GS0001', 'Neha Kulkarni', '9876543210', 'neha@example.com', 'Aadhaar', '4321', 'Pune']);
    assert.equal(typeof guest[2], 'string', 'mobile stays text so Sheets never reformats it');

    assert.equal(typeof cellAt('Bookings', 0, 'Check-in'), 'number', 'check-in is a real date in the sheet');
    assert.equal(cellAt('Bookings', 0, 'Stage'), 'Reserved');
    assert.equal(cellAt('Bookings', 0, 'Room No'), 101);
    assert.equal(cellAt('Bookings', 0, 'Paid (₹)'), 1000);
    assert.equal(cellAt('Bookings', 0, 'Discount (₹)'), 0);
    assert.equal(cellAt('Bookings', 0, 'Created by'), 'Test Owner');
    assert.equal(g.formulas['Bookings!G2'], '=IF(AND(ISNUMBER(E2),ISNUMBER(F2)),F2-E2,"")');
    assert.equal(g.formulas['Bookings!J2'], '=IF(ISNUMBER(G2),MAX(0,G2*H2-N(I2)),"")');
    assert.equal(g.formulas['Bookings!L2'], '=IF(ISNUMBER(J2),J2-N(K2),"")');

    assert.deepEqual(g.rows('Payments')[0].slice(0, 7), ['PY0001', 'BK0001', r.body.payment.at, 1000, 'Cash', 'Test Owner', 'Advance at booking']);
    const data = await call('data', { cookie: owner });
    assert.equal(data.body.bookings[0].total, 5600);
    assert.equal(data.body.bookings[0].mobile, '9876543210');
    assert.equal(data.body.payments.length, 1);
  });

  it('takes the discount off the total and shows what is left to pay', async () => {
    const b = await created({ discount: 500, advance: 1000 });
    assert.deepEqual([b.gross, b.discount, b.total, b.paid, b.balance], [5600, 500, 5100, 1000, 4100]);
    assert.equal(cellAt('Bookings', 0, 'Discount (₹)'), 500);
    const back = (await call('data', { cookie: owner })).body.bookings[0];
    assert.deepEqual([back.gross, back.discount, back.total, back.balance], [5600, 500, 5100, 4100]);
  });

  it('puts several rooms on one booking: the rate is the sum, and the discount comes off the whole stay', async () => {
    const b = await created({ rooms: [101, 102], people: 4, discount: 1000, advance: 0 });
    assert.deepEqual([b.rooms, b.price, b.gross, b.total, b.balance], [[101, 102], 7000, 14000, 13000, 13000]);
    assert.equal(cellAt('Bookings', 0, 'Room No'), '101, 102');
    assert.equal(cellAt('Bookings', 0, 'Rate (₹/night)'), 7000);
    assert.equal(g.rows('Payments').length, 0, 'no advance, no payment row');
    const back = (await call('data', { cookie: owner })).body.bookings[0];
    assert.deepEqual([back.rooms, back.total], [[101, 102], 13000]);
    const three = await call('booking-create', { cookie: owner, body: newBooking({ rooms: [104, 105], mobile: '9000000001', name: 'Big Family', people: 4, advance: 0 }) });
    assert.equal(three.status, 200);
  });

  it('refuses a second booking that clashes on any one of the rooms', async () => {
    await created({ rooms: [101, 102], people: 4 });
    const r = await call('booking-create', { cookie: owner, body: newBooking({ mobile: '9123456780', name: 'Other Person', rooms: [104, 102] }) });
    assert.equal(r.status, 422);
    assert.match(r.body.fields.room, /Room 102 is taken by Neha Kulkarni/);
    const same = await call('booking-create', { cookie: owner, body: newBooking({ mobile: '9123456780', name: 'Other Person', rooms: [101], ci: addDays(TODAY, 2), co: addDays(TODAY, 3) }) });
    assert.equal(same.status, 200, 'arriving the day the last guest leaves is fine');
  });

  it('rejects a discount bigger than the stay and an advance bigger than what is payable, and writes nothing', async () => {
    const d = await call('booking-create', { cookie: owner, body: newBooking({ discount: 5601 }) });
    assert.equal(d.status, 422);
    assert.match(d.body.fields.discount, /cannot be more than the stay total \(₹5,600\)/);
    const a = await call('booking-create', { cookie: owner, body: newBooking({ discount: 600, advance: 5001 }) });
    assert.equal(a.body.fields.adv, 'Advance is more than the amount payable.');
    assert.equal((await call('booking-create', { cookie: owner, body: newBooking({ discount: 'lots' }) })).body.fields.discount.length > 0, true);
    assert.equal((await call('booking-create', { cookie: owner, body: newBooking({ discount: -1 }) })).status, 422);
    assert.equal((await call('booking-create', { cookie: owner, body: newBooking({ advance: 1000, method: 'Barter' }) })).body.fields.method, 'Choose how it was paid.');
    assert.equal(g.rows('Bookings').length + g.rows('Guests').length + g.rows('Payments').length, 0);
  });

  it('reuses a returning guest and fills only blank details', async () => {
    await created({ email: '', city: '' });
    const r = await call('booking-create', { cookie: owner, body: newBooking({ rooms: [102], ci: addDays(TODAY, 5), co: addDays(TODAY, 6), email: 'late@example.com', city: 'Mumbai' }) });
    assert.equal(r.body.guestCreated, false);
    assert.equal(r.body.booking.guestId, 'GS0001');
    assert.equal(r.body.booking.id, 'BK0002');
    assert.equal(g.rows('Guests').length, 1);
    assert.equal(cellAt('Guests', 0, 'Email'), 'late@example.com');
    assert.equal(cellAt('Guests', 0, 'City'), 'Mumbai');
  });

  it('records who took the booking: the signed-in employee, not the owner', async () => {
    const asha = await makeStaff();
    const b = await created({}, asha);
    assert.deepEqual([b.createdBy, b.updatedBy], ['Asha Verma', 'Asha Verma']);
    assert.equal(cellAt('Bookings', 0, 'Created by'), 'Asha Verma');
    assert.equal(cellAt('Bookings', 0, 'Updated by'), 'Asha Verma');
    assert.equal(cellAt('Payments', 0, 'Received by'), 'Asha Verma');
  });

  it('stops anything typed into a field from becoming a formula', async () => {
    const evil = '=HYPERLINK("http://evil.example","click")';
    await call('booking-create', { cookie: owner, body: newBooking({ name: evil, notes: '+1+1', city: '@SUM(1)', email: '-x@y.in' }) });
    assert.equal(cellAt('Guests', 0, 'Name'), evil);
    assert.equal(cellAt('Bookings', 0, 'Guest name'), evil);
    assert.equal(cellAt('Bookings', 0, 'Notes'), '+1+1');
    assert.equal(Object.keys(g.formulas).some((k) => /^(Guests|Bookings|Payments)!(B|C|D|G|Q|R|S)\d/.test(k) && !/^Bookings!(G|J|L)\d/.test(k)), false);
    const pay = await call('booking-payment', { cookie: owner, body: { id: 'BK0001', amount: 100, method: 'Cash', note: '=1+1' } });
    assert.equal(pay.status, 200);
    assert.equal(cellAt('Payments', 1, 'Note'), '=1+1');
    assert.equal(Object.keys(g.formulas).some((k) => k.startsWith('Payments!')), false);
  });

  it('explains each mistake and writes nothing', async () => {
    const r = await call('booking-create', { cookie: owner, body: newBooking({ mobile: '123', rooms: [103], co: TODAY }) });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.mob && r.body.fields.out);
    const m = await call('booking-create', { cookie: owner, body: newBooking({ rooms: [103] }) });
    assert.equal(m.body.fields.room, 'Room 103 is under maintenance.');
    assert.equal((await call('booking-create', { cookie: owner, body: newBooking({ rooms: 'abc' }) })).body.fields.room, 'Choose at least one room.');
    assert.equal((await call('booking-create', { cookie: owner, body: newBooking({ rooms: [101, 'x', 5.5] }) })).status, 422);
    assert.equal(g.rows('Bookings').length, 0);
    assert.equal(g.rows('Guests').length, 0);
  });
});

/* ----------------------------------------------------------------- editing */

describe('editing a booking that was saved wrongly', () => {
  it('fixes the guest name, mobile and details in place', async () => {
    const b = await created();
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { name: 'Neha Kulkarni-Rao', mobile: '9876500000', email: 'neha.rao@example.com', city: 'Mumbai', notes: 'Late arrival' }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.booking.guest, r.body.booking.mobile, r.body.booking.notes, r.body.guest.mobile], ['Neha Kulkarni-Rao', '9876500000', 'Late arrival', '9876500000']);
    assert.equal(g.rows('Guests').length, 1, 'the same guest row was corrected, not duplicated');
    assert.deepEqual([cellAt('Guests', 0, 'Name'), cellAt('Guests', 0, 'Mobile'), cellAt('Guests', 0, 'City'), cellAt('Bookings', 0, 'Guest name'), cellAt('Bookings', 0, 'Notes')], ['Neha Kulkarni-Rao', '9876500000', 'Mumbai', 'Neha Kulkarni-Rao', 'Late arrival']);
    assert.equal(r.body.booking.paid, 1000, 'what was paid is untouched');
  });

  it('moves the booking to another guest when the mobile is that of an existing guest', async () => {
    await created({ mobile: '9000000001', name: 'First Guest', rooms: [104] });
    const b = await created({ mobile: '9000000002', name: 'Second Guest' });
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { name: 'First Guest', mobile: '9000000001' }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.booking.guestId, 'GS0001');
  });

  it('records who made the change', async () => {
    const b = await created();
    const asha = await makeStaff();
    await call('booking-update', { cookie: asha, body: editBody(b.id, { notes: 'Fixed' }) });
    assert.equal(cellAt('Bookings', 0, 'Created by'), 'Test Owner');
    assert.equal(cellAt('Bookings', 0, 'Updated by'), 'Asha Verma');
  });

  it('changes the dates and the totals follow', async () => {
    const b = await created();
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { co: addDays(TODAY, 3) }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.booking.nights, r.body.booking.total, r.body.booking.balance], [3, 8400, 7400]);
    assert.equal(cellAt('Bookings', 0, 'Check-out') as number, (cellAt('Bookings', 0, 'Check-in') as number) + 3);
    assert.equal(g.formulas['Bookings!J2'], '=IF(ISNUMBER(G2),MAX(0,G2*H2-N(I2)),"")');
  });

  it('adds and removes rooms, repricing from the current room rates', async () => {
    const b = await created({ people: 2 });
    const add = await call('booking-update', { cookie: owner, body: editBody(b.id, { rooms: [101, 102], people: 4 }) });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    assert.deepEqual([add.body.booking.rooms, add.body.booking.price, add.body.booking.total], [[101, 102], 7000, 14000]);
    assert.equal(cellAt('Bookings', 0, 'Room No'), '101, 102');
    const less = await call('booking-update', { cookie: owner, body: editBody(b.id, { rooms: [102], people: 2 }) });
    assert.deepEqual([less.body.booking.rooms, less.body.booking.price, less.body.booking.total], [[102], 4200, 8400]);
    assert.equal(cellAt('Bookings', 0, 'Room No'), 102);
  });

  it('keeps the booked rate when the rooms stay the same, even if the room rate changed since', async () => {
    const b = await created();
    g.tabs.Rooms[1][6] = 3500; // room 101 is now 3,500
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { notes: 'x' }) });
    assert.deepEqual([r.body.booking.price, r.body.booking.total], [2800, 5600]);
  });

  it('changes the discount', async () => {
    const b = await created();
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { discount: 500 }) });
    assert.deepEqual([r.body.booking.discount, r.body.booking.total, r.body.booking.balance], [500, 5100, 4100]);
    assert.equal(cellAt('Bookings', 0, 'Discount (₹)'), 500);
    const gone = await call('booking-update', { cookie: owner, body: editBody(b.id, { discount: 0 }) });
    assert.equal(gone.body.booking.total, 5600);
  });

  it('will not let the total fall below what has already been paid', async () => {
    const b = await created({ advance: 5000 });
    const d = await call('booking-update', { cookie: owner, body: editBody(b.id, { discount: 1000 }) });
    assert.equal(d.status, 422);
    assert.match(d.body.fields.discount, /already paid ₹5,000, which is more than the new total ₹4,600/);
    const shorter = await call('booking-update', { cookie: owner, body: editBody(b.id, { co: addDays(TODAY, 1) }) });
    assert.equal(shorter.status, 422);
    assert.equal(cellAt('Bookings', 0, 'Discount (₹)'), 0);
  });

  it('does not clash with itself, but does clash with other bookings', async () => {
    const b = await created();
    const other = await created({ mobile: '9000000003', name: 'Rohan', rooms: [102], ci: TODAY, co: addDays(TODAY, 2) });
    assert.equal((await call('booking-update', { cookie: owner, body: editBody(b.id) })).status, 200);
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { rooms: [101, 102], people: 4 }) });
    assert.equal(r.status, 422);
    assert.match(r.body.fields.room, /Room 102 is taken by Rohan/);
    assert.ok(other.id);
  });

  it('checks the form like a new booking and keeps text from becoming formulas', async () => {
    const b = await created();
    const bad = await call('booking-update', { cookie: owner, body: editBody(b.id, { mobile: '1', name: '' }) });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.fields.mob && bad.body.fields.name);
    await call('booking-update', { cookie: owner, body: editBody(b.id, { name: '=1+1', notes: '@x' }) });
    assert.equal(cellAt('Bookings', 0, 'Guest name'), '=1+1');
    assert.equal(cellAt('Guests', 0, 'Name'), '=1+1');
    assert.equal(Object.keys(g.formulas).some((k) => /^Guests!/.test(k)), false);
  });

  it('answers 404 for an unknown booking and refuses to edit a cancelled one', async () => {
    assert.equal((await call('booking-update', { cookie: owner, body: editBody('BK9999') })).status, 404);
    assert.equal((await call('booking-update', { cookie: owner, body: { ...editBody('x'), id: '' } })).status, 400);
    const b = await created();
    await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'cancelled' } });
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { notes: 'late' }) });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /cancelled/);
  });

  it('lets a finished stay get its details, notes and discount fixed, but not its dates or rooms', async () => {
    const b = await created({ advance: 0 });
    await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in' } });
    await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'out' } });
    const ok = await call('booking-update', { cookie: owner, body: editBody(b.id, { name: 'Neha K', notes: 'Paid on the spot', discount: 300, ci: b.ci, co: b.co }) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.booking.stage, ok.body.booking.total], ['out', 5300]);
    for (const change of [{ co: addDays(TODAY, 3) }, { ci: addDays(TODAY, -1) }, { rooms: [102], people: 2 }]) {
      const r = await call('booking-update', { cookie: owner, body: editBody(b.id, change) });
      assert.equal(r.status, 409, JSON.stringify(change));
      assert.match(r.body.error, /dates and rooms of a stay that has finished/);
    }
  });

  it('moves a guest who is already in: the rooms they leave go to cleaning', async () => {
    const b = await created({ rooms: [101], advance: 0 });
    await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in' } });
    const r = await call('booking-update', { cookie: owner, body: editBody(b.id, { rooms: [102], people: 2 }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.rooms.map((x: any) => [x.no, x.manual]), [[101, 'cleaning']]);
    assert.equal(cellAt('Rooms', 0, 'Status'), 'Cleaning');
    const data = (await call('data', { cookie: owner })).body;
    assert.equal(data.bookings[0].rooms[0], 102);
    const blocked = await call('booking-update', { cookie: owner, body: editBody(b.id, { rooms: [102, 103] }) });
    assert.equal(blocked.status, 422, 'a room under maintenance cannot be added');
  });
});

/* ---------------------------------------------- stages, rooms and payments */

describe('stages, rooms and payments', () => {
  it('checks in, checks out and sends the room to cleaning, then Undo restores it', async () => {
    const b = await created();
    const inn = await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in' } });
    assert.equal(inn.status, 200, JSON.stringify(inn.body));
    assert.equal(cellAt('Bookings', 0, 'Stage'), 'Checked in');
    assert.deepEqual(inn.body.rooms, []);
    assert.equal(inn.body.booking.updatedBy, 'Test Owner');

    const out = await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'out' } });
    assert.deepEqual(out.body.rooms.map((r: any) => [r.no, r.manual]), [[101, 'cleaning']]);
    assert.equal(cellAt('Rooms', 0, 'Status'), 'Cleaning');

    const undo = await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in', restore: { 101: 'available' } } });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.equal(cellAt('Rooms', 0, 'Status'), 'Available');
    assert.equal(cellAt('Bookings', 0, 'Stage'), 'Checked in');
    assert.match(String(cellAt('Bookings', 0, 'Updated at')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('checks a family in and out as one booking: every room moves together', async () => {
    const b = await created({ rooms: [101, 102, 104], people: 6, advance: 0 });
    const inn = await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in' } });
    assert.equal(inn.status, 200, JSON.stringify(inn.body));
    const states = (await call('data', { cookie: owner })).body;
    assert.equal(states.bookings[0].stage, 'in');
    const out = await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'out' } });
    assert.deepEqual(out.body.rooms.map((r: any) => [r.no, r.manual]), [[101, 'cleaning'], [102, 'cleaning'], [104, 'cleaning']]);
    assert.deepEqual([cellAt('Rooms', 0, 'Status'), cellAt('Rooms', 1, 'Status'), cellAt('Rooms', 3, 'Status')], ['Cleaning', 'Cleaning', 'Cleaning']);
    const undo = await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in', restore: { 101: 'available', 102: 'available', 104: 'available' } } });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.deepEqual([cellAt('Rooms', 0, 'Status'), cellAt('Rooms', 1, 'Status'), cellAt('Rooms', 3, 'Status')], ['Available', 'Available', 'Available']);
  });

  it('refuses check-in if any one room of the booking is under maintenance, and unknown stages', async () => {
    raw('Guests', { 'Guest ID': 'GS0009', Name: 'X Guest', Mobile: '9000000009' });
    raw('Bookings', { 'Booking ID': 'BK0009', 'Guest ID': 'GS0009', 'Guest name': 'X Guest', 'Room No': '101, 103', 'Check-in': TODAY, 'Check-out': addDays(TODAY, 1), 'Rate (₹/night)': 5600, 'Paid (₹)': 0, Source: 'Direct', Stage: 'Reserved' });
    const r = await call('booking-stage', { cookie: owner, body: { id: 'BK0009', to: 'in' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Room 103 is under maintenance.');
    assert.equal((await call('booking-stage', { cookie: owner, body: { id: 'BK0009', to: 'flying' } })).status, 400);
    assert.equal((await call('booking-stage', { cookie: owner, body: { id: 'BK0404', to: 'in' } })).status, 404);
  });

  it('changes room status but not under a guest', async () => {
    const ok = await call('room-status', { cookie: owner, body: { no: 102, status: 'maintenance' } });
    assert.equal(ok.body.room.manual, 'maintenance');
    assert.equal(cellAt('Rooms', 1, 'Status'), 'Maintenance');
    const b = await created({ rooms: [101, 104], people: 4 });
    await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'in' } });
    const blocked = await call('room-status', { cookie: owner, body: { no: 104, status: 'cleaning' } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'Check out the guest in room 104 first.');
    assert.equal((await call('room-status', { cookie: owner, body: { no: 999, status: 'cleaning' } })).status, 404);
    assert.equal((await call('room-status', { cookie: owner, body: { no: 101, status: 'occupied' } })).status, 400);
  });

  it('records payments with how they were paid and who took them; Paid always equals the sum of the payments', async () => {
    const b = await created();
    const asha = await makeStaff();
    const p = await call('booking-payment', { cookie: asha, body: { id: b.id, amount: 2000, method: 'UPI', note: 'GPay' } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual([p.body.booking.paid, p.body.booking.balance], [3000, 2600]);
    assert.deepEqual([p.body.payment.id, p.body.payment.amount, p.body.payment.method, p.body.payment.by, p.body.payment.note], ['PY0002', 2000, 'UPI', 'Asha Verma', 'GPay']);
    await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 600 } });
    assert.equal(cellAt('Bookings', 0, 'Paid (₹)'), 3600);
    assert.equal(cellAt('Payments', 2, 'Method'), 'Cash', 'cash is the default way');
    const data = (await call('data', { cookie: owner })).body;
    const ledger = data.payments.filter((x: any) => x.bookingId === b.id).reduce((s: number, x: any) => s + x.amount, 0);
    assert.equal(ledger, 3600);
    assert.equal(data.bookings[0].paid, ledger);
    assert.match(data.payments[0].at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('refuses overpaying, bad amounts and bad methods, and writes nothing', async () => {
    const b = await created();
    const over = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 4601 } });
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'Only ₹4,600 is due.');
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 'lots' } })).status, 409);
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 0 } })).status, 409);
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 100.5 } })).status, 409);
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 100, method: 'Barter' } })).body.error, 'Choose how it was paid.');
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: 'BK9999', amount: 100 } })).status, 404);
    assert.equal(g.rows('Payments').length, 1);
    assert.equal(cellAt('Bookings', 0, 'Paid (₹)'), 1000);
  });

  it('collects the amount after the discount, not before', async () => {
    const b = await created({ discount: 600, advance: 0 });
    assert.equal(b.total, 5000);
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 5001 } })).body.error, 'Only ₹5,000 is due.');
    const ok = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 5000 } });
    assert.deepEqual([ok.body.booking.paid, ok.body.booking.balance], [5000, 0]);
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 1 } })).body.error, 'This booking is already fully paid.');
  });

  it('gives money back as a negative payment, with a reason, never more than was paid', async () => {
    const b = await created({ advance: 3000 });
    const noReason = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: -500, method: 'Cash' } });
    assert.equal(noReason.status, 409);
    assert.equal(noReason.body.error, 'Write a short reason for the refund.');
    const ok = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: -500, method: 'UPI', note: 'Guest left a day early' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.booking.paid, ok.body.booking.balance, ok.body.payment.amount], [2500, 3100, -500]);
    assert.equal(cellAt('Payments', 1, 'Amount (₹)'), -500);
    assert.equal(cellAt('Bookings', 0, 'Paid (₹)'), 2500);
    const viaMethod = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: -100, method: 'Refund' } });
    assert.equal(viaMethod.status, 200);
    assert.equal(viaMethod.body.booking.paid, 2400);
    const tooMuch = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: -2401, method: 'Refund' } });
    assert.equal(tooMuch.body.error, 'Only ₹2,400 has been paid, so that is the most you can refund.');
    const data = (await call('data', { cookie: owner })).body;
    assert.equal(data.payments.reduce((s: number, x: any) => s + x.amount, 0), data.bookings[0].paid);
  });

  it('allows a refund on a cancelled booking but no new payment', async () => {
    const b = await created({ advance: 2000 });
    await call('booking-stage', { cookie: owner, body: { id: b.id, to: 'cancelled' } });
    assert.equal((await call('booking-payment', { cookie: owner, body: { id: b.id, amount: 100, method: 'Cash' } })).status, 409);
    const r = await call('booking-payment', { cookie: owner, body: { id: b.id, amount: -2000, method: 'Refund', note: 'Cancelled' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.booking.paid, 0);
  });

  it('adds a room that copies bed, sleeps and rate from its type', async () => {
    const r = await call('room-create', { cookie: owner, body: { no: 201, floor: 2, type: 'Deluxe' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.room.id, r.body.room.price, r.body.room.manual], ['RM0006', 4200, 'available']);
    assert.deepEqual(g.rows('Rooms')[5].slice(1, 8), [201, 2, 'Deluxe', 'Double', 2, 4200, 'Available']);
    const dup = await call('room-create', { cookie: owner, body: { no: 201, floor: 2, type: 'Deluxe' } });
    assert.equal(dup.status, 422);
    assert.equal(dup.body.fields.no, 'Room 201 already exists.');
    assert.equal((await call('room-create', { cookie: owner, body: { no: 202, floor: 2, type: 'Palace' } })).body.fields.type.length > 0, true);
  });
});

/* ---------------------------------------------------- bulk rooms and setup */

describe('generating rooms (owner quick start)', () => {
  it('adds floor x rooms-per-floor rooms, skipping ones that exist, using the given rate', async () => {
    const r = await call('rooms-generate', { cookie: owner, body: { floors: 2, perFloor: 3, rate: 3200, type: 'Standard' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.added, r.body.skipped], [3, 3]); // 101,102,103 already exist; adds 201,202,203
    assert.deepEqual(r.body.rooms.map((x: any) => x.no), [201, 202, 203]);
    assert.equal(r.body.added, 3);
  });

  it('numbers rooms floor*100+n, copies bed and sleeps from the type, and gives ids in order', async () => {
    g.tabs.Rooms = [g.tabs.Rooms[0]];
    const r = await call('rooms-generate', { cookie: owner, body: { floors: 3, perFloor: 2, rate: 2500, type: 'Deluxe' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.rooms.map((x: any) => [x.id, x.no, x.floor, x.type, x.bed, x.cap, x.price, x.manual]), [
      ['RM0001', 101, 1, 'Deluxe', 'Queen', 3, 2500, 'available'],
      ['RM0002', 102, 1, 'Deluxe', 'Queen', 3, 2500, 'available'],
      ['RM0003', 201, 2, 'Deluxe', 'Queen', 3, 2500, 'available'],
      ['RM0004', 202, 2, 'Deluxe', 'Queen', 3, 2500, 'available'],
      ['RM0005', 301, 3, 'Deluxe', 'Queen', 3, 2500, 'available'],
      ['RM0006', 302, 3, 'Deluxe', 'Queen', 3, 2500, 'available'],
    ]);
    assert.equal(g.rows('Rooms').length, 6);
    assert.deepEqual(g.rows('Rooms')[2].slice(0, 9), ['RM0003', 201, 2, 'Deluxe', 'Queen', 3, 2500, 'Available', '']);
    const data = (await call('data', { cookie: owner })).body;
    assert.equal(data.rooms.length, 6);
  });

  it('is safe to run twice', async () => {
    const body = { floors: 2, perFloor: 4, rate: 3000, type: 'Standard' };
    const a = await call('rooms-generate', { cookie: owner, body });
    const b = await call('rooms-generate', { cookie: owner, body });
    assert.equal(a.status, 200);
    assert.deepEqual([b.body.added, b.body.skipped], [0, 8]);
    assert.equal(g.rows('Rooms').length, 8 + 1, 'floor 1: 101-104 exist (5 incl. 105); floor 2 adds 4');
  });

  it('checks every number and says what is wrong', async () => {
    for (const [body, key] of [
      [{ floors: 0, perFloor: 5, rate: 2000 }, 'floors'],
      [{ floors: 10, perFloor: 5, rate: 2000 }, 'floors'],
      [{ floors: 'x', perFloor: 5, rate: 2000 }, 'floors'],
      [{ floors: 2, perFloor: 0, rate: 2000 }, 'perFloor'],
      [{ floors: 2, perFloor: 31, rate: 2000 }, 'perFloor'],
      [{ floors: 2, perFloor: 5, rate: 99 }, 'rate'],
      [{ floors: 2, perFloor: 5, rate: 200001 }, 'rate'],
      [{ floors: 2, perFloor: 5, rate: 2000.5 }, 'rate'],
      [{ floors: 2, perFloor: 5, rate: 2000, type: 'Palace' }, 'type'],
    ] as const) {
      const r = await call('rooms-generate', { cookie: owner, body });
      assert.equal(r.status, 422, JSON.stringify(body));
      assert.ok(r.body.fields[key], `${key} for ${JSON.stringify(body)}`);
    }
    assert.equal(g.rows('Rooms').length, 5);
    const edge = await call('rooms-generate', { cookie: owner, body: { floors: 9, perFloor: 30, rate: 200000 } });
    assert.equal(edge.status, 200);
    assert.equal(edge.body.added + edge.body.skipped, 270);
  });

  it('needs the owner, and the sheet to be set up', async () => {
    const asha = await makeStaff();
    assert.equal((await call('rooms-generate', { cookie: asha, body: { floors: 1, perFloor: 2, rate: 2000 } })).status, 403);
    assert.equal((await call('rooms-generate', { body: { floors: 1, perFloor: 2, rate: 2000 } })).status, 401);
    g.makeOld();
    const r = await call('rooms-generate', { cookie: owner, body: { floors: 1, perFloor: 2, rate: 2000 } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SETUP');
  });
});

describe('one-click sheet setup', () => {
  it('adds the missing tabs and columns, and keeps every existing row', async () => {
    g.makeOld();
    await call('rooms-generate', { cookie: owner, body: { floors: 1, perFloor: 1, rate: 2000 } }).catch(() => undefined);
    const before = await call('health', { cookie: owner });
    assert.equal(before.body.setupNeeded, true);
    assert.equal(before.body.ok, false);

    const r = await call('sheet-setup', { cookie: owner, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.changes.includes('Added the Payments tab'));
    assert.ok(r.body.changes.includes('Added the Staff tab'));
    assert.ok(r.body.changes.some((c: string) => /Added columns to Bookings: Discount \(₹\), Created by, Updated by/.test(c)), r.body.changes.join(' | '));
    assert.deepEqual(g.tabs.Payments[0], ['Payment ID', 'Booking ID', 'Date', 'Amount (₹)', 'Method', 'Received by', 'Note']);
    assert.deepEqual(g.tabs.Staff[0], ['Username', 'Name', 'Role', 'Password hash', 'Active', 'Created at']);
    assert.equal(g.rows('Rooms').length, 5, 'rooms are untouched');

    const data = await call('data', { cookie: owner });
    assert.equal(data.body.setupNeeded, false);
    const after = await call('health', { cookie: owner });
    assert.equal(after.body.setupNeeded, false);
    assert.equal(after.body.ok, true, JSON.stringify(after.body.checks));
    const save = await call('booking-create', { cookie: owner, body: newBooking() });
    assert.equal(save.status, 200, JSON.stringify(save.body));
  });

  it('is safe to run again: nothing more is added', async () => {
    g.makeOld();
    await call('sheet-setup', { cookie: owner, body: {} });
    const snapshot = JSON.stringify(g.tabs);
    const again = await call('sheet-setup', { cookie: owner, body: {} });
    assert.deepEqual(again.body.changes, []);
    assert.equal(JSON.stringify(g.tabs), snapshot);
  });

  it('sets up a brand-new empty spreadsheet from nothing', async () => {
    g.tabs = {};
    const r = await call('sheet-setup', { cookie: owner, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(g.tabs).sort(), ['Bookings', 'Guests', 'Payments', 'Rooms', 'Staff']);
    assert.equal((g.tabs.Rooms[0] as string[])[1], 'Room No');
    assert.ok((g.tabs.Bookings[0] as string[]).includes('Discount (₹)'));
    const gen = await call('rooms-generate', { cookie: owner, body: { floors: 2, perFloor: 2, rate: 2000 } });
    assert.equal(gen.body.added, 4);
    const b = await call('booking-create', { cookie: owner, body: newBooking({ advance: 0 }) });
    assert.equal(b.status, 200, JSON.stringify(b.body));
  });

  it('adds only the missing column when one is left out', async () => {
    g.tabs.Bookings[0] = g.tabs.Bookings[0].filter((h) => h !== 'Updated by');
    const r = await call('sheet-setup', { cookie: owner, body: {} });
    assert.deepEqual(r.body.changes, ['Added columns to Bookings: Updated by']);
  });
});

/* ------------------------------------------------------------- connection */

describe('connection check', () => {
  it('passes on a healthy sheet and explains a broken one, for the owner only', async () => {
    const ok = await call('health', { cookie: owner });
    assert.equal(ok.body.ok, true, JSON.stringify(ok.body.checks));
    assert.equal(ok.body.sheetTitle, 'Haveli (test)');
    assert.deepEqual(ok.body.counts, { rooms: 5, guests: 0, bookings: 0 });
    assert.equal(JSON.stringify(ok.body).includes('PRIVATE KEY'), false);
    g.tabs.Rooms[0] = ['Number', 'Kind'];
    const bad = await call('health', { cookie: owner });
    assert.equal(bad.body.ok, false);
    assert.match(bad.body.checks.find((c: any) => c.name === 'Rooms columns').detail, /Missing in row 1: Room No, Type, Rate \(₹\/night\), Status/);
    const asha = await makeStaff();
    assert.equal((await call('health', { cookie: asha })).status, 403);
  });

  it('says which tab is missing', async () => {
    delete g.tabs.Payments;
    const r = await call('health', { cookie: owner });
    assert.equal(r.body.setupNeeded, true);
    assert.match(r.body.checks.find((c: any) => c.name === 'Tabs').detail, /Missing tab\(s\): Payments/);
  });
});

/* ------------------------------------------------------------ concurrency */

describe('two people saving at once', () => {
  it('never double-books a room', async () => {
    const [a, b] = await Promise.all([
      call('booking-create', { cookie: owner, body: newBooking({ name: 'First Guest', mobile: '9000000001' }) }),
      call('booking-create', { cookie: owner, body: newBooking({ name: 'Second Guest', mobile: '9000000002' }) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 422]);
    assert.equal(g.rows('Bookings').length, 1);
  });

  it('never double-books a room that only overlaps on one of several', async () => {
    const [a, b] = await Promise.all([
      call('booking-create', { cookie: owner, body: newBooking({ name: 'First Guest', mobile: '9000000001', rooms: [101, 102], people: 4 }) }),
      call('booking-create', { cookie: owner, body: newBooking({ name: 'Second Guest', mobile: '9000000002', rooms: [102, 104], people: 4 }) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 422]);
  });

  it('gives different booking and payment IDs to bookings made at the same moment', async () => {
    const [a, b] = await Promise.all([
      call('booking-create', { cookie: owner, body: newBooking({ name: 'First Guest', mobile: '9000000001', rooms: [101] }) }),
      call('booking-create', { cookie: owner, body: newBooking({ name: 'Second Guest', mobile: '9000000002', rooms: [102] }) }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(new Set(g.rows('Bookings').map((r) => r[0])).size, 2);
    assert.equal(new Set(g.rows('Payments').map((r) => r[0])).size, 2);
  });

  it('adds up two payments made at the same moment', async () => {
    const b = await created({ advance: 0 });
    const [x, y] = await Promise.all([
      call('booking-payment', { cookie: owner, body: { id: b.id, amount: 1000 } }),
      call('booking-payment', { cookie: owner, body: { id: b.id, amount: 1500 } }),
    ]);
    assert.equal(x.status + y.status, 400);
    assert.equal(cellAt('Bookings', 0, 'Paid (₹)'), 2500);
  });
});
