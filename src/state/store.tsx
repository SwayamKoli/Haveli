/**
 * The app state: loads the hotel data, refreshes it every 45 seconds and offers every action (book, check in, pay...) to the screens.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { MANUAL_LABEL } from '../../shared/constants';
import { planRoomStatus, planStage, roomsLabel } from '../../shared/rules';
import type {
  Booking,
  DataBundle,
  EditBookingInput,
  NewBookingInput,
  NewRoomInput,
  Room,
  RoomManual,
  RoomsGenerateInput,
  StaffInfo,
  Stage,
} from '../../shared/types';
import { ApiError, type Backend } from '../lib/api';
import { setBackground } from '../lib/background';
import { errText, inr } from '../lib/format';
import type { LayerState, MenuState, Result, Store, ToastItem, Ui } from './types';

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

export function StoreProvider({ backend, staff, hotel, onLogout, children }: { backend: Backend; staff: StaffInfo | null; hotel: string; onLogout: () => void; children: ReactNode }) {
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
      setBackground(fresh.background);
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
  const putRooms = (list: Room[]) => setData((d) => d && { ...d, rooms: d.rooms.map((x) => list.find((r) => r.no === x.no) ?? x) });

  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    pending.current++;
    try {
      return await work();
    } finally {
      pending.current--;
    }
  }

  /* ----- actions ----- */
  async function setStage(id: string, to: Stage, opts: { silent?: boolean; restore?: Record<number, RoomManual> } = {}): Promise<boolean> {
    const d = dataRef.current;
    const b = d?.bookings.find((x) => x.id === id);
    if (!d || !b) return false;
    const mine = d.rooms.filter((r) => b.rooms.includes(r.no));
    const plan = planStage(b, mine, d.bookings, to, opts.restore);
    if (!plan.ok) {
      toast(plan.error, { err: true });
      return false;
    }
    const before = { booking: b, rooms: mine };
    putBooking({ ...b, stage: to });
    putRooms(plan.roomChanges.map((c) => ({ ...mine.find((r) => r.no === c.no)!, manual: c.manual })));

    if (!opts.silent) {
      const due = b.balance > 0 && to === 'out' ? ` ${inr(b.balance)} is still due.` : '';
      const where = b.rooms.length > 1 ? `rooms ${roomsLabel(b.rooms)}` : `room ${b.rooms[0]}`;
      const msg: Record<Stage, string> = {
        in: `${b.guest} checked in to ${where}.`,
        out: b.stage === 'in' ? `${b.guest} checked out. ${b.rooms.length > 1 ? 'Rooms need' : 'Room needs'} cleaning.${due}` : `${b.guest} marked as checked out.${due}`,
        reserved: 'Moved to Reserved.',
        cancelled: 'Booking cancelled.',
      };
      const restore = Object.fromEntries(mine.map((r) => [r.no, r.manual])) as Record<number, RoomManual>;
      toast(msg[to], { undo: () => void setStage(id, b.stage, { silent: true, restore }) });
    }

    try {
      const r = await guarded(() => backend.setStage(id, to, opts.restore));
      putBooking(r.booking);
      putRooms(r.rooms);
      return true;
    } catch (e) {
      putBooking(before.booking);
      putRooms(before.rooms);
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
          payments: r.payment ? [...d.payments, r.payment] : d.payments,
        },
      );
      toast(`Booking created for ${r.booking.guest}.`);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function updateBooking(input: EditBookingInput): Promise<Result> {
    try {
      const r = await guarded(() => backend.updateBooking(input));
      putBooking(r.booking);
      putRooms(r.rooms);
      setData((d) => d && { ...d, guests: d.guests.some((g) => g.id === r.guest.id) ? d.guests.map((g) => (g.id === r.guest.id ? r.guest : g)) : [...d.guests, r.guest] });
      toast(`Booking for ${r.booking.guest} updated.`);
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

  async function generateRooms(input: RoomsGenerateInput): Promise<Result> {
    try {
      const r = await guarded(() => backend.generateRooms(input));
      setData((d) => d && { ...d, rooms: [...d.rooms, ...r.rooms].sort((a, b) => a.no - b.no) });
      toast(r.added ? `${r.added} room${r.added === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} already existed` : ''}.` : 'Those rooms already exist. Nothing was added.');
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  async function recordPayment(id: string, amount: number, method: string, note: string): Promise<Result> {
    try {
      const r = await guarded(() => backend.recordPayment(id, amount, method, note));
      putBooking(r.booking);
      setData((d) => d && { ...d, payments: [...d.payments, r.payment] });
      toast(amount < 0 ? `${inr(-amount)} refunded to ${r.booking.guest}.` : `${inr(amount)} received from ${r.booking.guest}.`);
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
    hotel,
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
    updateBooking,
    createRoom,
    generateRooms,
    recordPayment,
    logout: onLogout,
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
