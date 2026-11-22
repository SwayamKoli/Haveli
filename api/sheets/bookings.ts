/**
 * Bookings in the sheet: create, edit, change stage (check in / out / cancel) and take a payment or refund.
 */
import { STAGE_LABEL } from '../../shared/constants';
import { diffDays } from '../../shared/dates';
import {
  formatEta,
  money,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  planPayment,
  planRoomMove,
  planStage,
  sameRooms,
  validateBooking,
  validatePayMethod,
} from '../../shared/rules';
import type {
  Booking,
  EditBookingInput,
  Guest,
  NewBookingInput,
  Payment,
  RoomManual,
  Stage,
} from '../../shared/types';
import { HttpError } from '../lib/http';
import {
  appendRow,
  buildRow,
  cellUpdates,
  exclusive,
  rawIds,
  txt,
  writeCells,
  type Cell,
  type CellWrite,
  type Sheet,
} from './access';
import { assertReady, loadAll, pub, type GuestRec, type Loaded } from './read';
import { roomsOf, roomWrites } from './rooms';
import { colLetter, type BookingKey, type GuestKey } from './schema';

/** Nights / Total / Balance stay live formulas so they also work when someone edits the sheet by hand. */
function bookingFormulas(s: Sheet<BookingKey>, row: number): CellWrite[] {
  const at = (k: BookingKey) => (s.idx[k] >= 0 ? `${colLetter(s.idx[k])}${row}` : null);
  const ci = at('ci');
  const co = at('co');
  const nights = at('nights');
  const price = at('price');
  const discount = at('discount');
  const total = at('total');
  const paid = at('paid');
  const balance = at('balance');
  const out: CellWrite[] = [];
  const put = (cellRef: string | null, formula: string) => {
    if (cellRef) out.push({ range: `${s.tab}!${cellRef}`, values: [[formula]] });
  };
  if (ci && co) put(nights, `=IF(AND(ISNUMBER(${ci}),ISNUMBER(${co})),${co}-${ci},"")`);
  const nightsExpr = nights ?? (ci && co ? `(${co}-${ci})` : null);
  if (price && nightsExpr) {
    const off = discount ? `-N(${discount})` : '';
    put(total, `=IF(ISNUMBER(${nightsExpr}),MAX(0,${nightsExpr}*${price}${off}),"")`);
  }
  if (total && paid) put(balance, `=IF(ISNUMBER(${total}),${total}-N(${paid}),"")`);
  return out;
}

/** One room goes in as a number, several as text like "101, 102". */
const roomCell = (nos: number[]): Cell => (nos.length === 1 ? nos[0] : txt(nos.join(', ')));

/** Finds or creates the guest for a booking and returns their ID. Fills in details the sheet does not have yet. */
async function resolveGuest(
  L: Loaded,
  f: { name: string; mobile: string; email: string; city: string; idType: string; idLast4: string },
): Promise<{ guest: Guest; created: boolean }> {
  const gs = L.sheets.guests;
  const found = L.guests.find((g) => normalizeMobile(g.mobile) === f.mobile);
  if (!found) {
    const id = nextId('GS', rawIds(gs, 'id'));
    const guest: Guest = { id, name: f.name, mobile: f.mobile, email: f.email, idType: f.idType, idLast4: f.idLast4, city: f.city, createdAt: L.stamp };
    await appendRow(
      gs,
      buildRow(gs, { id, name: txt(f.name), mobile: txt(f.mobile), email: txt(f.email), idType: f.idType, idLast4: txt(f.idLast4), city: txt(f.city), created: txt(L.stamp) }),
    );
    L.guests.push({ ...guest, row: gs.rows.length + 2 });
    gs.rows.push([]);
    return { guest, created: true };
  }
  const fill: Partial<Record<GuestKey, Cell>> = {};
  if (!found.email && f.email) fill.email = txt(f.email);
  if (!found.city && f.city) fill.city = txt(f.city);
  if (!found.idType && f.idType) fill.idType = f.idType;
  if (!found.idLast4 && f.idLast4) fill.idLast4 = txt(f.idLast4);
  if (Object.keys(fill).length) await writeCells(cellUpdates(gs, found.row, fill));
  return {
    guest: { ...pub(found), email: found.email || f.email, city: found.city || f.city, idType: found.idType || f.idType, idLast4: found.idLast4 || f.idLast4 },
    created: false,
  };
}

async function logPayment(L: Loaded, p: { bookingId: string; amount: number; method: string; by: string; note: string }): Promise<Payment> {
  const ps = L.sheets.payments;
  const id = nextId('PY', rawIds(ps, 'id'));
  await appendRow(ps, buildRow(ps, { id, booking: p.bookingId, at: txt(L.stamp), amount: p.amount, method: p.method, by: txt(p.by), note: txt(p.note) }));
  const pay: Payment = { id, bookingId: p.bookingId, at: L.stamp, amount: p.amount, method: p.method, by: p.by, note: p.note };
  L.payments.push(pay);
  ps.rows.push([id]);
  return pay;
}

async function createBookingNow(input: NewBookingInput, by: string) {
  const L = await loadAll();
  assertReady(L);
  const advance = Math.round(Number(input.advance) || 0);
  const errors = validateBooking(input, { rooms: L.rooms, bookings: L.bookings, today: L.today }, advance);
  const m = advance > 0 ? validatePayMethod(input.method) : null;
  if (m) errors.method = m;
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);

  const rooms = roomsOf(L, input.rooms);
  const price = rooms.reduce((sum, r) => sum + r.price, 0);
  const name = input.name.trim();
  const mobile = normalizeMobile(input.mobile);
  const { guest, created: guestCreated } = await resolveGuest(L, {
    name,
    mobile,
    email: input.email.trim(),
    city: input.city.trim(),
    idType: input.idType,
    idLast4: input.idLast4.trim(),
  });

  const bs = L.sheets.bookings;
  const id = nextId('BK', rawIds(bs, 'id'));
  const nights = diffDays(input.ci, input.co);
  const discount = Math.round(Number(input.discount) || 0);
  const eta = formatEta(input.eta);
  const row = await appendRow(
    bs,
    buildRow(bs, {
      id,
      guestId: guest.id,
      guest: txt(name),
      room: roomCell(input.rooms),
      ci: input.ci,
      co: input.co,
      price,
      discount,
      paid: advance,
      source: input.source,
      stage: STAGE_LABEL.reserved,
      people: input.people,
      eta: txt(eta),
      notes: txt(input.notes.trim()),
      createdBy: txt(by),
      updatedBy: txt(by),
      created: txt(L.stamp),
      updated: txt(L.stamp),
    }),
  );
  await writeCells(bookingFormulas(bs, row));
  const payment = advance > 0 ? await logPayment(L, { bookingId: id, amount: advance, method: input.method, by, note: 'Advance at booking' }) : null;

  const { gross, total, balance } = money(price, nights, advance, discount);
  const booking: Booking = {
    id,
    guestId: guest.id,
    guest: name,
    mobile,
    rooms: [...input.rooms],
    ci: input.ci,
    co: input.co,
    nights,
    price,
    discount,
    gross,
    total,
    paid: advance,
    balance,
    source: input.source,
    stage: 'reserved',
    people: input.people,
    eta,
    etaMin: parseEtaMinutes(eta),
    notes: input.notes.trim(),
    createdBy: by,
    updatedBy: by,
    createdAt: L.stamp,
    updatedAt: L.stamp,
  };
  return { booking, guest, guestCreated, payment };
}

async function updateBookingNow(input: EditBookingInput, by: string) {
  const L = await loadAll();
  assertReady(L);
  const b = L.bookings.find((x) => x.id === input.id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  if (b.stage === 'cancelled') throw new HttpError(409, 'This booking is cancelled. Move it back to Reserved before editing it.');

  if (b.stage === 'out' && (input.ci !== b.ci || input.co !== b.co || !sameRooms(b.rooms, input.rooms))) {
    throw new HttpError(409, 'The dates and rooms of a stay that has finished cannot be changed. You can still fix the guest details, notes, source and discount.');
  }
  const errors = validateBooking(input, { rooms: L.rooms, bookings: L.bookings, today: L.today }, b.paid, b);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);
  const move = planRoomMove(b, input.rooms, L.rooms, L.bookings);
  if (!move.ok) throw new HttpError(409, move.error);

  const rooms = roomsOf(L, input.rooms);
  const price = sameRooms(b.rooms, input.rooms) ? b.price : rooms.reduce((sum, r) => sum + r.price, 0);
  const name = input.name.trim();
  const mobile = normalizeMobile(input.mobile);
  const email = input.email.trim();
  const city = input.city.trim();
  const idLast4 = input.idLast4.trim();
  const gs = L.sheets.guests;

  // The guest: fix their details if the mobile is unchanged, otherwise move the booking to the right guest.
  const cur = L.guests.find((g) => g.id === b.guestId);
  let guestId = b.guestId;
  let guestOut: Guest | undefined;
  const detail = (g: GuestRec): Partial<Record<GuestKey, Cell>> => {
    const w: Partial<Record<GuestKey, Cell>> = {};
    if (g.name !== name) w.name = txt(name);
    if (g.email !== email) w.email = txt(email);
    if (g.city !== city) w.city = txt(city);
    if (g.idType !== input.idType) w.idType = input.idType;
    if (g.idLast4 !== idLast4) w.idLast4 = txt(idLast4);
    return w;
  };
  if (cur && normalizeMobile(cur.mobile) === mobile) {
    const w = detail(cur);
    if (Object.keys(w).length) await writeCells(cellUpdates(gs, cur.row, w));
    guestOut = { ...pub(cur), name, email, city, idType: input.idType, idLast4 };
  } else {
    const other = L.guests.find((g) => normalizeMobile(g.mobile) === mobile);
    const usedElsewhere = cur ? L.bookings.some((x) => x.id !== b.id && x.guestId === cur.id) : true;
    if (other) {
      guestId = other.id;
      const fill: Partial<Record<GuestKey, Cell>> = {};
      if (!other.email && email) fill.email = txt(email);
      if (!other.city && city) fill.city = txt(city);
      if (!other.idType && input.idType) fill.idType = input.idType;
      if (!other.idLast4 && idLast4) fill.idLast4 = txt(idLast4);
      if (Object.keys(fill).length) await writeCells(cellUpdates(gs, other.row, fill));
      guestOut = { ...pub(other) };
    } else if (cur && !usedElsewhere) {
      await writeCells(cellUpdates(gs, cur.row, { ...detail(cur), mobile: txt(mobile) }));
      guestOut = { ...pub(cur), name, mobile, email, city, idType: input.idType, idLast4 };
    } else {
      const r = await resolveGuest(L, { name, mobile, email, city, idType: input.idType, idLast4 });
      guestId = r.guest.id;
      guestOut = r.guest;
    }
  }

  const nights = diffDays(input.ci, input.co);
  const discount = Math.round(Number(input.discount) || 0);
  const eta = formatEta(input.eta);
  const writes = cellUpdates(L.sheets.bookings, b.row, {
    guestId,
    guest: txt(name),
    room: roomCell(input.rooms),
    ci: input.ci,
    co: input.co,
    price,
    discount,
    source: input.source,
    people: input.people,
    eta: txt(eta),
    notes: txt(input.notes.trim()),
    updatedBy: txt(by),
    updated: txt(L.stamp),
  });
  const moved = roomWrites(L, move.roomChanges);
  writes.push(...moved.writes);
  await writeCells(writes);

  const { gross, total, balance } = money(price, nights, b.paid, discount);
  const booking: Booking = {
    ...pub(b),
    guestId,
    guest: name,
    mobile,
    rooms: [...input.rooms],
    ci: input.ci,
    co: input.co,
    nights,
    price,
    discount,
    gross,
    total,
    balance,
    source: input.source,
    people: input.people,
    eta,
    etaMin: parseEtaMinutes(eta),
    notes: input.notes.trim(),
    updatedBy: by,
    updatedAt: L.stamp,
  };
  return { booking, guest: guestOut, rooms: moved.rooms };
}

async function changeStageNow(id: string, to: Stage, restore: Record<number, RoomManual> | undefined, by: string) {
  const L = await loadAll();
  assertReady(L);
  const b = L.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  const plan = planStage(b, roomsOf(L, b.rooms), L.bookings, to, restore);
  if (!plan.ok) throw new HttpError(409, plan.error);

  const writes = cellUpdates(L.sheets.bookings, b.row, { stage: STAGE_LABEL[to], updatedBy: txt(by), updated: txt(L.stamp) });
  const moved = roomWrites(L, plan.roomChanges);
  writes.push(...moved.writes);
  await writeCells(writes);
  return { booking: { ...pub(b), stage: to, updatedBy: by, updatedAt: L.stamp } as Booking, rooms: moved.rooms };
}

async function collectPaymentNow(id: string, amount: number, method: string, note: string, by: string) {
  const L = await loadAll();
  assertReady(L);
  const b = L.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'That booking was not found. Refresh and try again.');
  const plan = planPayment(b, amount, method, note);
  if (!plan.ok) throw new HttpError(409, plan.error);
  const payment = await logPayment(L, { bookingId: id, amount, method, by, note });
  await writeCells(cellUpdates(L.sheets.bookings, b.row, { paid: plan.paid, updatedBy: txt(by), updated: txt(L.stamp) }));
  const { gross, total, balance } = money(b.price, b.nights, plan.paid, b.discount);
  return { booking: { ...pub(b), paid: plan.paid, gross, total, balance, updatedBy: by, updatedAt: L.stamp } as Booking, payment };
}

export const createBooking = (...a: Parameters<typeof createBookingNow>) => exclusive(() => createBookingNow(...a));

export const updateBooking = (...a: Parameters<typeof updateBookingNow>) => exclusive(() => updateBookingNow(...a));

export const changeStage = (...a: Parameters<typeof changeStageNow>) => exclusive(() => changeStageNow(...a));

export const collectPayment = (...a: Parameters<typeof collectPaymentNow>) => exclusive(() => collectPaymentNow(...a));
