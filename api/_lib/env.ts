/**
 * Reads the server's settings from environment variables (set in Vercel,
 * or in a .env file when running locally). Nothing here is ever sent to the browser.
 */
import { HttpError } from './http';

export interface Config {
  sheetId: string;
  saEmail: string;
  saKey: string;
  appPassword: string;
  sessionSecret: string;
  timeZone: string;
  staffName: string;
  staffRole: string;
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
  const pw = env('APP_PASSWORD');
  if (!pw) problems.push('APP_PASSWORD');
  else if (pw.length < 8) problems.push('APP_PASSWORD (use at least 8 characters)');
  const secret = env('SESSION_SECRET');
  if (!secret) problems.push('SESSION_SECRET');
  else if (secret.length < 24) problems.push('SESSION_SECRET (use at least 24 characters)');
  if (env('HOTEL_TIMEZONE') && !validZone(env('HOTEL_TIMEZONE'))) problems.push('HOTEL_TIMEZONE (unknown time zone)');
  return problems;
}

export function getConfig(): Config {
  const problems = configProblems();
  if (problems.length) {
    throw new HttpError(503, `The server is not set up yet. Fix these settings in Vercel: ${problems.join(', ')}.`);
  }
  const problemsIgnored: string[] = [];
  const acct = readAccount(problemsIgnored);
  return {
    sheetId: parseSheetId(env('SHEET_ID')),
    saEmail: acct.email,
    saKey: acct.key,
    appPassword: env('APP_PASSWORD'),
    sessionSecret: env('SESSION_SECRET'),
    timeZone: env('HOTEL_TIMEZONE') || 'Asia/Kolkata',
    staffName: env('STAFF_NAME') || 'Front desk',
    staffRole: env('STAFF_ROLE') || 'Admin',
  };
}
