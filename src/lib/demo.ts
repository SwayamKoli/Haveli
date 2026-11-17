/**
 * Demo mode: the same screens and the same business rules, but the data lives
 * in memory and resets when the page reloads. Start it with `npm run dev:demo`.
 */
import { REFUND_METHOD, SOURCES, STAFF_ROLES, TYPE_DEFAULTS } from '../../shared/constants';
import { addDays, diffDays } from '../../shared/dates';
import {
  formatEta,
  money,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  planPayment,
  planRoomMove,
  planRoomStatus,
  planStage,
  sameRooms,
  validateBooking,
  validateNewRoom,
} from '../../shared/rules';
import type { Booking, DataBundle, Guest, Payment, Room, RoomManual, Stage, StaffMember } from '../../shared/types';
import { HOTEL_NAME } from '../config';
import { ApiError } from './api';
import type { Backend } from './api';
import { roomTypes } from './selectors';

const LAYOUT: Record<number, string> = { 1: 'SSSSSSDDDD', 2: 'SSSDDDDDEE', 3: 'DDDEEEEEUU', 4: 'DEEEEEEEUU', 5: 'EEEEEUUUUU' };
const LETTER: Record<string, string> = { S: 'Standard', D: 'Deluxe', E: 'Executive', U: 'Suite' };

const NAMES = [
  'Arjun Mehta', 'Priya Nair', 'Rohan Deshmukh', 'Ananya Iyer', 'Vikram Singh', 'Neha Kulkarni', 'Karan Malhotra',
  'Sneha Patil', 'Rahul Verma', 'Isha Kapoor', 'Aditya Rao', 'Meera Joshi', 'Siddharth Jain', 'Kavya Reddy',
  'Nikhil Bhatt', 'Pooja Sharma', 'Manish Gupta', 'Divya Menon', 'Harsh Vora', 'Tanvi Shah', 'Amit Chauhan',
  'Riya Banerjee', 'Yash Pawar', 'Shreya Kamat', 'Omkar Gaikwad', 'Aarti Pillai', 'Varun Saxena', 'Simran Kaur',
  'Deepak Naik', 'Nandini Rane', 'Gaurav Thakur', 'Ritu Agarwal', 'Sameer Khan', 'Lata Bhosale', 'Tushar More',
  'Alisha Dsouza', 'Kunal Sawant', 'Mitali Das', 'Pranav Kelkar', 'Bhavna Trivedi', 'Farhan Sheikh', 'Gauri Phadke',
  'Jatin Oberoi', 'Kritika Bose', 'Lakshman Iyer', 'Madhavi Kulkarni', 'Naveen Hegde', 'Ojas Bhide',
];
const CITIES = ['Pune', 'Mumbai', 'Nashik', 'Bengaluru', 'Delhi', 'Hyderabad', 'Goa', 'Ahmedabad'];
const ETAS = ['12:30', '14:00', '15:30', '17:15', '19:45'];
const DESK = ['Asha Verma', 'Ravi Kumar', 'Demo owner'];
const METHODS = ['Cash', 'UPI', 'UPI', 'Card'];

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const nowStamp = (today: string) => {
  const d = new Date();
  return `${today} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface Db {
  rooms: Room[];
  guests: Guest[];
  bookings: Booking[];
  payments: Payment[];
  staff: StaffMember[];
}

function seed(today: string): Db {
  const rand = rng(11);
  const rooms: Room[] = [];
  for (const f of [1, 2, 3, 4, 5]) {
    LAYOUT[f].split('').forEach((c, i) => {
      const type = LETTER[c];
      const def = TYPE_DEFAULTS[type];
      const no = f * 100 + i + 1;
      rooms.push({ id: `RM${String(rooms.length + 1).padStart(4, '0')}`, no, floor: f, type, bed: def.bed, cap: def.cap, price: def.price, manual: 'available', notes: '' });
    });
  }
  for (const n of [104, 207, 303, 402]) rooms.find((r) => r.no === n)!.manual = 'cleaning';
  for (const n of [110, 309]) rooms.find((r) => r.no === n)!.manual = 'maintenance';

  const guests: Guest[] = [];
  const bookings: Booking[] = [];
  const payments: Payment[] = [];
  const pay = (bookingId: string, amount: number, date: string, hour: number, by: string, note = '') => {
    if (amount <= 0) return;
    payments.push({
      id: nextId('PY', payments.map((p) => p.id)),
      bookingId,
      at: `${date} ${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`,
      amount,
      method: METHODS[Math.floor(rand() * METHODS.length)],
      by,
      note,
    });
  };

  const mk = (stage: Stage, roomNos: number[], ciOff: number, nights: number, mode: 'full' | 'part' | 'none', discount = 0) => {
    const list = roomNos.map((n) => rooms.find((r) => r.no === n)!);
    const i = bookings.length;
    const name = NAMES[i % NAMES.length];
    const mobile = String(6 + Math.floor(rand() * 4)) + Array.from({ length: 9 }, () => Math.floor(rand() * 10)).join('');
    const guest: Guest = {
      id: nextId('GS', guests.map((g) => g.id)),
      name,
      mobile,
      email: '',
      idType: 'Aadhaar',
      idLast4: String(1000 + Math.floor(rand() * 8999)),
      city: CITIES[i % CITIES.length],
      createdAt: '',
    };
    guests.push(guest);
    const ci = addDays(today, ciOff);
    const co = addDays(ci, nights);
    const price = list.reduce((s, r) => s + r.price, 0);
    const totals = money(price, nights, 0, discount);
    const paid = mode === 'full' ? totals.total : mode === 'part' ? Math.round((totals.total * 0.3) / 100) * 100 : 0;
    const eta = formatEta(ETAS[i % 5]);
    const by = DESK[i % DESK.length];
    const id = nextId('BK', bookings.map((b) => b.id));
    bookings.push({
      id,
      guestId: guest.id,
      guest: name,
      mobile,
      rooms: roomNos,
      ci,
      co,
      nights,
      price,
      discount,
      ...money(price, nights, paid, discount),
      paid,
      source: SOURCES[Math.floor(rand() * SOURCES.length)],
      stage,
      people: Math.max(1, Math.min(list.reduce((s, r) => s + r.cap, 0), 1 + Math.floor(rand() * list.length * 2))),
      eta,
      etaMin: parseEtaMinutes(eta),
      notes: '',
      createdBy: by,
      updatedBy: by,
      createdAt: '',
      updatedAt: '',
    });
    // The money came in on the day of arrival; a few guests settled up today.
    if (mode === 'full') {
      const today_ = stage === 'in' && rand() < 0.35;
      if (today_ && paid > 2000) {
        const first = Math.round((paid * 0.5) / 100) * 100;
        pay(id, first, ci < today ? ci : today, 11, by, 'Advance at booking');
        pay(id, paid - first, today, 9 + Math.floor(rand() * 8), by);
      } else pay(id, paid, ci < today ? ci : today, 10 + Math.floor(rand() * 8), by, 'Advance at booking');
    } else pay(id, paid, today, 9 + Math.floor(rand() * 8), by, 'Advance at booking');
  };

  const pool = rooms.filter((r) => r.manual === 'available').map((r) => r.no);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let at = 0;
  const take = (n: number) => pool.slice(at, (at += n));
  for (let k = 0, used = 0; used < 30; k++) {
    const want = k % 6 === 2 ? 2 : 1; // a few families have two rooms
    const nos = take(Math.min(want, 30 - used));
    used += nos.length;
    let ciOff: number;
    let nights: number;
    if (k % 4 === 0) {
      ciOff = -(1 + Math.floor(rand() * 3));
      nights = -ciOff;
    } else {
      ciOff = -Math.floor(rand() * 4);
      nights = -ciOff + 1 + Math.floor(rand() * 3);
    }
    mk('in', nos, ciOff, nights, rand() < 0.7 ? 'full' : 'part', k % 5 === 1 ? 500 : 0);
  }
  const arrivals = [0, 0, 0, 1, 2, 3, 5, 6];
  arrivals.forEach((off, k) => mk('reserved', take(k === 4 ? 3 : 1), off, 1 + Math.floor(rand() * 4), rand() < 0.5 ? 'part' : 'none', k === 3 ? 1000 : 0));
  for (let k = 0; k < 6; k++) mk('out', [rooms[Math.floor(rand() * rooms.length)].no], -(6 + Math.floor(rand() * 5)), 2 + Math.floor(rand() * 2), 'full');
  mk('cancelled', take(1), 2, 2, 'none');
  mk('cancelled', take(1), 4, 1, 'none');
  const staff: StaffMember[] = [
    { username: 'asha', name: 'Asha Verma', role: 'Reception', active: true, createdAt: today },
    { username: 'ravi', name: 'Ravi Kumar', role: 'Manager', active: true, createdAt: today },
  ];
  return { rooms, guests, bookings, payments, staff };
}

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
      const bundle: DataBundle = { rooms: db.rooms, guests: db.guests, bookings: db.bookings, payments: db.payments, today, warnings: [], setupNeeded: false, mode: 'demo' };
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
      else if (input.password && input.password.length < 6) e.password = 'Use 6 to 72 characters.';
      if (Object.keys(e).length) throw new ApiError(422, 'Please fix the highlighted fields.', e);
      if (existing) Object.assign(existing, { name: input.name.trim(), role: input.role, active: input.active });
      else db.staff.push({ username, name: input.name.trim(), role: input.role, active: input.active, createdAt: today });
      return clone({ staff: db.staff });
    },

    setupSheet: async () => ({ changes: [] }),

    sheetLink: async () => {
      throw new ApiError(409, 'Demo mode has no Google Sheet.');
    },
  };
}
