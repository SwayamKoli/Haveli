/**
 * Tiny request/response types so the server code does not depend on any
 * package. Vercel's request and response objects satisfy these.
 */
export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
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
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.fields = fields;
  }
}

export function header(req: ApiRequest, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** The JSON body as an object. Vercel parses JSON for us; strings are parsed here as a fallback. */
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

export function clientIp(req: ApiRequest): string {
  const fwd = header(req, 'x-forwarded-for');
  return (fwd.split(',')[0] || header(req, 'x-real-ip') || 'unknown').trim();
}

export function isHttps(req: ApiRequest): boolean {
  return header(req, 'x-forwarded-proto').split(',')[0].trim() === 'https';
}
