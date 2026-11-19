/**
 * Serves the background photo or video from the media folder, with Range support
 * so videos start at once and loop without stalling. Used by `npm start` and `npm run dev`.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { MEDIA_TYPES, mediaDir, servedName } from '../api/_lib/media';

/** Returns true when the request was a /media/ request (answered here). */
export function serveMedia(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/media/')) return false;
  const name = servedName(url.pathname.slice('/media/'.length));
  let size = 0;
  let file = '';
  if (name) {
    file = join(mediaDir(), name);
    try {
      size = statSync(file).size;
    } catch {
      size = 0;
    }
  }
  if (!name || !size || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }
  const type = MEDIA_TYPES[extname(name).slice(1)] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Every upload gets a new file name, so a file never changes: browsers may keep it.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  let start = 0;
  let end = size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return true;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file, { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}
