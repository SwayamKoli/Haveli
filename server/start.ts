/**
 * Runs the finished app: serves the built website from dist/, the /api routes and the background media.
 *   npm run build   (once, and after every code change)
 *   npm start
 * PORT (default 3000), HOST (default: this computer only) and TRUST_PROXY are explained in .env.example.
 * Add --open to open the browser once it is running (the customer start scripts do).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './adapt';
import { loadDotEnv } from './dotenv';
import { serveMedia } from './media-serve';
import {
  applyHostingDefaults,
  commonHeaders,
  hostedOn,
  isPublic,
  listenHost,
  listenPort,
  publicWarnings,
} from './network';
import { serveStatic } from './static';

// Works both from source (server/start.ts, run by tsx) and as the bundled server.mjs in a customer folder.
const HERE = dirname(fileURLToPath(import.meta.url));

// .env: the folder the app was started from first, then next to this file, then the project root.
// Variables already set by the computer or the hosting service win over the file.
for (const dir of [process.cwd(), HERE, resolve(HERE, '..')]) loadDotEnv(join(dir, '.env'));
applyHostingDefaults();

// dist/: next to this file (customer folder), or in the project root (source checkout), or where it was started.
const DIST = [join(HERE, 'dist'), resolve(HERE, '..', 'dist'), resolve(process.cwd(), 'dist')].find((d) => existsSync(join(d, 'index.html'))) ?? resolve(process.cwd(), 'dist');
const PORT = listenPort();
const HOST = listenHost();

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('The website files (the dist folder) are missing. Developers: run "npm run build" first. Customers: unzip the whole folder again.');
  process.exit(1);
}

const server = createServer((req, res) => {
  commonHeaders(req, res);
  const url = new URL(req.url ?? '/', 'http://localhost');

  // For hosting services and uptime checks: no sign-in, no data.
  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end('ok');
    return;
  }

  const api = /^\/api\/([a-z-]+)\/?$/.exec(url.pathname);
  if (api) {
    handleApi(req, res, api[1]).catch((e) => {
      console.error(e);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    return;
  }

  if (serveMedia(req, res)) return;
  serveStatic(req, res, DIST);
});

server.listen(PORT, HOST, () => {
  const where = hostedOn();
  if (isPublic(HOST)) {
    console.log(`Haveli is running on port ${PORT}${where ? ` (${where})` : ''}, open to other devices. Open it through your https address.`);
    for (const w of publicWarnings(HOST)) console.warn(`Warning: ${w}`);
  } else {
    const url = `http://${HOST}:${PORT}`;
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
  }
});

// Hosting services stop the app with SIGTERM when they restart it: finish what is running, then leave.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
