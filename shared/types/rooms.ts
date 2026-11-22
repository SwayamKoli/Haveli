/**
 * A room, what state it is in, and the forms that add rooms.
 */
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
