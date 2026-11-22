/**
 * The security log: who signed in, who failed, who changed what. The last 200 events are kept in memory (the owner
 * sees them in Settings -> Security) and every event is also printed, so a hosting service's log keeps the full history.
 */
import type { SecurityEvent, SecurityEventType } from '../../shared/types';

const MAX_EVENTS = 200;
const events: SecurityEvent[] = [];

/** Text that came from a visitor (a username, an address) must not be able to fake a log line. */
const clean = (s: string, max: number): string => String(s ?? '').replace(/[^\x20-\x7e -￿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function record(type: SecurityEventType, who: string, ip: string, detail = '', nowMs: number = Date.now()): void {
  const e: SecurityEvent = { at: new Date(nowMs).toISOString(), type, who: clean(who, 40), ip: clean(ip, 45), detail: clean(detail, 120) };
  events.unshift(e);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  if (!process.env.HAVELI_QUIET) console.log(`[security] ${e.at} ${e.type} user="${e.who}" ip=${e.ip}${e.detail ? ` ${e.detail}` : ''}`);
}

/** Newest first. */
export function recentEvents(limit = 100): SecurityEvent[] {
  return events.slice(0, limit);
}

/** For tests. */
export function resetAudit(): void {
  events.length = 0;
}
