/**
 * What happens to every request, in order: security headers, /health, https redirect, allowed website name,
 * then /api, the background media, and last the website files. start.ts only opens the port and uses this.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from './adapt';
import { serveMedia } from './media-serve';
import { hostAllowed, httpsRedirect, securityHeaders } from './security';
import { serveStatic } from './static';

export function createApp(dist: string, listenHost: string): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    try {
      securityHeaders(req, res);
      // A damaged address (for example "http://[") must be answered, not crash the server.
      const url = new URL(req.url ?? '/', 'http://localhost');

      // For hosting services and uptime checks: no sign-in, no data.
      if (url.pathname === '/health') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end('ok');
        return;
      }

      // Plain http through a proxy: go to https before anything (a password, a cookie) is sent.
      const secure = httpsRedirect(req);
      if (secure) {
        res.statusCode = 308;
        res.setHeader('Location', secure);
        res.end();
        return;
      }
      if (!hostAllowed(req, listenHost)) {
        res.statusCode = 421;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('This address is not allowed. Open the app at the address it printed when it started.');
        return;
      }

      const api = /^\/api\/([a-z-]+)\/?$/.exec(url.pathname);
      if (api) {
        handleApi(req, res, api[1]).catch((e) => fail(res, e));
        return;
      }

      if (serveMedia(req, res)) return;
      serveStatic(req, res, dist);
    } catch (e) {
      fail(res, e);
    }
  };
}

function fail(res: ServerResponse, e: unknown): void {
  console.error(e);
  if (!res.headersSent) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
  res.end();
}
