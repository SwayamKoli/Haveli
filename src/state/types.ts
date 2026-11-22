/**
 * The shapes of the app state: filters, the open pop-up, toasts, and what the store offers.
 */
import type {
  DataBundle,
  EditBookingInput,
  FieldErrors,
  NewBookingInput,
  NewRoomInput,
  RoomManual,
  RoomsGenerateInput,
  StaffInfo,
  Stage,
} from '../../shared/types';
import type { Backend } from '../lib/api';

export interface Ui {
  bq: string;
  bsrc: string;
  bview: 'board' | 'list';
  rq: string;
  rst: string;
  rfl: string;
  gq: string;
  mov: 'arr' | 'dep';
}

export type LayerState =
  | { kind: 'booking' }
  | { kind: 'booking-edit'; id: string }
  | { kind: 'booking-view'; id: string }
  | { kind: 'room-add' }
  | { kind: 'room'; no: number }
  | { kind: 'payment'; id: string }
  | { kind: 'confirm-logout' }
  | { kind: 'owner-sheet' }
  | null;

export interface ToastItem {
  id: number;
  msg: string;
  err?: boolean;
  undo?: () => void;
}

export interface MenuState {
  id: string;
  rect: DOMRect;
}

export type Result = { ok: true } | { ok: false; error: string; fields: FieldErrors };

export interface Store {
  backend: Backend;
  data: DataBundle;
  staff: StaffInfo | null;
  /** Name of the hotel, shown in the sidebar. */
  hotel: string;
  loadedAt: number;
  ui: Ui;
  setUi: (patch: Partial<Ui>) => void;
  layer: LayerState;
  openLayer: (l: LayerState) => void;
  closeLayer: () => void;
  menu: MenuState | null;
  setMenu: (m: MenuState | null) => void;
  toasts: ToastItem[];
  toast: (msg: string, opts?: { err?: boolean; undo?: () => void }) => void;
  dismissToast: (id: number) => void;
  reload: (silent?: boolean) => Promise<void>;
  setStage: (id: string, to: Stage, opts?: { silent?: boolean; restore?: Record<number, RoomManual> }) => Promise<boolean>;
  setRoom: (no: number, status: RoomManual, opts?: { silent?: boolean }) => Promise<boolean>;
  createBooking: (input: NewBookingInput) => Promise<Result>;
  updateBooking: (input: EditBookingInput) => Promise<Result>;
  createRoom: (input: NewRoomInput) => Promise<Result>;
  generateRooms: (input: RoomsGenerateInput) => Promise<Result>;
  recordPayment: (id: string, amount: number, method: string, note: string) => Promise<Result>;
  logout: () => void;
}
