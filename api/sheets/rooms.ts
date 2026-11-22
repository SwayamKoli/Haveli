/**
 * Rooms in the sheet: change a room's status, add one room, add many rooms at once.
 */
import { MANUAL_LABEL, TYPE_DEFAULTS } from '../../shared/constants';
import { nextId, planRoomStatus, validateNewRoom } from '../../shared/rules';
import type { NewRoomInput, Room, RoomManual, RoomsGenerateInput } from '../../shared/types';
import { HttpError } from '../lib/http';
import {
  appendRow,
  appendRows,
  buildRow,
  cellUpdates,
  exclusive,
  rawIds,
  txt,
  writeCells,
  type CellWrite,
  type Row,
} from './access';
import { assertReady, loadAll, pub, type Loaded, type RoomRec } from './read';

export const roomsOf = (L: Loaded, nos: number[]): RoomRec[] => nos.map((n) => L.rooms.find((r) => r.no === n)).filter((r): r is RoomRec => !!r);

export function roomWrites(L: Loaded, changes: { no: number; manual: RoomManual }[]): { writes: CellWrite[]; rooms: Room[] } {
  const writes: CellWrite[] = [];
  const rooms: Room[] = [];
  for (const c of changes) {
    const room = L.rooms.find((r) => r.no === c.no);
    if (!room) continue;
    writes.push(...cellUpdates(L.sheets.rooms, room.row, { manual: MANUAL_LABEL[c.manual], updated: txt(L.stamp) }));
    rooms.push({ ...pub(room), manual: c.manual });
  }
  return { writes, rooms };
}

async function changeRoomStatusNow(no: number, to: RoomManual) {
  const L = await loadAll();
  const room = L.rooms.find((r) => r.no === no);
  if (!room) throw new HttpError(404, 'That room was not found. Refresh and try again.');
  const plan = planRoomStatus(room, L.bookings, to);
  if (!plan.ok) throw new HttpError(409, plan.error);
  await writeCells(cellUpdates(L.sheets.rooms, room.row, { manual: MANUAL_LABEL[to], updated: txt(L.stamp) }));
  return { room: { ...pub(room), manual: to } as Room };
}

async function addRoomNow(input: NewRoomInput) {
  const L = await loadAll();
  const knownTypes = Array.from(new Set([...L.rooms.map((r) => r.type), ...Object.keys(TYPE_DEFAULTS)]));
  const errors = validateNewRoom(input, L.rooms, knownTypes);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields.', errors);

  const sample = L.rooms.find((r) => r.type === input.type);
  const def = TYPE_DEFAULTS[input.type];
  const bed = sample?.bed ?? def?.bed ?? '';
  const cap = sample?.cap ?? def?.cap ?? 2;
  const price = sample?.price ?? def?.price ?? 0;
  const rs = L.sheets.rooms;
  const id = nextId('RM', rawIds(rs, 'id'));
  await appendRow(
    rs,
    buildRow(rs, { id, no: input.no, floor: input.floor, type: txt(input.type), bed: txt(bed), cap, price, manual: MANUAL_LABEL.available, notes: '', updated: txt(L.stamp) }),
  );
  const room: Room = { id, no: input.no, floor: input.floor, type: input.type, bed, cap, price, manual: 'available', notes: '' };
  return { room };
}

/** Owner quick start: rooms 101..1nn, 201..2nn, and so on. Rooms that already exist are left alone. */
async function generateRoomsNow(input: RoomsGenerateInput) {
  const L = await loadAll();
  assertReady(L);
  const knownTypes = Array.from(new Set([...L.rooms.map((r) => r.type), ...Object.keys(TYPE_DEFAULTS)]));
  const e: Record<string, string> = {};
  if (!Number.isInteger(input.floors) || input.floors < 1 || input.floors > 9) e.floors = 'Choose 1 to 9 floors.';
  if (!Number.isInteger(input.perFloor) || input.perFloor < 1 || input.perFloor > 30) e.perFloor = 'Choose 1 to 30 rooms per floor.';
  if (!Number.isInteger(input.rate) || input.rate < 100 || input.rate > 200000) e.rate = 'Enter a nightly rate between ₹100 and ₹2,00,000.';
  if (!knownTypes.includes(input.type)) e.type = 'Choose a room type from the list.';
  if (Object.keys(e).length) throw new HttpError(422, 'Please fix the highlighted fields.', e);

  const sample = L.rooms.find((r) => r.type === input.type);
  const def = TYPE_DEFAULTS[input.type];
  const bed = sample?.bed ?? def?.bed ?? '';
  const cap = sample?.cap ?? def?.cap ?? 2;
  const have = new Set(L.rooms.map((r) => r.no));
  const rs = L.sheets.rooms;
  const ids = rawIds(rs, 'id');
  const rooms: Room[] = [];
  const rows: Row[] = [];
  let skipped = 0;
  for (let floor = 1; floor <= input.floors; floor++) {
    for (let n = 1; n <= input.perFloor; n++) {
      const no = floor * 100 + n;
      if (have.has(no)) {
        skipped++;
        continue;
      }
      const id = nextId('RM', ids);
      ids.push(id);
      rooms.push({ id, no, floor, type: input.type, bed, cap, price: input.rate, manual: 'available', notes: '' });
      rows.push(buildRow(rs, { id, no, floor, type: txt(input.type), bed: txt(bed), cap, price: input.rate, manual: MANUAL_LABEL.available, notes: '', updated: txt(L.stamp) }));
    }
  }
  await appendRows(rs, rows);
  return { added: rooms.length, skipped, rooms };
}

export const changeRoomStatus = (...a: Parameters<typeof changeRoomStatusNow>) => exclusive(() => changeRoomStatusNow(...a));

export const generateRooms = (...a: Parameters<typeof generateRoomsNow>) => exclusive(() => generateRoomsNow(...a));

export const addRoom = (...a: Parameters<typeof addRoomNow>) => exclusive(() => addRoomNow(...a));
