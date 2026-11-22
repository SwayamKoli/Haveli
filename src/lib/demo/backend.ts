/**
 * The demo "server": answers the same calls as the real one, using the shared rules, and keeps everything in memory.
 */
import { REFUND_METHOD, STAFF_ROLES } from '../../../shared/constants';
import { diffDays } from '../../../shared/dates';
import {
  formatEta,
  money,
  nextId,
  normalizeMobile,
  passwordProblem,
  parseEtaMinutes,
  planPayment,
  planRoomMove,
  planRoomStatus,
  planStage,
  sameRooms,
  validateBooking,
  validateNewRoom,
} from '../../../shared/rules';
import type { BackgroundInfo, Booking, DataBundle, Payment, Room, RoomManual, SecurityReport } from '../../../shared/types';
import { HOTEL_NAME } from '../../config';
import { ApiError, type Backend } from '../api';
import { roomTypes } from '../selectors';
import { localToday, nowStamp, seed } from './data';

const clone = <T>(v: T): T => structuredClone(v);

const wait = () => new Promise<void>((r) => setTimeout(r, 90));

export function makeDemoBackend(): Backend {
  const today = localToday();
  const db = seed(today);
  const me = 'Demo owner';
  const session = {
    authenticated: true,
    configured: true,
    missing: [] as string[],
    mode: 'demo' as const,
    hotel: HOTEL_NAME,
    staff: { username: 'owner', name: me, role: 'Owner', owner: true, viaOwner: false },
    background: { kind: 'none', url: null, version: 0 } as BackgroundInfo,
  };
  const setBg = (kind: BackgroundInfo['kind'], url: string | null): BackgroundInfo => {
    if (session.background.url?.startsWith('blob:')) URL.revokeObjectURL(session.background.url);
    session.background = { kind, url, version: session.background.version + 1 };
    return session.background;
  };

  const must = <T>(v: T | undefined, msg: string): T => {
    if (v === undefined) throw new ApiError(404, msg);
    return v;
  };
  const ctx = () => ({ rooms: db.rooms, bookings: db.bookings, today });
  const roomsOf = (nos: number[]) => db.rooms.filter((r) => nos.includes(r.no));
  const applyRoomChanges = (changes: { no: number; manual: RoomManual }[]): Room[] => {
    const out: Room[] = [];
    for (const c of changes) {
      const r = db.rooms.find((x) => x.no === c.no);
      if (r) {
        r.manual = c.manual;
        out.push(r);
      }
    }
    return out;
  };
  const logPayment = (bookingId: string, amount: number, method: string, note: string): Payment => {
    const p: Payment = { id: nextId('PY', db.payments.map((x) => x.id)), bookingId, at: nowStamp(today), amount, method, by: me, note };
    db.payments.push(p);
    return p;
  };

  return {
    mode: 'demo',
    session: async () => session,
    login: async () => session,
    logout: async () => undefined,

    load: async () => {
      await wait();
      const bundle: DataBundle = { rooms: db.rooms, guests: db.guests, bookings: db.bookings, payments: db.payments, today, warnings: [], setupNeeded: false, mode: 'demo', background: session.background };
      return clone(bundle);
    },

    createBooking: async (input) => {
      await wait();
      const errors = validateBooking(input, ctx(), input.advance);
      if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
      const rooms = roomsOf(input.rooms);
      const mobile = normalizeMobile(input.mobile);
      let guest = db.guests.find((g) => normalizeMobile(g.mobile) === mobile);
      const guestCreated = !guest;
      if (!guest) {
        guest = { id: nextId('GS', db.guests.map((g) => g.id)), name: input.name.trim(), mobile, email: input.email.trim(), idType: input.idType, idLast4: input.idLast4.trim(), city: input.city.trim(), createdAt: '' };
        db.guests.push(guest);
      }
      const nights = diffDays(input.ci, input.co);
      const price = rooms.reduce((s, r) => s + r.price, 0);
      const advance = Math.round(input.advance || 0);
      const discount = Math.round(input.discount || 0);
      const eta = formatEta(input.eta);
      const booking: Booking = {
        id: nextId('BK', db.bookings.map((b) => b.id)),
        guestId: guest.id,
        guest: input.name.trim(),
        mobile,
        rooms: [...input.rooms],
        ci: input.ci,
        co: input.co,
        nights,
        price,
        discount,
        ...money(price, nights, advance, discount),
        paid: advance,
        source: input.source,
        stage: 'reserved',
        people: input.people,
        eta,
        etaMin: parseEtaMinutes(eta),
        notes: input.notes.trim(),
        createdBy: me,
        updatedBy: me,
        createdAt: '',
        updatedAt: '',
      };
      db.bookings.push(booking);
      const payment = advance > 0 ? logPayment(booking.id, advance, input.method, 'Advance at booking') : null;
      return clone({ booking, guest, guestCreated, payment });
    },

    updateBooking: async (input) => {
      await wait();
      const b = must(db.bookings.find((x) => x.id === input.id), 'That booking was not found. Refresh and try again.');
      if (b.stage === 'cancelled') throw new ApiError(409, 'This booking is cancelled. Move it back to Reserved before editing it.');
      if (b.stage === 'out' && (input.ci !== b.ci || input.co !== b.co || !sameRooms(b.rooms, input.rooms))) {
        throw new ApiError(409, 'The dates and rooms of a stay that has finished cannot be changed. You can still fix the guest details, notes, source and discount.');
      }
      const errors = validateBooking(input, ctx(), b.paid, b);
      if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
      const move = planRoomMove(b, input.rooms, db.rooms, db.bookings);
      if (!move.ok) throw new ApiError(409, move.error);
      const price = sameRooms(b.rooms, input.rooms) ? b.price : roomsOf(input.rooms).reduce((s, r) => s + r.price, 0);
      const guest = must(db.guests.find((g) => g.id === b.guestId), 'The guest record is missing.');
      guest.name = input.name.trim();
      guest.mobile = normalizeMobile(input.mobile);
      guest.email = input.email.trim();
      guest.city = input.city.trim();
      guest.idType = input.idType;
      guest.idLast4 = input.idLast4.trim();
      const nights = diffDays(input.ci, input.co);
      const discount = Math.round(input.discount || 0);
      const eta = formatEta(input.eta);
      Object.assign(b, {
        guest: guest.name,
        mobile: guest.mobile,
        rooms: [...input.rooms],
        ci: input.ci,
        co: input.co,
        nights,
        price,
        discount,
        ...money(price, nights, b.paid, discount),
        source: input.source,
        people: input.people,
        eta,
        etaMin: parseEtaMinutes(eta),
        notes: input.notes.trim(),
        updatedBy: me,
      });
      return clone({ booking: b, guest, rooms: applyRoomChanges(move.roomChanges) });
    },

    setStage: async (id, to, restore) => {
      await wait();
      const b = must(db.bookings.find((x) => x.id === id), 'That booking was not found.');
      const plan = planStage(b, roomsOf(b.rooms), db.bookings, to, restore);
      if (!plan.ok) throw new ApiError(409, plan.error);
      b.stage = to;
      b.updatedBy = me;
      return clone({ booking: b, rooms: applyRoomChanges(plan.roomChanges) });
    },

    setRoomStatus: async (no, status) => {
      await wait();
      const room = must(db.rooms.find((r) => r.no === no), 'That room was not found.');
      const plan = planRoomStatus(room, db.bookings, status);
      if (!plan.ok) throw new ApiError(409, plan.error);
      room.manual = status;
      return clone({ room });
    },

    createRoom: async (input) => {
      await wait();
      const types = roomTypes(db.rooms);
      const errors = validateNewRoom(input, db.rooms, types.map((t) => t.type));
      if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
      const t = types.find((x) => x.type === input.type)!;
      const room: Room = { id: nextId('RM', db.rooms.map((r) => r.id)), no: input.no, floor: input.floor, type: t.type, bed: t.bed, cap: t.cap, price: t.price, manual: 'available', notes: '' };
      db.rooms.push(room);
      db.rooms.sort((a, b) => a.no - b.no);
      return clone({ room });
    },

    generateRooms: async (input) => {
      await wait();
      const types = roomTypes(db.rooms);
      const t = types.find((x) => x.type === input.type);
      const e: Record<string, string> = {};
      if (!Number.isInteger(input.floors) || input.floors < 1 || input.floors > 9) e.floors = 'Choose 1 to 9 floors.';
      if (!Number.isInteger(input.perFloor) || input.perFloor < 1 || input.perFloor > 30) e.perFloor = 'Choose 1 to 30 rooms per floor.';
      if (!Number.isInteger(input.rate) || input.rate < 100 || input.rate > 200000) e.rate = 'Enter a nightly rate between ₹100 and ₹2,00,000.';
      if (!t) e.type = 'Choose a room type from the list.';
      if (Object.keys(e).length) throw new ApiError(422, 'Please fix the highlighted fields.', e);
      const added: Room[] = [];
      let skipped = 0;
      for (let f = 1; f <= input.floors; f++) {
        for (let n = 1; n <= input.perFloor; n++) {
          const no = f * 100 + n;
          if (db.rooms.some((r) => r.no === no)) {
            skipped++;
            continue;
          }
          const room: Room = { id: nextId('RM', db.rooms.map((r) => r.id)), no, floor: f, type: t!.type, bed: t!.bed, cap: t!.cap, price: input.rate, manual: 'available', notes: '' };
          db.rooms.push(room);
          added.push(room);
        }
      }
      db.rooms.sort((a, b) => a.no - b.no);
      return clone({ added: added.length, skipped, rooms: added });
    },

    recordPayment: async (id, amount, method, note) => {
      await wait();
      const b = must(db.bookings.find((x) => x.id === id), 'That booking was not found.');
      const plan = planPayment(b, amount, method, note);
      if (!plan.ok) throw new ApiError(409, plan.error);
      b.paid = plan.paid;
      b.balance = b.total - b.paid;
      b.updatedBy = me;
      const payment = logPayment(id, amount, amount < 0 ? REFUND_METHOD : method, note.trim());
      return clone({ booking: b, payment });
    },

    health: async () => ({
      ok: true,
      checks: [{ name: 'Demo mode', ok: true, detail: 'Sample data kept in this browser tab only. Nothing is saved to Google Sheets.' }],
      sheetTitle: 'Demo data',
      counts: { rooms: db.rooms.length, guests: db.guests.length, bookings: db.bookings.length },
      setupNeeded: false,
    }),

    listStaff: async () => ({ staff: clone(db.staff) }),

    saveStaff: async (input) => {
      await wait();
      const username = input.username.trim().toLowerCase();
      const e: Record<string, string> = {};
      const existing = db.staff.find((s) => s.username === username);
      if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(username)) e.username = 'Use 3 to 24 letters, numbers, dots, dashes or underscores.';
      if (input.name.trim().length < 2) e.name = 'Enter the employee name.';
      if (!STAFF_ROLES.includes(input.role)) e.role = 'Choose a role.';
      if (!existing && !input.password) e.password = 'Set a password for this employee.';
      else if (input.password && passwordProblem(input.password, username, input.name)) e.password = passwordProblem(input.password, username, input.name) ?? '';
      if (Object.keys(e).length) throw new ApiError(422, 'Please fix the highlighted fields.', e);
      if (existing) Object.assign(existing, { name: input.name.trim(), role: input.role, active: input.active });
      else db.staff.push({ username, name: input.name.trim(), role: input.role, active: input.active, createdAt: today });
      return clone({ staff: db.staff });
    },

    setupSheet: async () => ({ changes: [] }),

    security: async (): Promise<SecurityReport> => {
      const t = Date.now();
      const ago = (min: number) => new Date(t - min * 60_000).toISOString();
      return {
        checks: [
          { id: 'two-step', ok: false, title: 'Owner 2-step code', detail: 'Off in this demo. In the real app, switch it on with "npm run setup".' },
          { id: 'https', ok: true, title: 'Private connection', detail: 'The demo runs inside your browser; nothing is sent anywhere.' },
          { id: 'owner-password', ok: true, title: 'Owner password length', detail: 'Not used in the demo.' },
        ],
        events: [
          { at: ago(4), type: 'login', who: 'owner', ip: '203.0.113.7', detail: 'owner' },
          { at: ago(35), type: 'login-failed', who: 'owner', ip: '198.51.100.23', detail: '' },
          { at: ago(36), type: 'login-failed', who: 'admin', ip: '198.51.100.23', detail: '' },
          { at: ago(190), type: 'login', who: 'asha', ip: '203.0.113.7', detail: '' },
        ],
      };
    },
    signOutAll: async () => undefined,

    setBackground: async (kind) => ({ background: setBg(kind, null) }),
    uploadBackground: async (kind, file) => ({ background: setBg(kind, URL.createObjectURL(file)) }),

    sheetLink: async () => {
      throw new ApiError(409, 'Demo mode has no Google Sheet.');
    },
  };
}
