import type { RoomManual, RoomState, Stage } from './types';

export const STAGES: Stage[] = ['reserved', 'in', 'out', 'cancelled'];

/** These exact words are what the Stage column in the sheet holds. */
export const STAGE_LABEL: Record<Stage, string> = {
  reserved: 'Reserved',
  in: 'Checked in',
  out: 'Checked out',
  cancelled: 'Cancelled',
};

export const ROOM_STATE_LABEL: Record<RoomState, string> = {
  available: 'Available',
  occupied: 'Occupied',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
};

/** What the Status column in the sheet holds. */
export const MANUAL_LABEL: Record<RoomManual, string> = {
  available: 'Available',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
};

export const SOURCES = ['Direct', 'Walk-in', 'MakeMyTrip', 'Booking.com', 'Goibibo'];

export const ID_TYPES = ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'Other'];

/**
 * Starting point for a brand new room type. Once any room of a type exists in the
 * sheet, its bed, sleeps and rate are copied from there instead, so edits made in
 * the sheet always win.
 */
export const TYPE_DEFAULTS: Record<string, { bed: string; cap: number; price: number }> = {
  Standard: { bed: 'Double', cap: 2, price: 2800 },
  Deluxe: { bed: 'Queen', cap: 3, price: 4200 },
  Executive: { bed: 'King', cap: 3, price: 5600 },
  Suite: { bed: 'King', cap: 4, price: 9500 },
};

/** Indian mobile number: 10 digits starting with 6-9. */
export const MOBILE_RE = /^[6-9]\d{9}$/;

export const MAX_STAY_NIGHTS = 60;
