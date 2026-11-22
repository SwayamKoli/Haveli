/**
 * Protection around the web server itself (the app's own rules are in api/auth):
 *   securityHeaders   what every answer tells the browser: no other site may frame or script this page, no cameras, ...
 *   hostAllowed       refuses requests for another website name when the app is only meant for this computer
 *   httpsRedirect     sends anyone who arrived over plain http to the https address
 *   hardenServer      time and size limits against connections that are slow on purpose
 *   looseEnvFiles     finds a .env that other users of this computer could read
 */
import { statSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { isHttps, trustedProxies } from '../api/lib/http';
import { isPublic } from './network';

/**
 * Content-Security-Policy: the page may load scripts, styles, fonts, images and video only from itself, and talk only to
 * itself. Even if a hacker got text into a page, the browser would refuse to run it or send data elsewhere.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** For the background photo or video: it is only ever shown, never run. */
export const MEDIA_CSP = "default-src 'none'; sandbox";

const PERMISSIONS = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'accelerometer', 'gyroscope', 'magnetometer'].map((p) => `${p}=()`).join(', ');

/** Headers every answer carries. HSTS and "upgrade insecure requests" only when the person is on https. */
export function securityHeaders(req: IncomingMessage, res: ServerResponse): void {
  const https = isHttps({ headers: req.headers, query: {} });
  res.setHeader('Content-Security-Policy', https ? `${CSP}; upgrade-insecure-requests` : CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', PERMISSIONS);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

/** The website name in a Host header, without the port: "localhost:3000" -> "localhost", "[::1]:3000" -> "[::1]". */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

/**
 * When the app is only for this computer, a web page on the internet could still point its own name at 127.0.0.1 and ask the
 * app for data ("DNS rebinding"). Refusing every other name stops that. ALLOWED_HOSTS (comma separated) pins the names
 * of a public site the same way. A server behind a proxy accepts the names the proxy forwards.
 */
export function hostAllowed(req: IncomingMessage, listenHost: string): boolean {
  const raw = String(req.headers.host ?? '');
  const name = hostName(raw);
  const pinned = (process.env.ALLOWED_HOSTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (pinned.length) return pinned.includes(name) || pinned.includes(raw.trim().toLowerCase());
  if (!isPublic(listenHost) && trustedProxies() === 0) return ['localhost', '127.0.0.1', '[::1]'].includes(name);
  return true;
}

/** Where to send a visitor who came over plain http through a proxy; null when nothing needs redirecting. */
export function httpsRedirect(req: IncomingMessage): string | null {
  if (trustedProxies() === 0) return null;
  if (String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() !== 'http') return null;
  const host = String(req.headers.host ?? '');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const path = String(req.url ?? '/');
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Limits for connections that are slow or huge on purpose. Real phones and the 20 MB upload fit well inside them. */
export function hardenServer(server: Server): void {
  server.headersTimeout = 15_000;
  server.requestTimeout = 180_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 60;
  server.maxConnections = 1000;
}

/** Paths of .env files that every user of this computer can read (Mac, Linux). Windows keeps files private by folder. */
export function looseEnvFiles(files: string[]): string[] {
  if (process.platform === 'win32') return [];
  const out: string[] = [];
  for (const f of files) {
    try {
      if (statSync(f).mode & 0o077) out.push(f);
    } catch {
      /* no such file */
    }
  }
  return out;
}
