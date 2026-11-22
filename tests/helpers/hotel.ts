/**
 * What most API tests share: a fresh fake Google with five rooms and the owner signed in before every test,
 * plus small builders for bookings and a few ways to read the fake sheet.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach } from 'node:test';
import { forgetStaffCache } from '../../api/sheets';
import { addDays, todayInZone } from '../../shared/dates';
import { FakeGoogle } from './fakeGoogle';
import { call, setEnv, signIn } from './harness';

export const TODAY = todayInZone('Asia/Kolkata');
export let g: FakeGoogle;
export let owner: string; // cookie of the owner

/** A booking as the form sends it. Room 101 is 2,800 a night, room 102 is 4,200. */
export function newBooking(over: Record<string, unknown> = {}) {
  return {
    name: 'Neha Kulkarni', mobile: '9876543210', source: 'Direct', ci: TODAY, co: addDays(TODAY, 2), rooms: [101], discount: 0,
    advance: 1000, method: 'Cash', people: 2, eta: '14:00', email: 'neha@example.com', city: 'Pune', idType: 'Aadhaar', idLast4: '4321', notes: '',
    ...over,
  };
}

/** The same fields for an edit. */
export function editBody(id: string, over: Record<string, unknown> = {}) {
  const { advance: _a, method: _m, ...rest } = newBooking();
  return { ...rest, id, ...over };
}

export const colOf = (tab: string, header: string): number => {
  const i = (g.tabs[tab][0] as string[]).indexOf(header);
  assert.ok(i >= 0, `no column "${header}" in ${tab}`);
  return i;
};
export const cellAt = (tab: string, row: number, header: string) => g.rows(tab)[row][colOf(tab, header)];
/** Put a row in a tab by header name, the way someone typing in the sheet would. */
export function raw(tab: string, vals: Record<string, string | number>): void {
  g.addRawRow(tab, (g.tabs[tab][0] as string[]).map((h) => vals[h] ?? ''));
}

export async function makeStaff(username = 'asha', password = 'asha-pass-1', name = 'Asha Verma', role = 'Reception') {
  const r = await call('staff-save', { cookie: owner, body: { username, name, role, active: true, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return signIn(username, password);
}

export async function created(over: Record<string, unknown> = {}, cookie = owner) {
  const r = await call('booking-create', { cookie, body: newBooking(over) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.booking as { id: string; [k: string]: any };
}

/** Call once at the top of a test file: a fresh fake Google with five rooms, and the owner signed in, before every test. */
export function useHotel(): void {
  beforeEach(async () => {
    g = new FakeGoogle();
    g.install();
    setEnv(g);
    forgetStaffCache();
    g.addRoom(101);
    g.addRoom(102, 'Deluxe', 'Available', 4200);
    g.addRoom(103, 'Standard', 'Maintenance');
    g.addRoom(104);
    g.addRoom(105);
    owner = await signIn();
  });
  afterEach(() => g.uninstall());
}

