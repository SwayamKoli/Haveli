import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, diffDays, isISODate, looseDateToISO, serialToISO, stampInZone, todayInZone } from '../shared/dates';
import {
  findClash,
  formatEta,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  planPayment,
  planRoomStatus,
  planStage,
  roomState,
  validateNewBooking,
  validateNewRoom,
} from '../shared/rules';
import type { Booking, NewBookingInput, Room } from '../shared/types';

const TODAY = '2026-11-11';

function room(no: number, over: Partial<Room> = {}): Room {
  return { id: `RM${no}`, no, floor: Math.floor(no / 100), type: 'Standard', bed: 'Double', cap: 2, price: 2800, manual: 'available', notes: '', ...over };
}

function booking(id: string, roomNo: number, ci: string, co: string, stage: Booking['stage'] = 'reserved', over: Partial<Booking> = {}): Booking {
  const nights = diffDays(ci, co);
  return {
    id, guestId: 'GS0001', guest: 'Arjun Mehta', mobile: '9876543210', room: roomNo, ci, co, nights,
    price: 2800, total: 2800 * nights, paid: 0, balance: 2800 * nights, source: 'Direct', stage, people: 1,
    eta: '', etaMin: null, notes: '', createdAt: '', updatedAt: '', ...over,
  };
}

function input(over: Partial<NewBookingInput> = {}): NewBookingInput {
  return {
    name: 'Neha Kulkarni', mobile: '9876543210', source: 'Direct', ci: TODAY, co: addDays(TODAY, 2), room: 101,
    advance: 0, people: 1, eta: '', email: '', city: '', idType: '', idLast4: '', notes: '', ...over,
  };
}

describe('dates', () => {
  it('validates real calendar dates only', () => {
    assert.equal(isISODate('2026-02-28'), true);
    assert.equal(isISODate('2026-02-30'), false);
    assert.equal(isISODate('11/11/2026'), false);
    assert.equal(isISODate(20261111), false);
  });

  it('adds and subtracts days across month and year ends', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(diffDays('2026-11-11', '2026-11-14'), 3);
    assert.equal(diffDays('2026-11-14', '2026-11-11'), -3);
  });

  it('reads sheet date numbers and hand-typed dates', () => {
    assert.equal(serialToISO(46337), '2026-11-11');
    assert.equal(looseDateToISO('11/11/2026'), '2026-11-11');
    assert.equal(looseDateToISO('5-1-2027'), '2027-01-05');
    assert.equal(looseDateToISO('2026-11-11 14:00'), '2026-11-11');
    assert.equal(looseDateToISO('31/02/2026'), null);
    assert.equal(looseDateToISO('tomorrow'), null);
  });

  it('uses the hotel time zone for today and stamps', () => {
    // 20:00 UTC on the 10th is already 01:30 on the 11th in India.
    const t = new Date('2026-11-10T20:00:00Z');
    assert.equal(todayInZone('Asia/Kolkata', t), '2026-11-11');
    assert.equal(todayInZone('UTC', t), '2026-11-10');
    assert.equal(stampInZone('Asia/Kolkata', t), '2026-11-11 01:30');
  });
});

describe('small helpers', () => {
  it('formats and parses arrival times', () => {
    assert.equal(formatEta('14:00'), '2:00 PM');
    assert.equal(formatEta('00:05'), '12:05 AM');
    assert.equal(formatEta('12:30'), '12:30 PM');
    assert.equal(formatEta('25:00'), '');
    assert.equal(parseEtaMinutes('2:00 PM'), 840);
    assert.equal(parseEtaMinutes('12:30 AM'), 30);
    assert.equal(parseEtaMinutes('14:00'), 840);
    assert.equal(parseEtaMinutes(0.5), 720);
    assert.equal(parseEtaMinutes('soon'), null);
  });

  it('keeps the last 10 digits of a mobile', () => {
    assert.equal(normalizeMobile('+91 98765 43210'), '9876543210');
    assert.equal(normalizeMobile('098765-43210'), '9876543210');
  });

  it('numbers new ids after the biggest one in use', () => {
    assert.equal(nextId('BK', []), 'BK0001');
    assert.equal(nextId('BK', ['BK0001', 'BK0009', 'BK0004']), 'BK0010');
    assert.equal(nextId('RM', ['RM0050']), 'RM0051');
  });
});

describe('room state and clashes', () => {
  const rooms = [room(101), room(102, { manual: 'cleaning' })];
  const bookings = [booking('BK1', 101, TODAY, addDays(TODAY, 2), 'in')];

  it('derives occupied from a checked-in booking', () => {
    assert.equal(roomState(rooms[0], bookings), 'occupied');
    assert.equal(roomState(rooms[1], bookings), 'cleaning');
    assert.equal(roomState(rooms[0], []), 'available');
  });

  it('lets a new guest arrive on the day the last one leaves', () => {
    assert.equal(findClash(101, addDays(TODAY, 2), addDays(TODAY, 4), bookings), undefined);
    assert.ok(findClash(101, addDays(TODAY, 1), addDays(TODAY, 3), bookings));
  });

  it('ignores cancelled and checked-out bookings when looking for clashes', () => {
    const old = [booking('BK2', 101, TODAY, addDays(TODAY, 2), 'cancelled'), booking('BK3', 101, TODAY, addDays(TODAY, 2), 'out')];
    assert.equal(findClash(101, TODAY, addDays(TODAY, 2), old), undefined);
  });
});

describe('validateNewBooking', () => {
  const rooms = [room(101), room(102, { manual: 'maintenance' }), room(103, { cap: 2, price: 1000 })];
  const ctx = { rooms, bookings: [] as Booking[], today: TODAY };

  it('accepts a normal booking', () => {
    assert.deepEqual(validateNewBooking(input(), ctx), {});
  });

  it('explains every mistake in words', () => {
    const e = validateNewBooking(input({ name: 'A', mobile: '12345', co: TODAY, room: 999, people: 0, source: 'Fax' }), ctx);
    assert.equal(e.name, 'Enter the guest name.');
    assert.equal(e.mob, 'Enter a 10-digit Indian mobile number.');
    assert.equal(e.out, 'Check-out must be after check-in.');
    assert.equal(e.room, 'Choose a room.');
    assert.equal(e.people, 'At least 1 guest.');
    assert.equal(e.source, 'Choose a source from the list.');
  });

  it('blocks the past, maintenance rooms, clashes, big advances and too many guests', () => {
    assert.equal(validateNewBooking(input({ ci: addDays(TODAY, -1) }), ctx).ci, 'Check-in cannot be in the past.');
    assert.equal(validateNewBooking(input({ room: 102 }), ctx).room, 'Room 102 is under maintenance.');
    const busy = { ...ctx, bookings: [booking('BK1', 101, TODAY, addDays(TODAY, 3), 'reserved')] };
    assert.match(validateNewBooking(input(), busy).room, /taken by Arjun Mehta/);
    assert.equal(validateNewBooking(input({ room: 103, advance: 5000 }), ctx).adv, 'Advance is more than the stay total.');
    assert.equal(validateNewBooking(input({ people: 3 }), ctx).people, 'Room 101 sleeps up to 2.');
  });

  it('checks optional details only when given', () => {
    assert.deepEqual(validateNewBooking(input({ email: 'a@b.in', idType: 'Aadhaar', idLast4: '1234', eta: '14:30' }), ctx), {});
    const e = validateNewBooking(input({ email: 'nope', idLast4: '12', eta: '99:99', idType: 'Library card' }), ctx);
    assert.ok(e.email && e.idLast4 && e.eta && e.idType);
  });

  it('refuses stays longer than 60 nights', () => {
    assert.match(validateNewBooking(input({ co: addDays(TODAY, 61) }), ctx).out, /60 nights/);
  });
});

describe('validateNewRoom', () => {
  const rooms = [room(101)];
  const types = ['Standard', 'Suite'];
  it('rejects duplicates, bad numbers and unknown types', () => {
    assert.equal(validateNewRoom({ no: 101, floor: 1, type: 'Standard' }, rooms, types).no, 'Room 101 already exists.');
    assert.ok(validateNewRoom({ no: 0, floor: 1, type: 'Standard' }, rooms, types).no);
    assert.ok(validateNewRoom({ no: 1.5, floor: 1, type: 'Standard' }, rooms, types).no);
    assert.ok(validateNewRoom({ no: 502, floor: 5, type: 'Palace' }, rooms, types).type);
    assert.deepEqual(validateNewRoom({ no: 502, floor: 5, type: 'Suite' }, rooms, types), {});
  });
});

describe('planStage', () => {
  const rooms = { clean: room(101, { manual: 'cleaning' }), fix: room(102, { manual: 'maintenance' }), ok: room(103) };

  it('check-in turns a cleaning room available', () => {
    const b = booking('BK1', 101, TODAY, addDays(TODAY, 1));
    assert.deepEqual(planStage(b, rooms.clean, [b], 'in'), { ok: true, stage: 'in', roomManual: 'available' });
  });

  it('check-out sends the room to cleaning', () => {
    const b = booking('BK1', 103, TODAY, addDays(TODAY, 1), 'in');
    assert.deepEqual(planStage(b, rooms.ok, [b], 'out'), { ok: true, stage: 'out', roomManual: 'cleaning' });
  });

  it('refuses check-in to a room under maintenance or already occupied', () => {
    const b = booking('BK1', 102, TODAY, addDays(TODAY, 1));
    assert.deepEqual(planStage(b, rooms.fix, [b], 'in'), { ok: false, error: 'Room 102 is under maintenance.' });
    const guest = booking('BK2', 103, TODAY, addDays(TODAY, 1), 'in', { guest: 'Priya Nair' });
    const next = booking('BK3', 103, addDays(TODAY, 1), addDays(TODAY, 2));
    assert.deepEqual(planStage(next, rooms.ok, [guest, next], 'in'), { ok: false, error: 'Room 103 is occupied by Priya Nair.' });
  });

  it('will not cancel someone who is in the hotel', () => {
    const b = booking('BK1', 103, TODAY, addDays(TODAY, 1), 'in');
    const r = planStage(b, rooms.ok, [b], 'cancelled');
    assert.equal(r.ok, false);
  });

  it('will not reopen a cancelled booking onto dates someone else now holds', () => {
    const cancelled = booking('BK1', 103, TODAY, addDays(TODAY, 2), 'cancelled');
    const other = booking('BK2', 103, TODAY, addDays(TODAY, 1), 'reserved', { guest: 'Rohan' });
    const r = planStage(cancelled, rooms.ok, [cancelled, other], 'reserved');
    assert.deepEqual(r, { ok: false, error: 'Room 103 is taken by Rohan for those dates.' });
  });

  it('undo can force the room back to a known status', () => {
    const b = booking('BK1', 101, TODAY, addDays(TODAY, 1), 'in');
    const r = planStage(b, room(101), [b], 'reserved', 'cleaning');
    assert.deepEqual(r, { ok: true, stage: 'reserved', roomManual: 'cleaning' });
  });

  it('reports a no-op instead of pretending to move', () => {
    const b = booking('BK1', 103, TODAY, addDays(TODAY, 1), 'in');
    assert.equal(planStage(b, rooms.ok, [b], 'in').ok, false);
  });
});

describe('room status and payments', () => {
  it('will not take an occupied room out of service', () => {
    const r = room(101);
    const b = booking('BK1', 101, TODAY, addDays(TODAY, 1), 'in');
    assert.deepEqual(planRoomStatus(r, [b], 'maintenance'), { ok: false, error: 'Check out the guest in room 101 first.' });
    assert.deepEqual(planRoomStatus(r, [], 'maintenance'), { ok: true });
  });

  it('accepts a part payment and refuses overpaying', () => {
    const b = booking('BK1', 101, TODAY, addDays(TODAY, 2), 'reserved', { paid: 1000, balance: 4600 });
    assert.deepEqual(planPayment(b, 1600), { ok: true, paid: 2600 });
    assert.deepEqual(planPayment(b, 4601), { ok: false, error: 'Only ₹4,600 is due.' });
    assert.equal(planPayment(b, 0).ok, false);
    assert.equal(planPayment(b, 10.5).ok, false);
    assert.equal(planPayment({ ...b, stage: 'cancelled' }, 100).ok, false);
  });
});
