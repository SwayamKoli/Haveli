/**
 * Reads the server's settings from environment variables (the .env file in the
 * project folder). Secrets are never sent to the browser.
 */
import { passwordProblem } from '../../shared/rules';
import { validTotpSecret } from '../auth/totp';
import { HttpError } from './http';

export interface Config {
  sheetId: string;
  saEmail: string;
  saKey: string;
  /** The owner's "master" password. It also opens every employee's account. */
  ownerPassword: string;
  ownerUsername: string;
  ownerName: string;
  hotelName: string;
  sessionSecret: string;
  timeZone: string;
  /** The owner's 2-step code secret (OWNER_TOTP_SECRET). Empty when the 2-step code is not switched on. */
  ownerTotpSecret: string;
}

interface Account {
  email: string;
  key: string;
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Accepts the bare ID or the whole sheet URL. */
function parseSheetId(raw: string): string {
  const m = /\/d\/([a-zA-Z0-9_-]+)/.exec(raw);
  return m ? m[1] : raw;
}

/** Turns "\n" typed as two characters into real new lines and strips stray quotes. */
function cleanKey(raw: string): string {
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, '\n');
}

function readAccount(problems: string[]): Account {
  const json = env('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (json) {
    try {
      const o = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (!o.client_email || !o.private_key) {
        problems.push('GOOGLE_SERVICE_ACCOUNT_JSON (missing client_email or private_key)');
        return { email: '', key: '' };
      }
      return { email: o.client_email, key: cleanKey(o.private_key) };
    } catch {
      problems.push('GOOGLE_SERVICE_ACCOUNT_JSON (not valid JSON)');
      return { email: '', key: '' };
    }
  }
  const email = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const key = cleanKey(env('GOOGLE_PRIVATE_KEY'));
  if (!email) problems.push('GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)');
  else if (!key) problems.push('GOOGLE_PRIVATE_KEY');
  else if (!key.includes('BEGIN') || !key.includes('PRIVATE KEY')) problems.push('GOOGLE_PRIVATE_KEY (not a private key)');
  return { email, key };
}

/** OWNER_PASSWORD, or APP_PASSWORD from older installs. */
function ownerPassword(): string {
  return env('OWNER_PASSWORD') || env('APP_PASSWORD');
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Names of settings that are missing or wrong. Empty means the server is ready. */
export function configProblems(): string[] {
  const problems: string[] = [];
  readAccount(problems);
  if (!env('SHEET_ID')) problems.push('SHEET_ID');
  const pw = ownerPassword();
  if (!pw) problems.push('OWNER_PASSWORD');
  else if (pw.length < 8) problems.push('OWNER_PASSWORD (use at least 8 characters)');
  else if (passwordProblem(pw)) problems.push('OWNER_PASSWORD (too easy to guess: use a few unrelated words)');
  const secret = env('SESSION_SECRET');
  if (!secret) problems.push('SESSION_SECRET');
  else if (secret.length < 32) problems.push('SESSION_SECRET (use at least 32 characters)');
  if (env('OWNER_TOTP_SECRET') && !validTotpSecret(env('OWNER_TOTP_SECRET'))) problems.push('OWNER_TOTP_SECRET (not a valid key: run "npm run setup" to make a new one)');
  if (env('HOTEL_TIMEZONE') && !validZone(env('HOTEL_TIMEZONE'))) problems.push('HOTEL_TIMEZONE (unknown time zone)');
  return problems;
}

export function getConfig(): Config {
  const problems = configProblems();
  if (problems.length) {
    throw new HttpError(503, `The server is not set up yet. Fix these settings in the .env file: ${problems.join(', ')}.`);
  }
  const problemsIgnored: string[] = [];
  const acct = readAccount(problemsIgnored);
  return {
    sheetId: parseSheetId(env('SHEET_ID')),
    saEmail: acct.email,
    saKey: acct.key,
    ownerPassword: ownerPassword(),
    ownerUsername: (env('OWNER_USERNAME') || 'owner').toLowerCase(),
    ownerName: env('OWNER_NAME') || 'Owner',
    hotelName: hotelName(),
    sessionSecret: env('SESSION_SECRET'),
    timeZone: env('HOTEL_TIMEZONE') || 'Asia/Kolkata',
    ownerTotpSecret: env('OWNER_TOTP_SECRET').replace(/[\s-]/g, '').toUpperCase(),
  };
}

/** Safe to show before sign-in. */
export function hotelName(): string {
  return env('HOTEL_NAME') || 'My Hotel';
}
