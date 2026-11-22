/**
 * Two people saving at the same time.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { call } from '../helpers/harness';
import { g, owner, newBooking, cellAt, created, useHotel } from '../helpers/hotel';

useHotel();

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
