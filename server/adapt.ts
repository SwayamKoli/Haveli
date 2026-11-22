/**
 * Connects Node's plain http server to the request handler in api/handler.ts.
 * Used by `npm start` (server/start.ts) and by `npm run dev` (vite.config.mts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler, { authorize, respondError } from '../api/handler';
import { uploadAllowed } from '../api/auth/throttle';
import { clientIp, HttpError, type ApiRequest, type ApiResponse } from '../api/lib/http';
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

/** Only one upload is received at a time: each one holds up to 20 MB in memory while it is checked. */
let uploading = false;

/** Answers /api/<action>. `pathname` is the part after /api/. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const query: Record<string, string> = { action };
  for (const [k, v] of url.searchParams) if (k !== 'action') query[k] = v;

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
  const apiReq: ApiRequest = { method: req.method, headers: req.headers, query, ip: req.socket.remoteAddress };
  /** Refuses without reading what the visitor is still sending, and hangs up on them shortly after. */
  const refuse = (e: unknown) => {
    res.setHeader('Connection', 'close');
    respondError(apiRes, e);
    setTimeout(() => req.destroy(), 3000).unref();
  };

  if (req.method === 'POST' && UPLOADS.has(action)) {
    // A file is accepted only from a signed-in owner, and one at a time: check that before reading a single byte of it.
    if (uploading) return refuse(new HttpError(429, 'Another upload is still being processed. Try again in a moment.'));
    uploading = true;
    try {
      try {
        await authorize({ ...apiReq });
        if (!uploadAllowed(clientIp(apiReq))) throw new HttpError(429, 'Too many uploads. Wait a few minutes and try again.');
        if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) throw new HttpError(413, 'That file is too big.');
        apiReq.raw = await readBytes(req, MAX_UPLOAD);
      } catch (e) {
        return refuse(e instanceof HttpError ? e : new HttpError(413, 'That file is too big.'));
      }
      await handler(apiReq, apiRes);
    } finally {
      uploading = false;
    }
    return;
  }
  if (req.method === 'POST') {
    try {
      const text = await readText(req);
      apiReq.body = text ? JSON.parse(text) : {};
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The request was not valid JSON.' }));
      return;
    }
  }
  await handler(apiReq, apiRes);
}
