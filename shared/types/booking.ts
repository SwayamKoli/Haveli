/**
 * A booking (a stay of one or more rooms), its payments, and the forms that create or edit one.
 */
/**
 * Types shared by the website (src/) and the server functions (api/).
 * Keep this file free of imports so both sides can use it.
 */

/** Booking stage. The sheet stores the long label (see STAGE_LABEL). */
export type Stage = 'reserved' | 'in' | 'out' | 'cancelled';

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
