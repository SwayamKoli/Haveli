import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  diffDays,
  isISODate,
  looseDateToISO,
  serialToISO,
  stampInZone,
  todayInZone,
} from '../../shared/dates';
import {
  findClash,
  formatEta,
  money,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  parseRoomList,
  planPayment,
  planRoomMove,
  planRoomStatus,
  planStage,
  roomsLabel,
  roomState,
  validateBooking,
  validateNewRoom,
} from '../../shared/rules';
import type { Booking, BookingFields, Room } from '../../shared/types';

const TODAY = '2026-11-11';

function room(no: number, over: Partial<Room> = {}): Room {
  return { id: `RM${no}`, no, floor: Math.floor(no / 100), type: 'Standard', bed: 'Double', cap: 2, price: 2800, manual: 'available', notes: '', ...over };
}

function booking(id: string, rooms: number[], ci: string, co: string, stage: Booking['stage'] = 'reserved', over: Partial<Booking> = {}): Booking {
  const nights = diffDays(ci, co);
  const price = 2800 * rooms.length;
  const m = money(price, nights, over.paid ?? 0, over.discount ?? 0);
  return {
    id, guestId: 'GS0001', guest: 'Arjun Mehta', mobile: '9876543210', rooms, ci, co, nights, price, discount: 0, gross: m.gross, total: m.total,
    paid: 0, balance: m.balance, source: 'Direct', stage, people: 1, eta: '', etaMin: null, notes: '', createdBy: 'Asha', updatedBy: 'Asha',
    createdAt: '', updatedAt: '', ...over,
  };
}

function fields(over: Partial<BookingFields> = {}): BookingFields {
  return {
    name: 'Neha Kulkarni', mobile: '9876543210', source: 'Direct', ci: TODAY, co: addDays(TODAY, 2), rooms: [101], discount: 0,
    people: 1, eta: '', email: '', city: '', idType: '', idLast4: '', notes: '', ...over,
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


describe('money', () => {
  it('takes the discount off the whole stay and never goes below zero', () => {
    assert.deepEqual(money(2800, 2, 0, 500), { gross: 5600, total: 5100, balance: 5100 });
    assert.deepEqual(money(2800, 2, 1000, 500), { gross: 5600, total: 5100, balance: 4100 });
    assert.equal(money(2800, 1, 0, 99999).total, 0);
    assert.equal(money(2800, 2, 0).total, 5600);
  });
});

describe('room lists', () => {
  it('reads and prints several rooms', () => {
    assert.deepEqual(parseRoomList('101, 102 & 103'), [101, 102, 103]);
    assert.deepEqual(parseRoomList(104), [104]);
    assert.deepEqual(parseRoomList('101,101'), [101]);
    assert.deepEqual(parseRoomList(''), []);
    assert.equal(roomsLabel([101]), '101');
    assert.equal(roomsLabel([101, 102, 103]), '101, 102 & 103');
  });
});

describe('room state and clashes', () => {
  const rooms = [room(101), room(102, { manual: 'cleaning' }), room(103)];
  const bookings = [booking('BK1', [101, 103], TODAY, addDays(TODAY, 2), 'in')];

  it('derives occupied from a checked-in booking, for every room it holds', () => {
    assert.equal(roomState(rooms[0], bookings), 'occupied');
    assert.equal(roomState(rooms[2], bookings), 'occupied');
    assert.equal(roomState(rooms[1], bookings), 'cleaning');
    assert.equal(roomState(rooms[0], []), 'available');
  });

  it('lets a new guest arrive on the day the last one leaves', () => {
    assert.equal(findClash([101], addDays(TODAY, 2), addDays(TODAY, 4), bookings), undefined);
    assert.ok(findClash([101], addDays(TODAY, 1), addDays(TODAY, 3), bookings));
  });

  it('finds a clash on any one of several rooms', () => {
    const hit = findClash([102, 103], TODAY, addDays(TODAY, 1), bookings);
    assert.equal(hit?.room, 103);
  });

  it('ignores cancelled and checked-out bookings, and the booking being edited', () => {
    const old = [booking('BK2', [101], TODAY, addDays(TODAY, 2), 'cancelled'), booking('BK3', [101], TODAY, addDays(TODAY, 2), 'out')];
    assert.equal(findClash([101], TODAY, addDays(TODAY, 2), old), undefined);
    assert.equal(findClash([101], TODAY, addDays(TODAY, 2), bookings, 'BK1'), undefined);
  });
});

describe('validateBooking (new)', () => {
  const rooms = [room(101), room(102, { manual: 'maintenance' }), room(103, { cap: 2, price: 1000 }), room(104, { cap: 3, price: 4200 })];
  const ctx = { rooms, bookings: [] as Booking[], today: TODAY };

  it('accepts a normal booking and one with several rooms', () => {
    assert.deepEqual(validateBooking(fields(), ctx, 0), {});
    assert.deepEqual(validateBooking(fields({ rooms: [101, 103, 104], people: 6 }), ctx, 0), {});
  });

  it('explains every mistake in words', () => {
    const e = validateBooking(fields({ name: 'A', mobile: '12345', co: TODAY, rooms: [999], people: 0, source: 'Fax' }), ctx, 0);
    assert.equal(e.name, 'Enter the guest name.');
    assert.equal(e.mob, 'Enter a 10-digit Indian mobile number.');
    assert.equal(e.out, 'Check-out must be after check-in.');
    assert.equal(e.room, 'Room 999 does not exist.');
    assert.equal(e.people, 'At least 1 guest.');
    assert.equal(e.source, 'Choose a source from the list.');
    assert.equal(validateBooking(fields({ rooms: [] }), ctx, 0).room, 'Choose at least one room.');
    assert.equal(validateBooking(fields({ rooms: [101, 101] }), ctx, 0).room, 'The same room is chosen twice.');
  });

  it('blocks the past, maintenance rooms, clashes and too many guests', () => {
    assert.equal(validateBooking(fields({ ci: addDays(TODAY, -1) }), ctx, 0).ci, 'Check-in cannot be in the past.');
    assert.equal(validateBooking(fields({ rooms: [101, 102] }), ctx, 0).room, 'Room 102 is under maintenance.');
    const busy = { ...ctx, bookings: [booking('BK1', [101], TODAY, addDays(TODAY, 3), 'reserved')] };
    assert.match(validateBooking(fields(), busy, 0).room, /taken by Arjun Mehta/);
    assert.match(validateBooking(fields({ rooms: [103, 101] }), busy, 0).room, /Room 101 is taken/);
    assert.equal(validateBooking(fields({ people: 3 }), ctx, 0).people, 'Room 101 sleeps up to 2.');
    assert.equal(validateBooking(fields({ rooms: [101, 103], people: 5 }), ctx, 0).people, 'These rooms sleep up to 4 in total.');
  });

  it('checks the discount and the advance against the total after discount', () => {
    // room 103: 1000 x 2 nights = 2000
    assert.deepEqual(validateBooking(fields({ rooms: [103], discount: 500 }), ctx, 1500), {});
    assert.equal(validateBooking(fields({ rooms: [103], discount: 500 }), ctx, 1501).adv, 'Advance is more than the amount payable.');
    assert.match(validateBooking(fields({ rooms: [103], discount: 2001 }), ctx, 0).discount, /cannot be more than the stay total \(₹2,000\)/);
    assert.ok(validateBooking(fields({ discount: -5 }), ctx, 0).discount);
    assert.ok(validateBooking(fields({ discount: 10.5 }), ctx, 0).discount);
    assert.ok(validateBooking(fields({ discount: Number.NaN }), ctx, 0).discount);
    assert.deepEqual(validateBooking(fields({ rooms: [103], discount: 2000 }), ctx, 0), {});
    assert.ok(validateBooking(fields(), ctx, -1).adv);
  });

  it('checks optional details only when given', () => {
    assert.deepEqual(validateBooking(fields({ email: 'a@b.in', idType: 'Aadhaar', idLast4: '1234', eta: '14:30' }), ctx, 0), {});
    const e = validateBooking(fields({ email: 'nope', idLast4: '12', eta: '99:99', idType: 'Library card' }), ctx, 0);
    assert.ok(e.email && e.idLast4 && e.eta && e.idType);
  });

  it('refuses stays longer than 60 nights', () => {
    assert.match(validateBooking(fields({ co: addDays(TODAY, 61) }), ctx, 0).out, /60 nights/);
  });
});

describe('validateBooking (editing)', () => {
  const rooms = [room(101), room(102), room(103, { price: 1000 })];
  const mine = booking('BK1', [101], TODAY, addDays(TODAY, 2), 'reserved', { paid: 2000, balance: 3600 });
  const other = booking('BK2', [102], addDays(TODAY, 1), addDays(TODAY, 3), 'reserved', { guest: 'Rohan' });
  const ctx = { rooms, bookings: [mine, other], today: TODAY };

  it('does not clash with the booking being edited, but does with others', () => {
    assert.deepEqual(validateBooking(fields({ rooms: [101] }), ctx, 2000, mine), {});
    assert.match(validateBooking(fields({ rooms: [101, 102] }), ctx, 2000, mine).room, /Room 102 is taken by Rohan/);
  });

  it('lets an old check-in date stay as it is but not move into the past', () => {
    const past = booking('BK3', [103], addDays(TODAY, -2), addDays(TODAY, 1), 'in');
    const c = { ...ctx, bookings: [past] };
    assert.deepEqual(validateBooking(fields({ rooms: [103], ci: past.ci, co: past.co }), c, 0, past), {});
    assert.equal(validateBooking(fields({ rooms: [103], ci: addDays(TODAY, -3), co: past.co }), c, 0, past).ci, 'Check-in cannot be in the past.');
  });

  it('will not let the new total fall below what was already paid', () => {
    const e = validateBooking(fields({ rooms: [101], discount: 4000 }), ctx, 2000, mine);
    assert.match(e.discount, /already paid ₹2,000, which is more than the new total ₹1,600/);
    assert.deepEqual(validateBooking(fields({ rooms: [101], discount: 3600 }), ctx, 2000, mine), {});
  });

  it('keeps the stored rate when the rooms are unchanged, and uses current rates when they change', () => {
    const cheap = booking('BK4', [101], TODAY, addDays(TODAY, 1), 'reserved', { price: 1000 });
    const c = { ...ctx, bookings: [cheap] };
    // unchanged room: stored 1000/night, so a 1000 discount is fine (current rate would be 2800)
    assert.deepEqual(validateBooking(fields({ rooms: [101], co: addDays(TODAY, 1), discount: 1000 }), c, 0, cheap), {});
    // other room: current rate 1000 for room 103
    assert.ok(validateBooking(fields({ rooms: [103], co: addDays(TODAY, 1), discount: 1001 }), c, 0, cheap).discount);
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
  const clean = room(101, { manual: 'cleaning' });
  const fix = room(102, { manual: 'maintenance' });
  const ok = room(103);
  const ok2 = room(104, { manual: 'cleaning' });

  it('check-in turns a cleaning room available', () => {
    const b = booking('BK1', [101], TODAY, addDays(TODAY, 1));
    assert.deepEqual(planStage(b, [clean], [b], 'in'), { ok: true, stage: 'in', roomChanges: [{ no: 101, manual: 'available' }] });
  });

  it('check-in for several rooms prepares each one', () => {
    const b = booking('BK1', [103, 104], TODAY, addDays(TODAY, 1));
    assert.deepEqual(planStage(b, [ok, ok2], [b], 'in'), { ok: true, stage: 'in', roomChanges: [{ no: 104, manual: 'available' }] });
  });

  it('check-out sends every room to cleaning', () => {
    const b = booking('BK1', [103, 104], TODAY, addDays(TODAY, 1), 'in');
    assert.deepEqual(planStage(b, [ok, room(104)], [b], 'out'), { ok: true, stage: 'out', roomChanges: [{ no: 103, manual: 'cleaning' }, { no: 104, manual: 'cleaning' }] });
  });

  it('refuses check-in if any room is under maintenance or already occupied', () => {
    const b = booking('BK1', [103, 102], TODAY, addDays(TODAY, 1));
    assert.deepEqual(planStage(b, [ok, fix], [b], 'in'), { ok: false, error: 'Room 102 is under maintenance.' });
    const guest = booking('BK2', [103], TODAY, addDays(TODAY, 1), 'in', { guest: 'Priya Nair' });
    const next = booking('BK3', [103], addDays(TODAY, 1), addDays(TODAY, 2));
    assert.deepEqual(planStage(next, [ok], [guest, next], 'in'), { ok: false, error: 'Room 103 is occupied by Priya Nair.' });
  });

  it('will not cancel someone who is in the hotel', () => {
    const b = booking('BK1', [103], TODAY, addDays(TODAY, 1), 'in');
    assert.equal(planStage(b, [ok], [b], 'cancelled').ok, false);
  });

  it('will not reopen a cancelled booking onto dates someone else now holds', () => {
    const cancelled = booking('BK1', [103], TODAY, addDays(TODAY, 2), 'cancelled');
    const other = booking('BK2', [103], TODAY, addDays(TODAY, 1), 'reserved', { guest: 'Rohan' });
    assert.deepEqual(planStage(cancelled, [ok], [cancelled, other], 'reserved'), { ok: false, error: 'Room 103 is taken by Rohan for those dates.' });
  });

  it('undo can force each room back to a known status', () => {
    const b = booking('BK1', [101, 103], TODAY, addDays(TODAY, 1), 'in');
    const r = planStage(b, [room(101), ok], [b], 'reserved', { 101: 'cleaning', 103: 'available' });
    assert.deepEqual(r, { ok: true, stage: 'reserved', roomChanges: [{ no: 101, manual: 'cleaning' }] });
  });

  it('reports a no-op, and a room that is missing from the Rooms tab', () => {
    const b = booking('BK1', [103], TODAY, addDays(TODAY, 1), 'in');
    assert.equal(planStage(b, [ok], [b], 'in').ok, false);
    const lost = booking('BK9', [555], TODAY, addDays(TODAY, 1));
    assert.deepEqual(planStage(lost, [], [lost], 'in'), { ok: false, error: 'Room 555 is not in the Rooms tab.' });
  });
});

describe('planRoomMove (editing the rooms of a guest who is already in)', () => {
  const all = [room(101), room(102), room(103, { manual: 'cleaning' }), room(104, { manual: 'maintenance' })];
  const inHouse = booking('BK1', [101], TODAY, addDays(TODAY, 2), 'in');

  it('does nothing for a booking that has not checked in', () => {
    const res = booking('BK2', [101], TODAY, addDays(TODAY, 2));
    assert.deepEqual(planRoomMove(res, [102], all, [res]), { ok: true, roomChanges: [] });
  });

  it('sends rooms they leave to cleaning and readies the ones they take', () => {
    assert.deepEqual(planRoomMove(inHouse, [102, 103], all, [inHouse]), {
      ok: true,
      roomChanges: [{ no: 103, manual: 'available' }, { no: 101, manual: 'cleaning' }],
    });
    assert.deepEqual(planRoomMove(inHouse, [101, 102], all, [inHouse]), { ok: true, roomChanges: [] });
  });

  it('refuses a room under maintenance or occupied by someone else', () => {
    assert.deepEqual(planRoomMove(inHouse, [101, 104], all, [inHouse]), { ok: false, error: 'Room 104 is under maintenance.' });
    const other = booking('BK2', [102], TODAY, addDays(TODAY, 1), 'in', { guest: 'Priya Nair' });
    assert.deepEqual(planRoomMove(inHouse, [102], all, [inHouse, other]), { ok: false, error: 'Room 102 is occupied by Priya Nair.' });
  });
});

describe('room status and payments', () => {
  it('will not take an occupied room out of service (also when it is one of several rooms)', () => {
    const r = room(102);
    const b = booking('BK1', [101, 102], TODAY, addDays(TODAY, 1), 'in');
    assert.deepEqual(planRoomStatus(r, [b], 'maintenance'), { ok: false, error: 'Check out the guest in room 102 first.' });
    assert.deepEqual(planRoomStatus(r, [], 'maintenance'), { ok: true });
  });

  it('accepts a part payment and refuses overpaying', () => {
    const b = booking('BK1', [101], TODAY, addDays(TODAY, 2), 'reserved', { paid: 1000 });
    assert.deepEqual(planPayment(b, 1600, 'UPI'), { ok: true, paid: 2600 });
    assert.deepEqual(planPayment(b, 4601, 'Cash'), { ok: false, error: 'Only ₹4,600 is due.' });
    assert.equal(planPayment(b, 0, 'Cash').ok, false);
    assert.equal(planPayment(b, 10.5, 'Cash').ok, false);
    assert.equal(planPayment(b, 100, 'Barter').ok, false);
    assert.equal(planPayment({ ...b, stage: 'cancelled' }, 100, 'Cash').ok, false);
  });

  it('pays against the amount after discount', () => {
    const b = booking('BK1', [101], TODAY, addDays(TODAY, 2), 'reserved', { discount: 600 });
    assert.equal(b.total, 5000);
    assert.deepEqual(planPayment(b, 5000, 'Cash'), { ok: true, paid: 5000 });
    assert.deepEqual(planPayment(b, 5001, 'Cash'), { ok: false, error: 'Only ₹5,000 is due.' });
  });

  it('gives money back: needs a reason (or the Refund method), and never more than was paid', () => {
    const b = booking('BK1', [101], TODAY, addDays(TODAY, 2), 'reserved', { paid: 3000 });
    assert.deepEqual(planPayment(b, -1000, 'Cash', 'Guest left a day early'), { ok: true, paid: 2000 });
    assert.deepEqual(planPayment(b, -3000, 'Refund'), { ok: true, paid: 0 });
    assert.equal(planPayment(b, -1000, 'Cash').ok, false, 'a refund with no reason');
    assert.equal(planPayment(b, -1000, 'Cash', '  ').ok, false);
    assert.equal(planPayment(b, -1000, 'Barter', 'x y z').ok, false);
    assert.deepEqual(planPayment(b, -3001, 'Refund'), { ok: false, error: 'Only ₹3,000 has been paid, so that is the most you can refund.' });
    assert.deepEqual(planPayment(booking('BK2', [101], TODAY, addDays(TODAY, 1)), -1, 'Refund'), { ok: false, error: 'Nothing has been paid on this booking.' });
  });

  it('allows a refund on a cancelled booking but no new payment', () => {
    const c = booking('BK1', [101], TODAY, addDays(TODAY, 2), 'cancelled', { paid: 2000 });
    assert.deepEqual(planPayment(c, -2000, 'Cash', 'Cancelled by guest'), { ok: true, paid: 0 });
    assert.equal(planPayment(c, 500, 'Cash').ok, false);
  });
});
