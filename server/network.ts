/**
 * Where and how the server listens: on this computer only (the default), or on the internet
 * behind an https address. Read from .env (HOST, PORT, TRUST_PROXY) or detected on hosting services.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isHttps } from '../api/lib/http';

/** The hosting service this is running on, if one is recognised from the variables it sets. */
export function hostedOn(): string | null {
  const e = process.env;
  if (e.RENDER) return 'Render';
  if (e.RAILWAY_PROJECT_ID || e.RAILWAY_ENVIRONMENT) return 'Railway';
  if (e.FLY_APP_NAME) return 'Fly.io';
  if (e.K_SERVICE) return 'Google Cloud Run';
  if (e.DYNO) return 'Heroku';
  return null;
}

/** Hosting services sit behind exactly one proxy that adds the https and address headers; trust it unless told otherwise. */
export function applyHostingDefaults(): void {
  if (hostedOn() && process.env.TRUST_PROXY === undefined) process.env.TRUST_PROXY = '1';
}

export function listenPort(): number {
  return Number(process.env.PORT) || 3000;
}

/** This computer only by default. A hosting service, or HOST=0.0.0.0, opens it to other devices. */
export function listenHost(): string {
  return (process.env.HOST || '').trim() || (hostedOn() ? '0.0.0.0' : '127.0.0.1');
}

/** True when devices other than this computer can reach the server. */
export function isPublic(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
}

/** Warnings worth showing to whoever starts a server that other people can reach. */
export function publicWarnings(host: string): string[] {
  if (!isPublic(host)) return [];
  const out: string[] = [];
  const pw = process.env.OWNER_PASSWORD || process.env.APP_PASSWORD || '';
  if (pw && pw.length < 12) out.push('The owner password is short. On the internet use 12 or more characters (a few words work well).');
  if (!process.env.TRUST_PROXY || process.env.TRUST_PROXY === '0') {
    out.push('This server is open to other devices but TRUST_PROXY is not set. Open it only through an https address, and set TRUST_PROXY=1 when a host, tunnel or proxy sits in front (see README).');
  }
  return out;
}

/** Headers every answer carries. HSTS only when the person is on https. */
export function commonHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (isHttps({ headers: req.headers, query: {} })) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}
