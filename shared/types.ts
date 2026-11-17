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
  /** One or more rooms on the same booking (a family can take several). */
  rooms: number[];
  /** Check-in date, YYYY-MM-DD. */
  ci: string;
  /** Check-out date, YYYY-MM-DD. */
  co: string;
  nights: number;
  /** Combined rate per night of all rooms, before any discount. */
  price: number;
  /** Rupees taken off the whole stay. */
  discount: number;
  /** nights x price, before discount. */
  gross: number;
  /** What the guest has to pay: gross minus discount. */
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
  /** Who took the booking, and who changed it last. */
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** One payment received. The sum of a booking's payments is its Paid amount. */
export interface Payment {
  id: string;
  bookingId: string;
  /** "YYYY-MM-DD HH:mm" in the hotel's time zone. */
  at: string;
  amount: number;
  method: string;
  by: string;
  note: string;
}

export interface DataBundle {
  rooms: Room[];
  guests: Guest[];
  bookings: Booking[];
  payments: Payment[];
  /** Today's date in the hotel's time zone, YYYY-MM-DD. */
  today: string;
  /** Rows in the sheet that the app could not understand. Shown to staff. */
  warnings: string[];
  /** True when the sheet is missing tabs or columns the app now needs (owner can fix it in Settings). */
  setupNeeded: boolean;
  mode: 'live' | 'demo';
}

export interface StaffInfo {
  username: string;
  name: string;
  role: string;
  /** The owner account itself. */
  owner: boolean;
  /** Signed in to an employee's account with the owner's password. */
  viaOwner: boolean;
}

/** An employee as the owner sees them. The password is never sent anywhere. */
export interface StaffMember {
  username: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
}

export interface SessionInfo {
  authenticated: boolean;
  /** False when the server is missing settings (see `missing`). */
  configured: boolean;
  /** Names of missing or invalid environment variables. Never values. */
  missing: string[];
  mode: 'live' | 'demo';
  /** Shown on the sign-in screen and in the sidebar. */
  hotel: string;
  staff: StaffInfo | null;
}

/** What the booking form collects (the same fields for a new booking and for an edit). */
export interface BookingFields {
  name: string;
  mobile: string;
  source: string;
  /** Check-in, YYYY-MM-DD. */
  ci: string;
  /** Check-out, YYYY-MM-DD. */
  co: string;
  rooms: number[];
  /** Rupees off the whole stay. */
  discount: number;
  people: number;
  /** 24-hour "HH:MM", or empty. */
  eta: string;
  email: string;
  city: string;
  idType: string;
  idLast4: string;
  notes: string;
}

export interface NewBookingInput extends BookingFields {
  /** Money received now. */
  advance: number;
  /** How the advance was paid (see PAY_METHODS). */
  method: string;
}

export interface EditBookingInput extends BookingFields {
  id: string;
}

export interface StaffSaveInput {
  username: string;
  name: string;
  role: string;
  active: boolean;
  /** Required for a new employee; for an existing one it sets a new password. */
  password: string;
}

export interface NewRoomInput {
  no: number;
  floor: number;
  type: string;
}

/** Owner quick start: rooms 101..1nn, 201..2nn and so on. */
export interface RoomsGenerateInput {
  floors: number;
  perFloor: number;
  /** Nightly rate in rupees for every new room. */
  rate: number;
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
  counts: { rooms: number; guests: number; bookings: number };
  /** True when "Set up sheet" would add something. */
  setupNeeded: boolean;
}
