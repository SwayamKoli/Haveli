/**
 * Tiny request/response types so the server code does not depend on any
 * package. Node's http objects (wrapped by server/adapt.ts) satisfy these.
 */
export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
  /** The untouched request body, for uploads (a photo or a video). */
  raw?: Buffer;
  /** The address of whoever is connected to the server (with a proxy in front, that is the proxy). */
  ip?: string;
}

export interface ApiResponse {
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
}

/** An error whose message is safe to show to the signed-in staff member. */
export class HttpError extends Error {
  status: number;
  fields?: Record<string, string>;
  /** Short machine-readable reason, for the few cases the server itself reacts to. */
  code?: string;
  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

export function header(req: ApiRequest, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** The JSON body as an object. */
export function readBody(req: ApiRequest): Record<string, unknown> {
  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      throw new HttpError(400, 'The request was not valid JSON.');
    }
  }
  if (b && typeof b === 'object' && !Array.isArray(b)) return b as Record<string, unknown>;
  return {};
}

/**
 * How many web servers (proxies) sit in front of this app: 0 when people connect directly, 1 for most hosting
 * services, a tunnel or Caddy/nginx. Set TRUST_PROXY in .env. Only then are the "forwarded" headers believed,
 * because anyone can type those headers themselves when they connect directly.
 */
export function trustedProxies(): number {
  const v = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'on') return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 10 ? n : 0;
}

/** The address of the person using the app, used to slow down password guessing. */
export function clientIp(req: ApiRequest): string {
  const hops = trustedProxies();
  if (hops > 0) {
    // Each proxy adds the address it saw to the end of the list, so count from the end: the first entries can be forged.
    const list = header(req, 'x-forwarded-for').split(',').map((x) => x.trim()).filter(Boolean);
    const seen = list[list.length - hops];
    if (seen) return seen;
  }
  return req.ip || 'unknown';
}

/** True when the person reached the app over https (through a proxy that says so). */
export function isHttps(req: ApiRequest): boolean {
  return trustedProxies() > 0 && header(req, 'x-forwarded-proto').split(',')[0].trim() === 'https';
}
