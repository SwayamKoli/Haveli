/**
 * Serves the built website (the dist folder). Text files are sent compressed when the browser accepts it,
 * which matters on a phone with a slow connection.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt']);

const gzipCache = new Map<string, { mtime: number; body: Buffer }>();

function gzipped(file: string, mtime: number, body: Buffer): Buffer {
  const hit = gzipCache.get(file);
  if (hit && hit.mtime === mtime) return hit.body;
  const out = gzipSync(body, { level: 9 });
  gzipCache.set(file, { mtime, body: out });
  return out;
}

/** Answers a request for a page, script, style or font. Unknown paths get index.html (the app handles its own pages). */
export function serveStatic(req: IncomingMessage, res: ServerResponse, dist: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file: string;
  try {
    file = normalize(join(dist, decodeURIComponent(url.pathname)));
  } catch {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }
  if (file !== dist && !file.startsWith(dist + sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  const ext = extname(file);
  let body: Buffer = readFileSync(file);
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  // Hashed asset files never change; index.html must always be re-checked.
  res.setHeader('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (COMPRESSIBLE.has(ext) && body.length > 1024) {
    res.setHeader('Vary', 'Accept-Encoding');
    if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
      body = gzipped(file, statSync(file).mtimeMs, body);
      res.setHeader('Content-Encoding', 'gzip');
    }
  }
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}
