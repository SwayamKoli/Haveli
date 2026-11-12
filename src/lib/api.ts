import type {
  Booking,
  DataBundle,
  FieldErrors,
  Guest,
  HealthReport,
  NewBookingInput,
  NewRoomInput,
  Room,
  RoomManual,
  SessionInfo,
  Stage,
} from '../../shared/types';

/** Everything the screens need from "the server". The real one talks to the sheet; the demo one lives in memory. */
export interface Backend {
  mode: 'live' | 'demo';
  session(): Promise<SessionInfo>;
  login(password: string): Promise<SessionInfo>;
  logout(): Promise<void>;
  load(): Promise<DataBundle>;
  createBooking(input: NewBookingInput): Promise<{ booking: Booking; guest: Guest; guestCreated: boolean }>;
  setStage(id: string, to: Stage, restore?: RoomManual): Promise<{ booking: Booking; room: Room | null }>;
  setRoomStatus(no: number, status: RoomManual): Promise<{ room: Room }>;
  createRoom(input: NewRoomInput): Promise<{ room: Room }>;
  recordPayment(id: string, amount: number): Promise<{ booking: Booking }>;
  health(): Promise<HealthReport>;
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

async function call<T>(action: string, opts: { method?: 'GET' | 'POST'; body?: unknown; quiet401?: boolean } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  let res: Response;
  try {
    res = await fetch(`/api/${action}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haveli' },
      body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Haveli server. Check that it is running and try again.');
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
  return {
    mode: 'live',
    session: () => call<SessionInfo>('session'),
    login: (password) => call<SessionInfo>('login', { method: 'POST', body: { password }, quiet401: true }),
    logout: async () => {
      await call('logout', { method: 'POST' });
    },
    load: () => call<DataBundle>('data'),
    createBooking: (input) => call('booking-create', { method: 'POST', body: input }),
    setStage: (id, to, restore) => call('booking-stage', { method: 'POST', body: { id, to, restore } }),
    setRoomStatus: (no, status) => call('room-status', { method: 'POST', body: { no, status } }),
    createRoom: (input) => call('room-create', { method: 'POST', body: input }),
    recordPayment: (id, amount) => call('booking-payment', { method: 'POST', body: { id, amount } }),
    health: () => call<HealthReport>('health'),
  };
}
