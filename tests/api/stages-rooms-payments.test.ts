/**
 * Check in / out / cancel, room status, payments, and adding rooms in bulk.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays } from '../../shared/dates';
import { call } from '../helpers/harness';
import { TODAY, g, owner, cellAt, raw, makeStaff, created, useHotel } from '../helpers/hotel';

useHotel();

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
