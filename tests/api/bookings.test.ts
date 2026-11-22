/**
 * Creating bookings and correcting ones that were saved wrongly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../../shared/dates';
import { call } from '../helpers/harness';
import {
  TODAY,
  g,
  owner,
  newBooking,
  editBody,
  cellAt,
  makeStaff,
  created,
  useHotel,
} from '../helpers/hotel';

useHotel();

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
