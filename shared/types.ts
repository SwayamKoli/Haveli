/**
 * Types shared by the website (src/) and the server functions (api/).
 * Keep this file free of imports so both sides can use it.
 */

/** Booking stage. The sheet stores the long label (see STAGE_LABEL). */
export type Stage = 'reserved' | 'in' | 'out' | 'cancelled';

/** What staff set by hand. "Occupied" is never stored: it comes from a Checked-in booking. */
export type RoomManual = 'available' | 'cleaning' | 'maintenance';

/** Manual status plus the derived "occupied". */
export type RoomState = RoomManual | 'occupied';

export interface Room {
  id: string;
  no: number;
  floor: number;
  type: string;
  bed: string;
  /** How many people the room sleeps. */
  cap: number;
  /** Rate in rupees per night. */
  price: number;
  manual: RoomManual;
  notes: string;
}

export interface Guest {
  id: string;
  name: string;
  /** 10 digits, no country code. */
  mobile: string;
  email: string;
  idType: string;
  /** Only the last 4 digits of an ID are ever stored. */
  idLast4: string;
  city: string;
  createdAt: string;
}

export interface Booking {
  id: string;
  guestId: string;
  guest: string;
  /** Joined from the Guests tab; empty if the guest row is missing. */
  mobile: string;
  room: number;
  /** Check-in date, YYYY-MM-DD. */
  ci: string;
  /** Check-out date, YYYY-MM-DD. */
  co: string;
  nights: number;
  /** Rate per night at the time of booking. */
  price: number;
  total: number;
  paid: number;
  balance: number;
  source: string;
  stage: Stage;
  people: number;
  /** Expected arrival as shown to staff, e.g. "2:00 PM". May be empty. */
  eta: string;
  /** Minutes after midnight, or null when unknown. Used for sorting. */
  etaMin: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DataBundle {
  rooms: Room[];
  guests: Guest[];
  bookings: Booking[];
  /** Today's date in the hotel's time zone, YYYY-MM-DD. */
  today: string;
  /** Rows in the sheet that the app could not understand. Shown to staff. */
  warnings: string[];
  mode: 'live' | 'demo';
}

export interface StaffInfo {
  name: string;
  role: string;
}

export interface SessionInfo {
  authenticated: boolean;
  /** False when the server is missing settings (see `missing`). */
  configured: boolean;
  /** Names of missing or invalid environment variables. Never values. */
  missing: string[];
  mode: 'live' | 'demo';
  staff: StaffInfo | null;
}

export interface NewBookingInput {
  name: string;
  mobile: string;
  source: string;
  /** Check-in, YYYY-MM-DD. */
  ci: string;
  /** Check-out, YYYY-MM-DD. */
  co: string;
  room: number;
  advance: number;
  people: number;
  /** 24-hour "HH:MM", or empty. */
  eta: string;
  email: string;
  city: string;
  idType: string;
  idLast4: string;
  notes: string;
}

export interface NewRoomInput {
  no: number;
  floor: number;
  type: string;
}

export type FieldErrors = Record<string, string>;

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HealthReport {
  ok: boolean;
  checks: HealthCheck[];
  sheetTitle: string;
  sheetUrl: string;
  counts: { rooms: number; guests: number; bookings: number };
}
