/**
 * The connection check shown in Settings, and the link to open the sheet.
 */
import type { HealthCheck, HealthReport } from '../../shared/types';
import { configProblems, getConfig } from '../lib/env';
import { ALL_TABS, gaps, readSheets, why } from './access';
import { getAccessToken, sheetsRequest } from './google';
import { parseBookings, parseGuests, parseRooms } from './read';

export async function health(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const report: HealthReport = { ok: false, checks, sheetTitle: '', counts: { rooms: 0, guests: 0, bookings: 0 }, setupNeeded: false };

  const problems = configProblems();
  checks.push({
    name: 'Server settings',
    ok: problems.length === 0,
    detail: problems.length ? `Missing or invalid: ${problems.join(', ')}` : 'All settings found.',
  });
  if (problems.length) return report;

  const cfg = getConfig();

  try {
    await getAccessToken();
    checks.push({ name: 'Google sign-in', ok: true, detail: `Signed in as ${cfg.saEmail}.` });
  } catch (e) {
    checks.push({ name: 'Google sign-in', ok: false, detail: why(e) });
    return report;
  }

  let tabs: string[] = [];
  try {
    const meta = await sheetsRequest<{ properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] }>(
      'GET',
      '?fields=properties.title,sheets.properties.title',
    );
    report.sheetTitle = meta.properties?.title ?? '';
    tabs = (meta.sheets ?? []).map((s) => s.properties?.title ?? '');
    checks.push({ name: 'Sheet access', ok: true, detail: `Opened "${report.sheetTitle}".` });
  } catch (e) {
    checks.push({ name: 'Sheet access', ok: false, detail: why(e) });
    return report;
  }

  const absent = ALL_TABS.filter((t) => !tabs.includes(t));
  report.setupNeeded = absent.length > 0;
  checks.push({
    name: 'Tabs',
    ok: absent.length === 0,
    detail: absent.length ? `Missing tab(s): ${absent.join(', ')}.` : 'Rooms, Guests, Bookings, Payments and Staff found.',
  });

  try {
    const sheets = await readSheets();
    const missing = gaps(sheets);
    if (missing.length) report.setupNeeded = true;
    for (const s of [sheets.rooms, sheets.guests, sheets.bookings]) {
      checks.push({
        name: `${s.tab} columns`,
        ok: s.missing.length === 0,
        detail: s.missing.length ? `Missing in row 1: ${s.missing.join(', ')}.` : 'All required columns found.',
      });
    }
    if (missing.length) checks.push({ name: 'Setup', ok: false, detail: `Needs adding: ${missing.join(' · ')}. Press "Set up sheet".` });
    if (sheets.rooms.missing.length + sheets.guests.missing.length + sheets.bookings.missing.length === 0) {
      const warnings: string[] = [];
      const rooms = parseRooms(sheets.rooms, warnings);
      const guests = parseGuests(sheets.guests, warnings);
      const bookings = parseBookings(sheets.bookings, rooms, guests, warnings);
      report.counts = { rooms: rooms.length, guests: guests.length, bookings: bookings.length };
      checks.push({
        name: 'Rows',
        ok: warnings.length === 0,
        detail: warnings.length
          ? `${warnings.length} row(s) need attention. First: ${warnings[0]}`
          : `${rooms.length} rooms, ${guests.length} guests, ${bookings.length} bookings.`,
      });
    }
  } catch (e) {
    checks.push({ name: 'Reading data', ok: false, detail: why(e) });
  }
  report.ok = checks.every((c) => c.ok);
  return report;
}

/** The link to the spreadsheet itself. Only handed out after the owner password is confirmed. */
export function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${getConfig().sheetId}/edit`;
}
