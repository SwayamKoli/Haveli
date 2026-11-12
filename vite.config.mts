import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig(({ mode }) => {
  // Make everything in .env visible to the API code (not to the browser).
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

  return {
    plugins: [react(), apiDuringDev()],
    build: { target: 'es2020', chunkSizeWarningLimit: 800 },
    server: { port: 5173, host: process.env.HOST || '127.0.0.1' },
    preview: { port: 4173 },
  };
});
