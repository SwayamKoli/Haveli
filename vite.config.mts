import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { loadDotEnv } from './server/dotenv';

/**
 * In development the same Vite server also answers /api, using the real
 * handler in api/handler.ts. So `npm run dev` is the whole app, one command.
 */
function apiDuringDev(): Plugin {
  return {
    name: 'haveli-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const m = /^\/api\/([a-z-]+)\/?(\?.*)?$/.exec(req.url ?? '');
        if (!m) return next();
        try {
          const mod = (await server.ssrLoadModule('/server/adapt.ts')) as typeof import('./server/adapt');
          await mod.handleApi(req, res, m[1]);
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

export default defineConfig(() => {
  // Make everything in .env visible to the API code (not to the browser).
  loadDotEnv(resolve(process.cwd(), '.env'));

  return {
    plugins: [react(), apiDuringDev()],
    build: { target: 'es2020', chunkSizeWarningLimit: 800 },
    server: { port: 5173, host: process.env.HOST || '127.0.0.1' },
    preview: { port: 4173 },
  };
});
