import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createToken, verifyToken } from '../api/_lib/session';
import { addDays, todayInZone } from '../shared/dates';
import { FakeGoogle } from './helpers/fakeGoogle';
import { PASSWORD, SECRET, call, setEnv, signIn } from './helpers/harness';

const TODAY = todayInZone('Asia/Kolkata');
let g: FakeGoogle;
let cookie: string;

function newBooking(over: Record<string, unknown> = {}) {
  return {
    name: 'Neha Kulkarni', mobile: '9876543210', source: 'Direct', ci: TODAY, co: addDays(TODAY, 2), room: 101,
    advance: 1000, people: 2, eta: '14:00', email: 'neha@example.com', city: 'Pune', idType: 'Aadhaar', idLast4: '4321', notes: '',
    ...over,
  };
}

beforeEach(async () => {
  g = new FakeGoogle();
  g.install();
  setEnv(g);
  g.addRoom(101);
  g.addRoom(102, 'Deluxe', 'Available', 4200);
  g.addRoom(103, 'Standard', 'Maintenance');
  cookie = await signIn();
});
afterEach(() => g.uninstall());

describe('sign-in', () => {
  it('reports setup problems by name only, never by value', async () => {
    setEnv(g, { SHEET_ID: undefined, APP_PASSWORD: 'short' });
    const r = await call('session');
    assert.equal(r.body.configured, false);
    assert.deepEqual(r.body.missing, ['SHEET_ID', 'APP_PASSWORD (use at least 8 characters)']);
    assert.equal(JSON.stringify(r.body).includes(PASSWORD), false);
    assert.equal((await call('login', { body: { password: 'x' } })).status, 503);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    const bad = await call('login', { body: { password: 'nope' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers['set-cookie'], undefined);
    const ok = await call('login', { body: { password: PASSWORD } });
    assert.equal(ok.status, 200);
    const setCookie = String(ok.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Secure/);
    assert.equal(ok.body.staff.name, 'Test Staff');
  });

  it('locks out an address after repeated wrong passwords', async () => {
    for (let i = 0; i < 8; i++) await call('login', { body: { password: 'wrong' }, ip: '203.0.113.9' });
    const r = await call('login', { body: { password: PASSWORD }, ip: '203.0.113.9' });
    assert.equal(r.status, 429);
    assert.equal((await call('login', { body: { password: PASSWORD }, ip: '203.0.113.10' })).status, 200);
  });

  it('keeps data private without a valid cookie', async () => {
    assert.equal((await call('data')).status, 401);
    assert.equal((await call('data', { cookie: 'haveli_session=v1.9999999999.forged' })).status, 401);
    assert.equal((await call('data', { cookie })).status, 200);
    const s = await call('session', { cookie });
    assert.equal(s.body.authenticated, true);
  });

  it('refuses changes that lack the anti-forgery header', async () => {
    const r = await call('room-status', { cookie, noCsrf: true, body: { no: 101, status: 'cleaning' } });
    assert.equal(r.status, 403);
  });

  it('signed tokens expire and cannot be tampered with', () => {
    const t = createToken(SECRET, 1_000_000);
    assert.equal(verifyToken(SECRET, t, 2_000_000), true);
    assert.equal(verifyToken(SECRET, t, 1_000_000 + 15 * 24 * 3600 * 1000), false);
    assert.equal(verifyToken('another-secret-another-secret!!', t, 2_000_000), false);
    assert.equal(verifyToken(SECRET, t.replace('v1.', 'v1.9'), 2_000_000), false);
  });
});

describe('reading the sheet', () => {
  it('returns rooms with the right types and today in the hotel time zone', async () => {
    const r = await call('data', { cookie });
    assert.equal(r.body.mode, 'live');
    assert.equal(r.body.today, TODAY);
    assert.equal(r.body.rooms.length, 3);
    assert.deepEqual(r.body.rooms[1], { id: 'RM0002', no: 102, floor: 1, type: 'Deluxe', bed: 'Double', cap: 2, price: 4200, manual: 'available', notes: '' });
    assert.equal(r.body.rooms[2].manual, 'maintenance');
    assert.equal(r.body.rooms[0].row, undefined, 'internal row numbers never leave the server');
  });

  it('understands rows typed by hand and reports rows it cannot read', async () => {
    g.addRawRow('Guests', ['GS0001', 'Old Guest', 9812345678, '', '', '', '', '']);
    g.addRawRow('Bookings', ['BK0001', 'GS0001', 'Old Guest', 101, '12/11/2026', '14/11/2026', '', 2800, '', 500, '', 'Walk-in', 'checked in', '', '2:30 PM', '', '', '']);
    g.addRawRow('Bookings', ['BK0002', 'GS0001', 'Old Guest', 101, 'sometime', '14/11/2026', '', 2800, '', 0, '', 'Direct', 'Reserved', '', '', '', '', '']);
    g.addRawRow('Bookings', ['BK0003', 'GS0001', 'Old Guest', 102, '15/11/2026', '16/11/2026', '', 4200, '', 0, '', 'Direct', 'Maybe', '', '', '', '', '']);
    const r = await call('data', { cookie });
    assert.equal(r.body.bookings.length, 1);
    const b = r.body.bookings[0];
    assert.deepEqual([b.ci, b.co, b.nights, b.total, b.balance, b.stage, b.etaMin, b.mobile], ['2026-11-12', '2026-11-14', 2, 5600, 5100, 'in', 870, '9812345678']);
    assert.equal(r.body.warnings.length, 2);
    assert.match(r.body.warnings[0], /Bookings row 3 \(BK0002\).*not a date/);
    assert.match(r.body.warnings[1], /stage "Maybe"/);
  });

  it('names the missing column instead of failing mysteriously', async () => {
    g.tabs.Bookings[0] = g.tabs.Bookings[0].map((h) => (h === 'Check-in' ? 'Arrive' : h));
    const r = await call('data', { cookie });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Bookings tab is missing these columns in row 1: Check-in/);
  });

  it('copes with columns in a different order', async () => {
    g.tabs.Rooms = [['Status', 'Rate (₹/night)', 'Type', 'Room No'], ['Cleaning', 3000, 'Suite', 777]];
    const r = await call('data', { cookie });
    assert.deepEqual([r.body.rooms[0].no, r.body.rooms[0].manual, r.body.rooms[0].price, r.body.rooms[0].floor], [777, 'cleaning', 3000, 7]);
  });

  it('turns Google errors into plain advice', async () => {
    g.failNextWith = 403;
    const r = await call('data', { cookie });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /Share the sheet with haveli-bot@haveli-test\.iam\.gserviceaccount\.com/);
    delete g.tabs.Guests;
    const r2 = await call('data', { cookie });
    assert.match(r2.body.error, /no tab called "Guests"/);
  });
});

describe('creating bookings', () => {
  it('saves the guest and booking as real dates, text and live formulas', async () => {
    const r = await call('booking-create', { cookie, body: newBooking() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.guestCreated, true);
    const b = r.body.booking;
    assert.deepEqual([b.id, b.guestId, b.nights, b.price, b.total, b.paid, b.balance, b.stage, b.eta, b.etaMin], ['BK0001', 'GS0001', 2, 2800, 5600, 1000, 4600, 'reserved', '2:00 PM', 840]);

    const guest = g.rows('Guests')[0];
    assert.deepEqual(guest.slice(0, 7), ['GS0001', 'Neha Kulkarni', '9876543210', 'neha@example.com', 'Aadhaar', '4321', 'Pune']);
    assert.equal(typeof guest[2], 'string', 'mobile stays text so Sheets never reformats it');

    const row = g.rows('Bookings')[0];
    assert.equal(typeof row[4], 'number', 'check-in is a real date in the sheet');
    assert.equal(row[12], 'Reserved');
    assert.equal(row[9], 1000);
    assert.equal(g.formulas['Bookings!G2'], '=IF(AND(ISNUMBER(E2),ISNUMBER(F2)),F2-E2,"")');
    assert.equal(g.formulas['Bookings!I2'], '=IF(ISNUMBER(G2),G2*H2,"")');
    assert.equal(g.formulas['Bookings!K2'], '=IF(ISNUMBER(I2),I2-N(J2),"")');

    const data = await call('data', { cookie });
    assert.equal(data.body.bookings[0].total, 5600);
    assert.equal(data.body.bookings[0].mobile, '9876543210');
  });

  it('reuses a returning guest and fills only blank details', async () => {
    await call('booking-create', { cookie, body: newBooking({ email: '', city: '' }) });
    const r = await call('booking-create', { cookie, body: newBooking({ room: 102, ci: addDays(TODAY, 5), co: addDays(TODAY, 6), email: 'late@example.com', city: 'Mumbai' }) });
    assert.equal(r.body.guestCreated, false);
    assert.equal(r.body.booking.guestId, 'GS0001');
    assert.equal(r.body.booking.id, 'BK0002');
    assert.equal(g.rows('Guests').length, 1);
    assert.equal(g.rows('Guests')[0][3], 'late@example.com');
    assert.equal(g.rows('Guests')[0][6], 'Mumbai');
  });

  it('stops anything typed into a field from becoming a formula', async () => {
    const evil = '=HYPERLINK("http://evil.example","click")';
    await call('booking-create', { cookie, body: newBooking({ name: evil, notes: '+1+1' }) });
    assert.equal(g.rows('Guests')[0][1], evil);
    assert.equal(g.rows('Bookings')[0][2], evil);
    assert.equal(g.rows('Bookings')[0][15], '+1+1');
    assert.equal(Object.keys(g.formulas).some((k) => /^(Guests|Bookings)!(B|C|P)\d/.test(k)), false);
  });

  it('explains each mistake and writes nothing', async () => {
    const r = await call('booking-create', { cookie, body: newBooking({ mobile: '123', room: 103, co: TODAY }) });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.mob && r.body.fields.room && r.body.fields.out);
    assert.equal(g.rows('Bookings').length, 0);
    assert.equal(g.rows('Guests').length, 0);
  });

  it('refuses a second booking for the same room and dates', async () => {
    await call('booking-create', { cookie, body: newBooking() });
    const r = await call('booking-create', { cookie, body: newBooking({ mobile: '9123456780', name: 'Other Person' }) });
    assert.equal(r.status, 422);
    assert.match(r.body.fields.room, /taken by Neha Kulkarni/);
    const same = await call('booking-create', { cookie, body: newBooking({ mobile: '9123456780', name: 'Other Person', ci: addDays(TODAY, 2), co: addDays(TODAY, 3) }) });
    assert.equal(same.status, 200, 'arriving the day the last guest leaves is fine');
  });
});

describe('stages, rooms and payments', () => {
  async function seeded() {
    const r = await call('booking-create', { cookie, body: newBooking() });
    return r.body.booking.id as string;
  }

  it('checks in, checks out and sends the room to cleaning, then Undo restores it', async () => {
    const id = await seeded();
    const inn = await call('booking-stage', { cookie, body: { id, to: 'in' } });
    assert.equal(inn.status, 200, JSON.stringify(inn.body));
    assert.equal(g.rows('Bookings')[0][12], 'Checked in');
    assert.equal(inn.body.room, null);

    const out = await call('booking-stage', { cookie, body: { id, to: 'out' } });
    assert.equal(out.body.room.manual, 'cleaning');
    assert.equal(g.rows('Rooms')[0][7], 'Cleaning');

    const undo = await call('booking-stage', { cookie, body: { id, to: 'in', restore: 'available' } });
    assert.equal(undo.status, 200, JSON.stringify(undo.body));
    assert.equal(g.rows('Rooms')[0][7], 'Available');
    assert.equal(g.rows('Bookings')[0][12], 'Checked in');
    assert.match(String(g.rows('Bookings')[0][17]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('refuses check-in to a room under maintenance and unknown stages', async () => {
    g.addRawRow('Guests', ['GS0009', 'X Guest', '9000000009', '', '', '', '', '']);
    g.addRawRow('Bookings', ['BK0009', 'GS0009', 'X Guest', 103, TODAY, addDays(TODAY, 1), '', 2800, '', 0, '', 'Direct', 'Reserved', 1, '', '', '', '']);
    const r = await call('booking-stage', { cookie, body: { id: 'BK0009', to: 'in' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'Room 103 is under maintenance.');
    assert.equal((await call('booking-stage', { cookie, body: { id: 'BK0009', to: 'flying' } })).status, 400);
    assert.equal((await call('booking-stage', { cookie, body: { id: 'BK0404', to: 'in' } })).status, 404);
  });

  it('changes room status but not under a guest', async () => {
    const ok = await call('room-status', { cookie, body: { no: 102, status: 'maintenance' } });
    assert.equal(ok.body.room.manual, 'maintenance');
    assert.equal(g.rows('Rooms')[1][7], 'Maintenance');
    const id = await seeded();
    await call('booking-stage', { cookie, body: { id, to: 'in' } });
    const blocked = await call('room-status', { cookie, body: { no: 101, status: 'cleaning' } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'Check out the guest in room 101 first.');
  });

  it('records part payments and refuses overpaying', async () => {
    const id = await seeded();
    const p = await call('booking-payment', { cookie, body: { id, amount: 2000 } });
    assert.deepEqual([p.body.booking.paid, p.body.booking.balance], [3000, 2600]);
    assert.equal(g.rows('Bookings')[0][9], 3000);
    const over = await call('booking-payment', { cookie, body: { id, amount: 2601 } });
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'Only ₹2,600 is due.');
    assert.equal((await call('booking-payment', { cookie, body: { id, amount: 'lots' } })).status, 409);
  });

  it('adds a room that copies bed, sleeps and rate from its type', async () => {
    const r = await call('room-create', { cookie, body: { no: 201, floor: 2, type: 'Deluxe' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.room.id, r.body.room.price, r.body.room.manual], ['RM0004', 4200, 'available']);
    assert.deepEqual(g.rows('Rooms')[3].slice(1, 8), [201, 2, 'Deluxe', 'Double', 2, 4200, 'Available']);
    const dup = await call('room-create', { cookie, body: { no: 201, floor: 2, type: 'Deluxe' } });
    assert.equal(dup.status, 422);
    assert.equal(dup.body.fields.no, 'Room 201 already exists.');
  });
});

describe('connection check', () => {
  it('passes on a healthy sheet and explains a broken one', async () => {
    const ok = await call('health', { cookie });
    assert.equal(ok.body.ok, true, JSON.stringify(ok.body.checks));
    assert.equal(ok.body.sheetTitle, 'Haveli (test)');
    assert.deepEqual(ok.body.counts, { rooms: 3, guests: 0, bookings: 0 });
    delete g.tabs.Bookings;
    const bad = await call('health', { cookie });
    assert.equal(bad.body.ok, false);
    assert.match(bad.body.checks.find((c: { name: string }) => c.name === 'Tabs').detail, /Bookings/);
  });
});

describe('two people saving at once', () => {
  it('never double-books a room', async () => {
    const [a, b] = await Promise.all([
      call('booking-create', { cookie, body: newBooking({ name: 'First Guest', mobile: '9000000001' }) }),
      call('booking-create', { cookie, body: newBooking({ name: 'Second Guest', mobile: '9000000002' }) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 422]);
    assert.equal([a, b].filter((r) => r.status === 200).length, 1);
    assert.equal(g.rows('Bookings').length, 1);
  });

  it('gives different booking IDs to bookings made at the same moment', async () => {
    const [a, b] = await Promise.all([
      call('booking-create', { cookie, body: newBooking({ name: 'First Guest', mobile: '9000000001', room: 101 }) }),
      call('booking-create', { cookie, body: newBooking({ name: 'Second Guest', mobile: '9000000002', room: 102 }) }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const ids = g.rows('Bookings').map((r) => r[0]);
    assert.equal(new Set(ids).size, 2);
  });
});
