/**
 * Reading the sheet: what is understood, what is skipped with a warning.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { call } from '../helpers/harness';
import { TODAY, g, owner, newBooking, raw, created, useHotel } from '../helpers/hotel';

useHotel();

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
