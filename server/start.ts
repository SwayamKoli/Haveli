/**
 * Runs the finished app: serves the built website from dist/ and the /api routes.
 *   npm run build   (once, and after every code change)
 *   npm start
 * Set PORT to change the port (default 3000) and HOST=0.0.0.0 to let other
 * devices on your Wi-Fi open it (default is this computer only).
 * Add --open to open the browser once it is running (the customer start scripts do).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './adapt';
import { loadDotEnv } from './dotenv';

// Works both from source (server/start.ts, run by tsx) and as the bundled server.mjs in a customer folder.
const HERE = dirname(fileURLToPath(import.meta.url));

// .env: the folder the app was started from first, then next to this file, then the project root.
for (const dir of [process.cwd(), HERE, resolve(HERE, '..')]) loadDotEnv(join(dir, '.env'));

// dist/: next to this file (customer folder), or in the project root (source checkout), or where it was started.
const DIST = [join(HERE, 'dist'), resolve(HERE, '..', 'dist'), resolve(process.cwd(), 'dist')].find((d) => existsSync(join(d, 'index.html'))) ?? resolve(process.cwd(), 'dist');
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

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('The website files (the dist folder) are missing. Developers: run "npm run build" first. Customers: unzip the whole folder again.');
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
  const url = `http://${shown}:${PORT}`;
  console.log(`Haveli is running at ${url}`);
  console.log('Keep this window open while you use it. Press Ctrl+C to stop.');
  if (process.argv.includes('--open')) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
    } catch {
      /* the address above can be opened by hand */
    }
  }
});
