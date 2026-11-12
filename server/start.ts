/**
 * Runs the finished app: serves the built website from dist/ and the /api routes.
 *   npm run build   (once, and after every code change)
 *   npm start
 * Set PORT to change the port (default 3000) and HOST=0.0.0.0 to let other
 * devices on your Wi-Fi open it (default is this computer only).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { handleApi } from './adapt';

loadDotEnv(resolve(process.cwd(), '.env'));

const DIST = resolve(process.cwd(), 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Minimal .env reader so no extra package is needed. Real environment variables win. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('There is no dist/ folder yet. Run "npm run build" first, then "npm start".');
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const api = /^\/api\/([a-z-]+)\/?$/.exec(url.pathname);
  if (api) {
    handleApi(req, res, api[1]).catch((e) => {
      console.error(e);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    return;
  }

  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Hashed asset files never change; index.html must always be re-checked.
  res.setHeader('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.end(readFileSync(file));
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Haveli is running at http://${shown}:${PORT}`);
});
