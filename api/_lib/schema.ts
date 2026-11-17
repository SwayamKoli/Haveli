/**
 * What the app expects the three tabs to look like. Columns are found by their
 * header text, not by position, so you can reorder columns or add your own
 * extra ones in the sheet without breaking anything.
 */

export interface ColSpec<K extends string> {
  key: K;
  /** First name is the official one; the rest are accepted spellings. */
  names: string[];
  /** The app cannot read the tab without this column. */
  required?: boolean;
  /** Added in a later version: reading works without it, but "Set up sheet" should add it. */
  added?: boolean;
}

export type RoomKey = 'id' | 'no' | 'floor' | 'type' | 'bed' | 'cap' | 'price' | 'manual' | 'notes' | 'updated';
export type GuestKey = 'id' | 'name' | 'mobile' | 'email' | 'idType' | 'idLast4' | 'city' | 'created';
export type BookingKey =
  | 'id'
  | 'guestId'
  | 'guest'
  | 'room'
  | 'ci'
  | 'co'
  | 'nights'
  | 'price'
  | 'discount'
  | 'total'
  | 'paid'
  | 'balance'
  | 'source'
  | 'stage'
  | 'people'
  | 'eta'
  | 'notes'
  | 'createdBy'
  | 'updatedBy'
  | 'created'
  | 'updated';
export type PaymentKey = 'id' | 'booking' | 'at' | 'amount' | 'method' | 'by' | 'note';
export type StaffKey = 'username' | 'name' | 'role' | 'hash' | 'active' | 'created';

export const ROOMS_TAB = 'Rooms';
export const GUESTS_TAB = 'Guests';
export const BOOKINGS_TAB = 'Bookings';
export const PAYMENTS_TAB = 'Payments';
export const STAFF_TAB = 'Staff';

export const ROOM_COLS: ColSpec<RoomKey>[] = [
  { key: 'id', names: ['Room ID'] },
  { key: 'no', names: ['Room No', 'Room Number', 'Room'], required: true },
  { key: 'floor', names: ['Floor'] },
  { key: 'type', names: ['Type', 'Room Type'], required: true },
  { key: 'bed', names: ['Bed'] },
  { key: 'cap', names: ['Sleeps', 'Capacity'] },
  { key: 'price', names: ['Rate (₹/night)', 'Rate', 'Price'], required: true },
  { key: 'manual', names: ['Status'], required: true },
  { key: 'notes', names: ['Notes'] },
  { key: 'updated', names: ['Updated at'] },
];

export const GUEST_COLS: ColSpec<GuestKey>[] = [
  { key: 'id', names: ['Guest ID'], required: true },
  { key: 'name', names: ['Name', 'Guest name'], required: true },
  { key: 'mobile', names: ['Mobile', 'Phone'], required: true },
  { key: 'email', names: ['Email'] },
  { key: 'idType', names: ['ID type'] },
  { key: 'idLast4', names: ['ID last 4', 'ID last four'] },
  { key: 'city', names: ['City'] },
  { key: 'created', names: ['Created at'] },
];

export const BOOKING_COLS: ColSpec<BookingKey>[] = [
  { key: 'id', names: ['Booking ID'], required: true },
  { key: 'guestId', names: ['Guest ID'], required: true },
  { key: 'guest', names: ['Guest name', 'Guest'], required: true },
  { key: 'room', names: ['Room No', 'Room'], required: true },
  { key: 'ci', names: ['Check-in', 'Check in'], required: true },
  { key: 'co', names: ['Check-out', 'Check out'], required: true },
  { key: 'nights', names: ['Nights'] },
  { key: 'price', names: ['Rate (₹/night)', 'Rate', 'Price'], required: true },
  { key: 'discount', names: ['Discount (₹)', 'Discount'], added: true },
  { key: 'total', names: ['Total (₹)', 'Total'] },
  { key: 'paid', names: ['Paid (₹)', 'Paid'], required: true },
  { key: 'balance', names: ['Balance (₹)', 'Balance'] },
  { key: 'source', names: ['Source'], required: true },
  { key: 'stage', names: ['Stage'], required: true },
  { key: 'people', names: ['Guests', 'People'] },
  { key: 'eta', names: ['Expected arrival', 'ETA'] },
  { key: 'notes', names: ['Notes'] },
  { key: 'createdBy', names: ['Created by', 'Booked by'], added: true },
  { key: 'updatedBy', names: ['Updated by'], added: true },
  { key: 'created', names: ['Created at'] },
  { key: 'updated', names: ['Updated at'] },
];

export const PAYMENT_COLS: ColSpec<PaymentKey>[] = [
  { key: 'id', names: ['Payment ID'], required: true },
  { key: 'booking', names: ['Booking ID'], required: true },
  { key: 'at', names: ['Date', 'Paid at'], required: true },
  { key: 'amount', names: ['Amount (₹)', 'Amount'], required: true },
  { key: 'method', names: ['Method'] },
  { key: 'by', names: ['Received by'] },
  { key: 'note', names: ['Note', 'Notes'] },
];

export const STAFF_COLS: ColSpec<StaffKey>[] = [
  { key: 'username', names: ['Username'], required: true },
  { key: 'name', names: ['Name'], required: true },
  { key: 'role', names: ['Role'] },
  { key: 'hash', names: ['Password hash'], required: true },
  { key: 'active', names: ['Active'], required: true },
  { key: 'created', names: ['Created at'] },
];

/** Every tab the app uses. Rooms, Guests and Bookings must exist to read anything; the others can be added by "Set up sheet". */
export const TAB_SPECS: { tab: string; cols: ColSpec<string>[]; core: boolean }[] = [
  { tab: ROOMS_TAB, cols: ROOM_COLS as ColSpec<string>[], core: true },
  { tab: GUESTS_TAB, cols: GUEST_COLS as ColSpec<string>[], core: true },
  { tab: BOOKINGS_TAB, cols: BOOKING_COLS as ColSpec<string>[], core: true },
  { tab: PAYMENTS_TAB, cols: PAYMENT_COLS as ColSpec<string>[], core: false },
  { tab: STAFF_TAB, cols: STAFF_COLS as ColSpec<string>[], core: false },
];

/** "Rate (₹/night)" and "rate  (₹ / night)" count as the same header. */
export function normHeader(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface HeaderMap<K extends string> {
  /** Zero-based column of each key, or -1 when the sheet has no such column. */
  idx: Record<K, number>;
  /** Official names of required columns that are missing. */
  missing: string[];
}

export function mapHeaders<K extends string>(header: unknown[], specs: ColSpec<K>[]): HeaderMap<K> {
  const normalized = header.map(normHeader);
  const idx = {} as Record<K, number>;
  const missing: string[] = [];
  for (const spec of specs) {
    let found = -1;
    for (const name of spec.names) {
      const at = normalized.indexOf(normHeader(name));
      if (at >= 0) {
        found = at;
        break;
      }
    }
    idx[spec.key] = found;
    if (found < 0 && spec.required) missing.push(spec.names[0]);
  }
  return { idx, missing };
}

/** 0 -> A, 25 -> Z, 26 -> AA */
export function colLetter(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
