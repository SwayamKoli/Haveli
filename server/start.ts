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
import { createApp } from './app';
import { loadDotEnv } from './dotenv';
import {
  applyHostingDefaults,
  hostedOn,
  isPublic,
  listenHost,
  listenPort,
  publicProblems,
  publicWarnings,
} from './network';
import { hardenServer, looseEnvFiles } from './security';

// Works both from source (server/start.ts, run by tsx) and as the bundled server.mjs in a customer folder.
const HERE = dirname(fileURLToPath(import.meta.url));

// .env: the folder the app was started from first, then next to this file, then the project root.
// Variables already set by the computer or the hosting service win over the file.
const ENV_FILES = [...new Set([process.cwd(), HERE, resolve(HERE, '..')].map((dir) => join(dir, '.env')))];
for (const f of ENV_FILES) loadDotEnv(f);
applyHostingDefaults();

// dist/: next to this file (customer folder), or in the project root (source checkout), or where it was started.
const DIST = [join(HERE, 'dist'), resolve(HERE, '..', 'dist'), resolve(process.cwd(), 'dist')].find((d) => existsSync(join(d, 'index.html'))) ?? resolve(process.cwd(), 'dist');
const PORT = listenPort();
const HOST = listenHost();

const problems = publicProblems(HOST);
if (problems.length) {
  for (const p of problems) console.error(`Not started: ${p}`);
  process.exit(1);
}
for (const f of looseEnvFiles(ENV_FILES)) console.warn(`Warning: ${f} can be read by other users of this computer. Run: chmod 600 "${f}"`);

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('The website files (the dist folder) are missing. Developers: run "npm run build" first. Customers: unzip the whole folder again.');
  process.exit(1);
}

const server = createServer(createApp(DIST, HOST));
hardenServer(server);
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
