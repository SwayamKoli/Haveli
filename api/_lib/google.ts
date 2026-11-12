/**
 * Talks to Google Sheets with a service account, using nothing but Node's
 * built-in crypto and fetch (no Google packages to install or keep updated).
 */
import { createSign } from 'node:crypto';
import { getConfig } from './env';
import { HttpError } from './http';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

let cached: { token: string; exp: number } | null = null;

function b64url(s: string | Buffer): string {
  return Buffer.from(s).toString('base64url');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function resetTokenCache(): void {
  cached = null;
}

export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const { saEmail, saKey } = getConfig();
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({ iss: saEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  let signature: string;
  try {
    signature = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(saKey).toString('base64url');
  } catch {
    throw new HttpError(502, 'The Google private key could not be read. Paste the key exactly as it appears in the downloaded JSON file.');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claim}.${signature}`,
    }).toString(),
  });
  if (!res.ok) {
    let why = '';
    try {
      const j = (await res.json()) as { error_description?: string; error?: string };
      why = j.error_description || j.error || '';
    } catch {
      /* ignore */
    }
    console.error('Google token request failed', res.status, why);
    throw new HttpError(502, `Google refused the service account sign-in${why ? ` (${why})` : ''}. Check GOOGLE_SERVICE_ACCOUNT_JSON.`);
  }
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

async function explain(res: Response): Promise<HttpError> {
  let message = '';
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    message = j.error?.message ?? '';
  } catch {
    /* ignore */
  }
  console.error('Sheets API error', res.status, message);
  const { saEmail } = getConfig();
  if (res.status === 403) {
    return new HttpError(502, `Google says this account may not use the sheet. Share the sheet with ${saEmail} and give it Editor access.`);
  }
  if (res.status === 404) {
    return new HttpError(502, 'Google could not find the sheet. Check SHEET_ID in the settings.');
  }
  if (res.status === 400 && /unable to parse range/i.test(message)) {
    const tab = /range:\s*([^\s,]+)/i.exec(message)?.[1] ?? 'a tab';
    return new HttpError(502, `The sheet has no tab called "${tab}". Tabs must be named Rooms, Guests and Bookings.`);
  }
  if (res.status === 429) {
    return new HttpError(503, 'Google is limiting requests right now. Wait a few seconds and try again.');
  }
  return new HttpError(502, 'Google Sheets returned an error. Please try again in a moment.');
}

/** Calls the Sheets API for the configured spreadsheet. `path` starts with "/" or "?". */
export async function sheetsRequest<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const { sheetId } = getConfig();
  const url = `${BASE}/${encodeURIComponent(sheetId)}${path}`;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;
    // 429 / 503 mean Google did not process the request, so retrying cannot duplicate a write.
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      cached = null;
      continue;
    }
    throw await explain(res);
  }
}
