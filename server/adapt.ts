/**
 * Connects Node's plain http server to the request handler in api/handler.ts.
 * Used by `npm start` (server/start.ts) and by `npm run dev` (vite.config.mts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../api/handler';
import type { ApiRequest, ApiResponse } from '../api/_lib/http';
import { BACKGROUND_LIMITS } from '../shared/types';

const MAX_BODY = 100_000;
/** Uploads (a photo or a video) are read as raw bytes, up to the biggest allowed file plus a little room. */
const MAX_UPLOAD = BACKGROUND_LIMITS.videoBytes + 64 * 1024;
const UPLOADS = new Set(['background-upload']);

function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        chunks.length = 0;
        reject(new Error('too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

const readText = async (req: IncomingMessage) => (await readBytes(req, MAX_BODY)).toString('utf8');

/** Answers /api/<action>. `pathname` is the part after /api/. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const query: Record<string, string> = { action };
  for (const [k, v] of url.searchParams) if (k !== 'action') query[k] = v;

  let body: unknown;
  let raw: Buffer | undefined;
  if (req.method === 'POST' && UPLOADS.has(action)) {
    const tooBig = () => {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Connection', 'close');
      res.end(JSON.stringify({ error: 'That file is too big.' }));
      // Stop listening to whoever is still sending.
      setTimeout(() => req.destroy(), 3000).unref();
    };
    if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) return tooBig();
    try {
      raw = await readBytes(req, MAX_UPLOAD);
    } catch {
      return tooBig();
    }
  } else if (req.method === 'POST') {
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

  const apiReq: ApiRequest = { method: req.method, headers: req.headers, query, body, raw };
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
