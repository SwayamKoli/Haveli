/**
 * Sign-in state, everything the dashboard loads in one go, form errors and the connection check.
 */
import type { BackgroundInfo } from './background';
import type { Booking, Payment } from './booking';
import type { Guest } from './guests';
import type { Room } from './rooms';
import type { StaffInfo } from './staff';

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
  background: BackgroundInfo;
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
  /** Shown behind the sign-in screen too, so it is part of the public session answer. */
  background: BackgroundInfo;
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
