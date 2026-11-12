import handler from '../../api/handler';
import type { ApiRequest, ApiResponse } from '../../api/_lib/http';
import { resetTokenCache } from '../../api/_lib/google';
import { FakeGoogle, SHEET_ID } from './fakeGoogle';

export const PASSWORD = 'correct horse battery';
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
    APP_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    HOTEL_TIMEZONE: 'Asia/Kolkata',
    STAFF_NAME: 'Test Staff',
    STAFF_ROLE: 'Admin',
    ...overrides,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetTokenCache();
}

export interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  cookie?: string;
  /** Leave out the anti-forgery header on purpose. */
  noCsrf?: boolean;
  ip?: string;
}

export async function call(action: string, opts: CallOptions = {}): Promise<Reply> {
  const method = opts.method ?? (['session', 'data', 'health'].includes(action) ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? '10.0.0.1', 'x-forwarded-proto': 'https' };
  if (method === 'POST' && !opts.noCsrf) headers['x-requested-with'] = 'haveli';
  if (opts.cookie) headers.cookie = opts.cookie;
  const req: ApiRequest = { method, headers, query: { action }, body: opts.body };

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

export async function signIn(): Promise<string> {
  const r = await call('login', { body: { password: PASSWORD } });
  if (r.status !== 200) throw new Error(`sign-in failed in test: ${JSON.stringify(r.body)}`);
  return String(r.headers['set-cookie']).split(';')[0];
}
