/**
 * The made-up hotel: 50 rooms on 5 floors, guests, bookings and payments.
 */
import { SOURCES, TYPE_DEFAULTS } from '../../../shared/constants';
import { addDays } from '../../../shared/dates';
import { formatEta, money, nextId, parseEtaMinutes } from '../../../shared/rules';
import type { Booking, Guest, Payment, Room, StaffMember, Stage } from '../../../shared/types';

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

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const nowStamp = (today: string) => {
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

export function seed(today: string): Db {
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
