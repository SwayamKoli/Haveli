/**
 * What the website can ask of the server (the Backend interface), and the real implementation that talks to /api. The demo implements the same interface (lib/demo).
 */
import type {
  BackgroundInfo,
  Booking,
  DataBundle,
  EditBookingInput,
  FieldErrors,
  Guest,
  HealthReport,
  NewBookingInput,
  NewRoomInput,
  Payment,
  Room,
  RoomManual,
  RoomsGenerateInput,
  SessionInfo,
  StaffMember,
  StaffSaveInput,
  Stage,
} from '../../shared/types';

/** Everything the screens need from "the server". The real one talks to the sheet; the demo one lives in memory. */
export interface Backend {
  mode: 'live' | 'demo';
  session(): Promise<SessionInfo>;
  login(username: string, password: string): Promise<SessionInfo>;
  logout(): Promise<void>;
  load(): Promise<DataBundle>;
  createBooking(input: NewBookingInput): Promise<{ booking: Booking; guest: Guest; guestCreated: boolean; payment: Payment | null }>;
  updateBooking(input: EditBookingInput): Promise<{ booking: Booking; guest: Guest; rooms: Room[] }>;
  /** `rooms` lists the rooms whose status changed (for example, all of them go to Cleaning at check-out). */
  setStage(id: string, to: Stage, restore?: Record<number, RoomManual>): Promise<{ booking: Booking; rooms: Room[] }>;
  setRoomStatus(no: number, status: RoomManual): Promise<{ room: Room }>;
  createRoom(input: NewRoomInput): Promise<{ room: Room }>;
  generateRooms(input: RoomsGenerateInput): Promise<{ added: number; skipped: number; rooms: Room[] }>;
  /** A negative amount gives money back. */
  recordPayment(id: string, amount: number, method: string, note: string): Promise<{ booking: Booking; payment: Payment }>;
  /* owner only */
  health(): Promise<HealthReport>;
  listStaff(): Promise<{ staff: StaffMember[] }>;
  saveStaff(input: StaffSaveInput): Promise<{ staff: StaffMember[] }>;
  setupSheet(): Promise<{ changes: string[]; style?: string }>;
  /** Gives every tab of the Google Sheet the Clay & Sand look. Colours only; no data is touched. */
  /** Plain theme or the drawn hotel scene. */
  setBackground(kind: 'none' | 'scene'): Promise<{ background: BackgroundInfo }>;
  /** A photo or a short video, shown to everyone. Replaces whatever was there before. */
  uploadBackground(kind: 'image' | 'video', file: File): Promise<{ background: BackgroundInfo }>;
  /** Asks for the owner password every time. The link is never sent to the browser otherwise. */
  sheetLink(password: string): Promise<{ url: string }>;
}

export class ApiError extends Error {
  status: number;
  fields?: FieldErrors;
  constructor(status: number, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

async function call<T>(action: string, opts: { method?: 'GET' | 'POST'; body?: unknown; file?: File; quiet401?: boolean } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/api/${action}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': opts.file ? 'application/octet-stream' : 'application/json', 'X-Requested-With': 'haveli' },
      body: opts.file ?? (method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that it is running and try again.');
  }
  type Body = { error?: string; fields?: FieldErrors } | null;
  const data: Body = await res.json().then(
    (j: unknown) => j as Body,
    () => null, // not JSON
  );
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet401) window.dispatchEvent(new Event('haveli:unauthorized'));
    throw new ApiError(res.status, data?.error ?? `The server answered with an error (${res.status}).`, data?.fields);
  }
  return data as T;
}

export function makeLiveBackend(): Backend {
  const post = <T>(action: string, body?: unknown) => call<T>(action, { method: 'POST', body });
  return {
    mode: 'live',
    session: () => call<SessionInfo>('session'),
    login: (username, password) => call<SessionInfo>('login', { method: 'POST', body: { username, password }, quiet401: true }),
    logout: async () => {
      await post('logout');
    },
    load: () => call<DataBundle>('data'),
    createBooking: (input) => post('booking-create', input),
    updateBooking: (input) => post('booking-update', input),
    setStage: (id, to, restore) => post('booking-stage', { id, to, restore }),
    setRoomStatus: (no, status) => post('room-status', { no, status }),
    createRoom: (input) => post('room-create', input),
    generateRooms: (input) => post('rooms-generate', input),
    recordPayment: (id, amount, method, note) => post('booking-payment', { id, amount, method, note }),
    health: () => call<HealthReport>('health'),
    listStaff: () => call('staff-list'),
    saveStaff: (input) => post('staff-save', input),
    setupSheet: () => post('sheet-setup'),
    setBackground: (kind) => post('background-set', { kind }),
    uploadBackground: (kind, file) => call(`background-upload?kind=${kind}`, { method: 'POST', file }),
    sheetLink: (password) => call('sheet-link', { method: 'POST', body: { password }, quiet401: true }),
  };
}
