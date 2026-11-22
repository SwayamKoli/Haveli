/**
 * Calls the API handler directly, the way the server does, with a signed-in cookie when needed.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import handler from '../../api/handler';
import { resetAudit } from '../../api/auth/audit';
import { resetRevocations } from '../../api/auth/revocation';
import { resetThrottles } from '../../api/auth/throttle';
import { resetCodeReplay } from '../../api/auth/totp';
import type { ApiRequest, ApiResponse } from '../../api/lib/http';
import { resetTokenCache } from '../../api/sheets/google';
import { FakeGoogle, SHEET_ID } from './fakeGoogle';

export const PASSWORD = 'correct horse battery';
export const OWNER = 'owner';
export const SECRET = 'a-long-random-secret-for-tests-0123456789';

export interface Reply {
  status: number;
  body: any;
  headers: Record<string, string | string[] | number>;
}

export function setEnv(g: FakeGoogle, overrides: Record<string, string | undefined> = {}): void {
  const env: Record<string, string | undefined> = {
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: g.clientEmail, private_key: g.privateKey }),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: undefined,
    GOOGLE_PRIVATE_KEY: undefined,
    SHEET_ID,
    OWNER_PASSWORD: PASSWORD,
    APP_PASSWORD: undefined,
    OWNER_USERNAME: OWNER,
    OWNER_NAME: 'Test Owner',
    HOTEL_NAME: 'Test Hotel',
    SESSION_SECRET: SECRET,
    HOTEL_TIMEZONE: 'Asia/Kolkata',
    // Tests talk to the app the way a hosting service does: one proxy in front, adding the visitor's address.
    TRUST_PROXY: '1',
    OWNER_TOTP_SECRET: undefined,
    ALLOWED_HOSTS: undefined,
    // Every test gets its own empty media folder (it also holds the "signed out" list), and the security log stays quiet.
    MEDIA_DIR: process.env.MEDIA_DIR && !process.env.MEDIA_DIR.includes('haveli-test-media-') ? process.env.MEDIA_DIR : mkdtempSync(join(tmpdir(), 'haveli-test-media-')),
    HAVELI_QUIET: '1',
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetTokenCache();
  resetThrottles();
  resetAudit();
  resetRevocations();
  resetCodeReplay();
}

export interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  cookie?: string;
  /** Leave out the anti-forgery header on purpose. */
  noCsrf?: boolean;
  ip?: string;
  /** Extra or replacement request headers, and the address the server itself sees connecting. */
  headers?: Record<string, string>;
  socketIp?: string;
  /** The untouched bytes of an upload, and extra query values (such as kind=image). */
  raw?: Buffer;
  query?: Record<string, string>;
}

export async function call(action: string, opts: CallOptions = {}): Promise<Reply> {
  const method = opts.method ?? (['session', 'data', 'health', 'staff-list'].includes(action) ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '10.0.0.1', 'x-forwarded-proto': 'https' };
  if (method === 'POST' && !opts.noCsrf) headers['x-requested-with'] = 'haveli';
  if (opts.cookie) headers.cookie = opts.cookie;
  Object.assign(headers, opts.headers);
  const req: ApiRequest = { method, headers, query: { action, ...opts.query }, body: opts.body, raw: opts.raw, ip: opts.socketIp };

  const out: Reply = { status: 200, body: undefined, headers: {} };
  const res: ApiResponse = {
    setHeader(name, value) {
      out.headers[name.toLowerCase()] = value as string;
      return res;
    },
    status(code) {
      out.status = code;
      return res;
    },
    json(body) {
      out.body = body;
      return res;
    },
  };
  await handler(req, res);
  return out;
}

export async function signIn(username: string = OWNER, password: string = PASSWORD): Promise<string> {
  const r = await call('login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`sign-in failed in test: ${JSON.stringify(r.body)}`);
  return String(r.headers['set-cookie']).split(';')[0];
}
