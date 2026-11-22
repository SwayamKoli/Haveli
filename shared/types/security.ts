/**
 * The owner's Security card: a checklist of how well protected this installation is, and the recent sign-in activity.
 */

export type SecurityEventType =
  | 'login'
  | 'login-failed'
  | 'login-blocked'
  | 'code-failed'
  | 'logout'
  | 'sign-out-all'
  | 'staff-saved'
  | 'sheet-link'
  | 'sheet-link-failed'
  | 'sheet-setup'
  | 'background-changed';

export interface SecurityEvent {
  /** ISO time. */
  at: string;
  type: SecurityEventType;
  /** The username involved (as typed for failures, so guessing shows up). */
  who: string;
  /** The visitor's address. */
  ip: string;
  detail: string;
}

export interface SecurityCheck {
  id: string;
  ok: boolean;
  /** What is checked, in plain words. */
  title: string;
  /** What it means and what to do about it. */
  detail: string;
}

export interface SecurityReport {
  checks: SecurityCheck[];
  /** Newest first. Kept in memory, so a restart clears it. */
  events: SecurityEvent[];
}
