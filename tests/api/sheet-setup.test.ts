/**
 * The one-click sheet setup and the connection check.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { call } from '../helpers/harness';
import { g, owner, newBooking, makeStaff, useHotel } from '../helpers/hotel';

useHotel();

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
