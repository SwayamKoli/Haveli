/**
 * Connects Node's plain http server to the request handler in api/handler.ts.
 * Used by `npm start` (server/start.ts) and by `npm run dev` (vite.config.mts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../api/handler';
import type { ApiRequest, ApiResponse } from '../api/_lib/http';

const MAX_BODY = 100_000;

function readText(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Answers /api/<action>. `pathname` is the part after /api/. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
  let body: unknown;
  if (req.method === 'POST') {
    try {
      const text = await readText(req);
      body = text ? JSON.parse(text) : {};
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The request was not valid JSON.' }));
      return;
    }
  }

  const apiReq: ApiRequest = { method: req.method, headers: req.headers, query: { action }, body };
  const apiRes: ApiResponse = {
    setHeader(name, value) {
      res.setHeader(name, value as string | string[]);
      return apiRes;
    },
    status(code) {
      res.statusCode = code;
      return apiRes;
    },
    json(payload) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return apiRes;
    },
  };
  await handler(apiReq, apiRes);
}
