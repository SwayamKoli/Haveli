/**
 * The app's single source of truth: data from the backend, filters, toasts,
 * open dialogs, and every action that changes something. Actions update the
 * screen immediately, then confirm with the server, and roll back with a clear
 * message if the server says no.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MANUAL_LABEL } from '../shared/constants';
import { planStage, planRoomStatus } from '../shared/rules';
import type { Booking, DataBundle, FieldErrors, NewBookingInput, NewRoomInput, Room, RoomManual, Stage, StaffInfo } from '../shared/types';
import { ApiError } from './lib/api';
import type { Backend } from './lib/api';
import { errText, inr } from './lib/format';

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
  | { kind: 'room-add' }
  | { kind: 'room'; no: number }
  | { kind: 'payment'; id: string }
  | { kind: 'settings' }
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

type Result = { ok: true } | { ok: false; error: string; fields: FieldErrors };

export interface Store {
  backend: Backend;
  data: DataBundle;
  staff: StaffInfo | null;
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
  setStage: (id: string, to: Stage, opts?: { silent?: boolean; restore?: RoomManual }) => Promise<boolean>;
  setRoom: (no: number, status: RoomManual, opts?: { silent?: boolean }) => Promise<boolean>;
  createBooking: (input: NewBookingInput) => Promise<Result>;
  createRoom: (input: NewRoomInput) => Promise<Result>;
  recordPayment: (id: string, amount: number) => Promise<Result>;
  logout: () => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}

const INITIAL_UI: Ui = { bq: '', bsrc: 'All', bview: 'board', rq: '', rst: 'All', rfl: 'All', gq: '', mov: 'arr' };
const POLL_MS = 45_000;

function Splash({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="splash" role="status">
      {error ? (
        <>
          <h2>Could not load the hotel data</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={onRetry}>Try again</button>
        </>
      ) : (
        <p>Loading hotel data…</p>
      )}
    </div>
  );
}

export function StoreProvider({ backend, staff, onLogout, children }: { backend: Backend; staff: StaffInfo | null; onLogout: () => void; children: ReactNode }) {
  const [data, setData] = useState<DataBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [ui, setUiState] = useState<Ui>(INITIAL_UI);
  const [layer, setLayer] = useState<LayerState>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dataRef = useRef<DataBundle | null>(null);
  dataRef.current = data;
  const pending = useRef(0);
  const toastSeq = useRef(0);

  /* ----- loading ----- */
  async function reload(silent = false): Promise<void> {
    try {
      const fresh = await backend.load();
      setData(fresh);
      setLoadedAt(Date.now());
      setLoadError(null);
    } catch (e) {
      if (!silent || !dataRef.current) setLoadError(errText(e));
      if (!silent) toast(errText(e), { err: true });
    }
  }

  useEffect(() => {
    void reload();
    if (backend.mode !== 'live') return;
    const poll = () => {
      if (document.visibilityState === 'visible' && pending.current === 0) void reload(true);
    };
    const t = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  /* ----- small pieces ----- */
  function toast(msg: string, opts: { err?: boolean; undo?: () => void } = {}) {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, msg, err: opts.err, undo: opts.undo }]);
    setTimeout(() => dismissToast(id), opts.undo ? 6000 : opts.err ? 5000 : 3200);
  }
  function dismissToast(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  const putBooking = (b: Booking) => setData((d) => d && { ...d, bookings: d.bookings.map((x) => (x.id === b.id ? b : x)) });
  const putRoom = (r: Room) => setData((d) => d && { ...d, rooms: d.rooms.map((x) => (x.no === r.no ? r : x)) });

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    pending.current++;
    try {
      return await work();
    } finally {
      pending.current--;
    }
  }

  /* ----- actions ----- */
  async function setStage(id: string, to: Stage, opts: { silent?: boolean; restore?: RoomManual } = {}): Promise<boolean> {
    const d = dataRef.current;
    const b = d?.bookings.find((x) => x.id === id);
    if (!d || !b) return false;
    const room = d.rooms.find((r) => r.no === b.room);
    const plan = planStage(b, room, d.bookings, to, opts.restore);
    if (!plan.ok) {
      toast(plan.error, { err: true });
      return false;
    }
    const before = { booking: b, room };
    putBooking({ ...b, stage: to });
    if (plan.roomManual && room) putRoom({ ...room, manual: plan.roomManual });

    if (!opts.silent) {
      const due = b.balance > 0 && to === 'out' ? ` ${inr(b.balance)} is still due.` : '';
      const msg: Record<Stage, string> = {
        in: `${b.guest} checked in to room ${b.room}.`,
        out: b.stage === 'in' ? `${b.guest} checked out. Room ${b.room} needs cleaning.${due}` : `${b.guest} marked as checked out.${due}`,
        reserved: 'Moved to Reserved.',
        cancelled: 'Booking cancelled.',
      };
      toast(msg[to], { undo: () => void setStage(id, b.stage, { silent: true, restore: room?.manual }) });
    }

    try {
      const r = await guarded(() => backend.setStage(id, to, opts.restore));
      putBooking(r.booking);
      if (r.room) putRoom(r.room);
      return true;
    } catch (e) {
      putBooking(before.booking);
      if (before.room) putRoom(before.room);
      toast(errText(e), { err: true });
      return false;
    }
  }

  async function setRoom(no: number, status: RoomManual, opts: { silent?: boolean } = {}): Promise<boolean> {
    const d = dataRef.current;
    const room = d?.rooms.find((r) => r.no === no);
    if (!d || !room) return false;
    const plan = planRoomStatus(room, d.bookings, status);
    if (!plan.ok) {
      toast(plan.error, { err: true });
      return false;
    }
    putRoom({ ...room, manual: status });
    if (!opts.silent) {
      toast(`Room ${no} is now ${MANUAL_LABEL[status].toLowerCase()}.`, { undo: () => void setRoom(no, room.manual, { silent: true }) });
    }
    try {
      const r = await guarded(() => backend.setRoomStatus(no, status));
      putRoom(r.room);
      return true;
    } catch (e) {
      putRoom(room);
      toast(errText(e), { err: true });
      return false;
    }
  }

  function fail(e: unknown): Result {
    if (e instanceof ApiError) return { ok: false, error: e.message, fields: e.fields ?? {} };
    return { ok: false, error: errText(e), fields: {} };
  }

  async function createBooking(input: NewBookingInput): Promise<Result> {
    try {
      const r = await guarded(() => backend.createBooking(input));
      setData((d) =>
        d && {
          ...d,
          bookings: [...d.bookings, r.booking],
          guests: r.guestCreated ? [...d.guests, r.guest] : d.guests.map((g) => (g.id === r.guest.id ? r.guest : g)),
        },
      );
      toast(`Booking created for ${r.booking.guest}.`);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function createRoom(input: NewRoomInput): Promise<Result> {
    try {
      const r = await guarded(() => backend.createRoom(input));
      setData((d) => d && { ...d, rooms: [...d.rooms, r.room].sort((a, b) => a.no - b.no) });
      toast(`Room ${r.room.no} added.`);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function recordPayment(id: string, amount: number): Promise<Result> {
    try {
      const r = await guarded(() => backend.recordPayment(id, amount));
      putBooking(r.booking);
      toast(`${inr(amount)} recorded for ${r.booking.guest}.`);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  if (!data) return <Splash error={loadError} onRetry={() => void reload()} />;

  const store: Store = {
    backend,
    data,
    staff,
    loadedAt,
    ui,
    setUi: (patch) => setUiState((u) => ({ ...u, ...patch })),
    layer,
    openLayer: setLayer,
    closeLayer: () => setLayer(null),
    menu,
    setMenu,
    toasts,
    toast,
    dismissToast,
    reload,
    setStage,
    setRoom,
    createBooking,
    createRoom,
    recordPayment,
    logout: onLogout,
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

