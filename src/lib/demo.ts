/**
 * Demo mode: the same screens and the same business rules, but the data lives
 * in memory and resets when the page reloads. Start it with `npm run dev:demo`.
 */
import { SOURCES, TYPE_DEFAULTS } from '../../shared/constants';
import { addDays, diffDays } from '../../shared/dates';
import {
  formatEta,
  money,
  nextId,
  normalizeMobile,
  parseEtaMinutes,
  planPayment,
  planRoomStatus,
  planStage,
  validateNewBooking,
  validateNewRoom,
} from '../../shared/rules';
import type { Booking, DataBundle, Guest, Room, Stage } from '../../shared/types';
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

function seed(today: string): { rooms: Room[]; guests: Guest[]; bookings: Booking[] } {
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
  const mk = (stage: Stage, roomNo: number, ciOff: number, nights: number, pay: 'full' | 'part' | 'none') => {
    const room = rooms.find((r) => r.no === roomNo)!;
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
    const total = room.price * nights;
    const paid = pay === 'full' ? total : pay === 'part' ? Math.round((total * 0.3) / 100) * 100 : 0;
    const eta = formatEta(ETAS[i % 5]);
    bookings.push({
      id: nextId('BK', bookings.map((b) => b.id)),
      guestId: guest.id,
      guest: name,
      mobile,
      room: roomNo,
      ci,
      co,
      nights,
      price: room.price,
      ...money(room.price, nights, paid),
      paid,
      source: SOURCES[Math.floor(rand() * SOURCES.length)],
      stage,
      people: 1 + Math.floor(rand() * room.cap),
      eta,
      etaMin: parseEtaMinutes(eta),
      notes: '',
      createdAt: '',
      updatedAt: '',
    });
  };

  const pool = rooms.filter((r) => r.manual === 'available').map((r) => r.no);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const inHouse = pool.slice(0, 30);
  const upcoming = pool.slice(30, 38);
  const spare = pool.slice(38);
  inHouse.forEach((no, k) => {
    let ciOff: number;
    let nights: number;
    if (k % 4 === 0) {
      ciOff = -(1 + Math.floor(rand() * 3));
      nights = -ciOff;
    } else {
      ciOff = -Math.floor(rand() * 4);
      nights = -ciOff + 1 + Math.floor(rand() * 3);
    }
    mk('in', no, ciOff, nights, rand() < 0.7 ? 'full' : 'part');
  });
  const arrivals = [0, 0, 0, 1, 2, 3, 5, 6];
  upcoming.forEach((no, k) => mk('reserved', no, arrivals[k], 1 + Math.floor(rand() * 4), rand() < 0.5 ? 'part' : 'none'));
  for (let k = 0; k < 6; k++) mk('out', rooms[Math.floor(rand() * rooms.length)].no, -(6 + Math.floor(rand() * 5)), 2 + Math.floor(rand() * 2), 'full');
  mk('cancelled', spare[0], 2, 2, 'none');
  mk('cancelled', spare[1], 4, 1, 'none');
  return { rooms, guests, bookings };
}

const clone = <T>(v: T): T => structuredClone(v);
const wait = () => new Promise<void>((r) => setTimeout(r, 90));

export function makeDemoBackend(): Backend {
  const today = localToday();
  const db = seed(today);
  const session = { authenticated: true, configured: true, missing: [], mode: 'demo' as const, staff: { name: 'Demo user', role: 'Demo mode' } };

  const must = <T>(v: T | undefined, msg: string): T => {
    if (v === undefined) throw new ApiError(404, msg);
    return v;
  };

  return {
    mode: 'demo',
    session: async () => session,
    login: async () => session,
    logout: async () => undefined,

    load: async () => {
      await wait();
      const bundle: DataBundle = { rooms: db.rooms, guests: db.guests, bookings: db.bookings, today, warnings: [], mode: 'demo' };
      return clone(bundle);
    },

    createBooking: async (input) => {
      await wait();
      const errors = validateNewBooking(input, { rooms: db.rooms, bookings: db.bookings, today });
      if (Object.keys(errors).length) throw new ApiError(422, 'Please fix the highlighted fields.', errors);
      const room = db.rooms.find((r) => r.no === input.room)!;
      const mobile = normalizeMobile(input.mobile);
      let guest = db.guests.find((g) => normalizeMobile(g.mobile) === mobile);
      const guestCreated = !guest;
      if (!guest) {
        guest = { id: nextId('GS', db.guests.map((g) => g.id)), name: input.name.trim(), mobile, email: input.email.trim(), idType: input.idType, idLast4: input.idLast4.trim(), city: input.city.trim(), createdAt: '' };
        db.guests.push(guest);
      }
      const nights = diffDays(input.ci, input.co);
      const advance = Math.round(input.advance || 0);
      const eta = formatEta(input.eta);
      const booking: Booking = {
        id: nextId('BK', db.bookings.map((b) => b.id)),
        guestId: guest.id,
        guest: input.name.trim(),
        mobile,
        room: room.no,
        ci: input.ci,
        co: input.co,
        nights,
        price: room.price,
        ...money(room.price, nights, advance),
        paid: advance,
        source: input.source,
        stage: 'reserved',
        people: input.people,
        eta,
        etaMin: parseEtaMinutes(eta),
        notes: input.notes.trim(),
        createdAt: '',
        updatedAt: '',
      };
      db.bookings.push(booking);
      return clone({ booking, guest, guestCreated });
    },

    setStage: async (id, to, restore) => {
      await wait();
      const b = must(db.bookings.find((x) => x.id === id), 'That booking was not found.');
      const room = db.rooms.find((r) => r.no === b.room);
      const plan = planStage(b, room, db.bookings, to, restore);
      if (!plan.ok) throw new ApiError(409, plan.error);
      b.stage = to;
      if (plan.roomManual && room) room.manual = plan.roomManual;
      return clone({ booking: b, room: plan.roomManual && room ? room : null });
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

    recordPayment: async (id, amount) => {
      await wait();
      const b = must(db.bookings.find((x) => x.id === id), 'That booking was not found.');
      const plan = planPayment(b, amount);
      if (!plan.ok) throw new ApiError(409, plan.error);
      b.paid = plan.paid;
      b.balance = b.total - b.paid;
      return clone({ booking: b });
    },

    health: async () => ({
      ok: true,
      checks: [{ name: 'Demo mode', ok: true, detail: 'Sample data kept in this browser tab only. Nothing is saved to Google Sheets.' }],
      sheetTitle: 'Demo data',
      sheetUrl: '',
      counts: { rooms: db.rooms.length, guests: db.guests.length, bookings: db.bookings.length },
    }),
  };
}
