/**
 * Employees in the Staff tab: checking a sign-in, listing, adding and editing. Passwords are stored scrambled.
 */
import { STAFF_ROLES } from '../../shared/constants';
import { stampInZone } from '../../shared/dates';
import type { StaffMember, StaffSaveInput } from '../../shared/types';
import { dummyHash, fingerprint, hashPassword, verifyPassword } from '../auth/password';
import { getConfig } from '../lib/env';
import { HttpError } from '../lib/http';
import {
  appendRow,
  buildRow,
  cellUpdates,
  exclusive,
  fetchRanges,
  makeSheet,
  readSheets,
  txt,
  writeCells,
  type Cell,
  type Row,
} from './access';
import { parseStaff, type StaffRec } from './read';
import { STAFF_COLS, STAFF_TAB, type StaffKey } from './schema';

const STAFF_TTL_MS = 20_000;

let staffCache: { at: number; list: StaffRec[] } | null = null;

async function readStaff(): Promise<StaffRec[]> {
  let values: Row[] = [];
  try {
    values = (await fetchRanges([STAFF_TAB])).get(STAFF_TAB) ?? [];
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== 'NO_TAB') throw e;
  }
  const sheet = makeSheet<StaffKey>(STAFF_TAB, values, STAFF_COLS);
  return sheet.missing.length ? [] : parseStaff(sheet);
}

async function staffList(force = false): Promise<StaffRec[]> {
  if (!force && staffCache && Date.now() - staffCache.at < STAFF_TTL_MS) return staffCache.list;
  const list = await readStaff();
  staffCache = { at: Date.now(), list };
  return list;
}

export function forgetStaffCache(): void {
  staffCache = null;
}

/** Checks an employee's own password. Returns them, or null for a wrong username or password. */
export async function verifyEmployee(username: string, password: string): Promise<StaffMember & { fp: string } | null> {
  const rec = (await staffList(true)).find((x) => x.username === username);
  if (!rec) {
    await verifyPassword(password, await dummyHash()); // same effort as a real check
    return null;
  }
  if (!rec.active || !(await verifyPassword(password, rec.hash))) return null;
  return { ...stripStaff(rec), fp: fingerprint(rec.hash) };
}

/** For the owner signing in to an employee's account: the employee must exist and be active. */
export async function findActiveEmployee(username: string): Promise<StaffMember | null> {
  const rec = (await staffList(true)).find((x) => x.username === username);
  return rec && rec.active ? stripStaff(rec) : null;
}

/** Is this signed-in employee still allowed in (not switched off, password not changed since)? */
export async function employeeStillValid(username: string, fp: string, viaOwner: boolean): Promise<boolean> {
  const rec = (await staffList()).find((x) => x.username === username);
  if (!rec || !rec.active) return false;
  return viaOwner || fingerprint(rec.hash) === fp;
}

function stripStaff(r: StaffRec): StaffMember {
  return { username: r.username, name: r.name, role: r.role, active: r.active, createdAt: r.createdAt };
}

export async function listStaff(): Promise<StaffMember[]> {
  return (await staffList(true)).map(stripStaff);
}

async function saveStaffNow(input: StaffSaveInput, by: string): Promise<StaffMember[]> {
  const cfg = getConfig();
  const sheets = await readSheets();
  if (!sheets.staff.present || sheets.staff.missing.length) {
    throw new HttpError(409, 'The Staff tab is not set up yet. Press "Set up sheet" first.', undefined, 'SETUP');
  }
  const list = parseStaff(sheets.staff);
  const username = input.username.trim().toLowerCase();
  const existing = list.find((x) => x.username === username);
  const e: Record<string, string> = {};
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(username)) e.username = 'Use 3 to 24 letters, numbers, dots, dashes or underscores.';
  else if (username === cfg.ownerUsername) e.username = 'That username is the owner account.';
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) e.name = 'Enter the employee name.';
  if (!STAFF_ROLES.includes(input.role)) e.role = 'Choose a role.';
  const pw = input.password ?? '';
  if (!existing && !pw) e.password = 'Set a password for this employee.';
  if (pw && (pw.length < 6 || pw.length > 72)) e.password = 'Use 6 to 72 characters.';
  if (Object.keys(e).length) throw new HttpError(422, 'Please fix the highlighted fields.', e);

  const ss = sheets.staff;
  const now = stampInZone(cfg.timeZone, new Date());
  const hash = pw ? await hashPassword(pw) : '';
  if (existing) {
    const w: Partial<Record<StaffKey, Cell>> = { name: txt(name), role: input.role, active: input.active ? 'Yes' : 'No' };
    if (hash) w.hash = txt(hash);
    await writeCells(cellUpdates(ss, existing.row, w));
  } else {
    await appendRow(ss, buildRow(ss, { username: txt(username), name: txt(name), role: input.role, hash: txt(hash), active: input.active ? 'Yes' : 'No', created: txt(now) }));
  }
  void by;
  forgetStaffCache();
  return listStaff();
}

export const saveStaff = (...a: Parameters<typeof saveStaffNow>) => exclusive(() => saveStaffNow(...a));
