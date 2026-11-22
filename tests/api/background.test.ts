import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mp4Seconds, webmSeconds } from '../../api/media/media';
import { forgetStaffCache } from '../../api/sheets';
import { handleApi } from '../../server/adapt';
import { serveMedia } from '../../server/media-serve';
import { FakeGoogle } from '../helpers/fakeGoogle';
import { call, OWNER, setEnv, signIn } from '../helpers/harness';
import { brokenMp4, jpeg, mp4, png, webm, webp } from '../helpers/media';

let g: FakeGoogle;
let owner: string;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'haveli-media-'));
  process.env.MEDIA_DIR = dir;
  g = new FakeGoogle();
  g.install();
  setEnv(g);
  forgetStaffCache();
  g.addRoom(101);
  owner = await signIn();
});
afterEach(() => {
  g.uninstall();
  delete process.env.MEDIA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const upload = (kind: string, raw: Buffer, cookie: string | undefined = owner) => call('background-upload', { cookie, raw, query: { kind } });
const files = () => readdirSync(dir).filter((f) => f.startsWith('bg-'));
async function staffCookie() {
  const r = await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: true, password: 'maple-river-41' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return signIn('asha', 'maple-river-41');
}

describe('video length reading', () => {
  it('reads the length of MP4 files, however they are laid out', () => {
    assert.equal(mp4Seconds(mp4(12.5)), 12.5);
    assert.equal(mp4Seconds(mp4(12.5, { mdatFirst: true })), 12.5);
    assert.equal(mp4Seconds(mp4(7, { version1: true })), 7);
    assert.equal(mp4Seconds(brokenMp4()), null);
    assert.equal(mp4Seconds(Buffer.from('not a video at all, just text')), null);
  });
  it('reads the length of WebM files', () => {
    assert.ok(Math.abs((webmSeconds(webm(9.25)) ?? 0) - 9.25) < 0.001);
    assert.equal(webmSeconds(webm(9, { noDuration: true })), null);
  });
});

describe('background: who may change it', () => {
  it('starts as the plain theme, and anyone (even before sign-in) can see what it is', async () => {
    const s = await call('session');
    assert.deepEqual(s.body.background, { kind: 'none', url: null, version: 0 });
    const d = await call('data', { cookie: owner });
    assert.equal(d.body.background.kind, 'none');
  });

  it('only the owner can set or upload it', async () => {
    const asha = await staffCookie();
    for (const [action, init] of [
      ['background-set', { body: { kind: 'scene' } }],
      ['background-upload', { raw: jpeg(), query: { kind: 'image' } }],
    ] as const) {
      assert.equal((await call(action, { cookie: asha, ...init })).status, 403, `${action} by an employee`);
      assert.equal((await call(action, { ...init })).status, 401, `${action} without signing in`);
    }
    assert.equal((await call('session')).body.background.kind, 'none');
    assert.equal(files().length, 0);
  });

  it('is refused without the anti-forgery header', async () => {
    const r = await call('background-set', { cookie: owner, body: { kind: 'scene' }, noCsrf: true });
    assert.equal(r.status, 403);
  });

  it('an employee sees the owner’s choice straight away', async () => {
    const asha = await staffCookie();
    await call('background-set', { cookie: owner, body: { kind: 'scene' } });
    assert.equal((await call('session', { cookie: asha })).body.background.kind, 'scene');
    assert.equal((await call('data', { cookie: asha })).body.background.kind, 'scene');
  });
});

describe('background: photos', () => {
  it('accepts JPG, PNG and WebP, and tells everyone where to find it', async () => {
    for (const [file, ext] of [[jpeg(), 'jpg'], [png(), 'png'], [webp(), 'webp']] as const) {
      const r = await upload('image', file);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.background.kind, 'image');
      assert.match(r.body.background.url, new RegExp(`^/media/bg-\\d+\\.${ext}$`));
      assert.ok(existsSync(join(dir, r.body.background.url.slice('/media/'.length))));
      assert.deepEqual((await call('session')).body.background, r.body.background);
    }
    assert.equal(files().length, 1, 'only the latest file is kept');
  });

  it('refuses things that are not photos, and photos that are too big', async () => {
    assert.equal((await upload('image', Buffer.from('<html>not an image</html> padding padding'))).status, 400);
    assert.equal((await upload('image', mp4(5))).status, 400);
    const big = await upload('image', jpeg(5 * 1024 * 1024));
    assert.equal(big.status, 413);
    assert.match(big.body.error, /5 MB/);
    assert.equal((await upload('image', Buffer.alloc(0))).status, 400);
    assert.equal((await upload('banner', jpeg())).status, 400);
    assert.equal(files().length, 0, 'nothing was stored');
    assert.equal((await call('session')).body.background.kind, 'none');
  });
});

describe('background: videos', () => {
  it('accepts a clip of 15 seconds or less', async () => {
    for (const file of [mp4(15), mp4(4.2), webm(15), webm(3)]) {
      const r = await upload('video', file);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.background.kind, 'video');
    }
    assert.equal(files().length, 1);
  });

  it('refuses a clip longer than 15 seconds, and says how long it was', async () => {
    for (const file of [mp4(16), mp4(90, { version1: true }), webm(30)]) {
      const r = await upload('video', file);
      assert.equal(r.status, 400);
      assert.match(r.body.error, /seconds long\. The limit is 15 seconds/);
    }
    assert.equal(files().length, 0);
  });

  it('refuses a video whose length cannot be read, and files that are not videos', async () => {
    assert.match((await upload('video', brokenMp4())).body.error, /Could not read how long/);
    assert.match((await upload('video', webm(5, { noDuration: true }))).body.error, /Could not read how long/);
    assert.equal((await upload('video', jpeg())).status, 400);
    assert.equal((await upload('video', Buffer.from('plain text pretending to be a video, long enough'))).status, 400);
    assert.equal((await upload('video', mp4(5, { padding: 20 * 1024 * 1024 }))).status, 413);
    assert.equal(files().length, 0);
  });
});

describe('background: only one at a time', () => {
  it('a video replaces a photo, a photo replaces a video, and the old file is deleted', async () => {
    const a = await upload('image', jpeg());
    const photo = a.body.background.url as string;
    const b = await upload('video', mp4(8));
    assert.equal(b.body.background.kind, 'video');
    assert.equal(existsSync(join(dir, photo.slice(7))), false, 'the photo file is gone');
    const c = await upload('image', png());
    assert.equal(c.body.background.kind, 'image');
    assert.equal(files().length, 1);
    assert.equal((await call('session')).body.background.url, c.body.background.url);
    assert.ok(c.body.background.version > b.body.background.version, 'versions only go up, so browsers never show an old file');
  });

  it('the hotel scene and the plain theme remove any uploaded file', async () => {
    await upload('video', mp4(8));
    const scene = await call('background-set', { cookie: owner, body: { kind: 'scene' } });
    assert.equal(scene.body.background.kind, 'scene');
    assert.equal(scene.body.background.url, null);
    assert.equal(files().length, 0);
    await upload('image', jpeg());
    const none = await call('background-set', { cookie: owner, body: { kind: 'none' } });
    assert.equal(none.body.background.kind, 'none');
    assert.equal(files().length, 0);
    assert.equal((await call('background-set', { cookie: owner, body: { kind: 'image' } })).status, 400);
    assert.equal((await call('background-set', { cookie: owner, body: { kind: 'video' } })).status, 400);
  });

  it('falls back to the plain theme if the saved file has gone missing', async () => {
    const a = await upload('image', jpeg());
    rmSync(join(dir, a.body.background.url.slice(7)));
    assert.equal((await call('session')).body.background.kind, 'none');
  });

  it('two uploads at once leave one consistent background', async () => {
    const [x, y] = await Promise.all([upload('image', jpeg()), upload('video', mp4(5))]);
    assert.equal(x.status, 200);
    assert.equal(y.status, 200);
    assert.equal(files().length, 1);
    const now = (await call('session')).body.background;
    assert.ok(existsSync(join(dir, now.url.slice(7))));
  });
});

/* --------------------------------------------------- over real HTTP */

function startServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (serveMedia(req, res)) return;
      const m = /^\/api\/([a-z-]+)/.exec(req.url ?? '');
      if (m) void handleApi(req, res, m[1]);
      else res.end('x');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port }));
  });
}

interface HttpReply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
function http(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: Buffer): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('background over real HTTP', () => {
  let srv: { server: Server; port: number };
  beforeEach(async () => {
    srv = await startServer();
  });
  afterEach(() => new Promise<void>((r) => srv.server.close(() => r())));

  it('uploads the raw file, then serves it with Range support so a video starts and loops smoothly', async () => {
    const file = mp4(6, { padding: 5000 });
    const up = await http(srv.port, 'POST', '/api/background-upload?kind=video', { 'content-type': 'application/octet-stream', 'x-requested-with': 'haveli', cookie: owner, 'content-length': String(file.length) }, file);
    assert.equal(up.status, 200, up.body.toString());
    const url = JSON.parse(up.body.toString()).background.url as string;

    const whole = await http(srv.port, 'GET', url);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers['content-type'], 'video/mp4');
    assert.equal(whole.headers['accept-ranges'], 'bytes');
    assert.match(String(whole.headers['cache-control']), /immutable/);
    assert.ok(whole.body.equals(file));

    const part = await http(srv.port, 'GET', url, { range: 'bytes=10-99' });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 10-99/${file.length}`);
    assert.ok(part.body.equals(file.subarray(10, 100)));
    const tail = await http(srv.port, 'GET', url, { range: 'bytes=-20' });
    assert.ok(tail.body.equals(file.subarray(file.length - 20)));
    const open = await http(srv.port, 'GET', url, { range: `bytes=${file.length - 5}-` });
    assert.equal(open.status, 206);
    assert.equal((await http(srv.port, 'GET', url, { range: `bytes=${file.length + 10}-` })).status, 416);
    assert.equal((await http(srv.port, 'HEAD', url)).status, 200);
  });

  it('serves nothing but the current background files', async () => {
    writeFileSync(join(dir, 'secret.txt'), 'private');
    writeFileSync(join(dir, 'background.json'), '{}');
    for (const p of ['/media/secret.txt', '/media/background.json', '/media/..%2fsecret.txt', '/media/bg-9.mp4', '/media/bg-1.exe']) {
      assert.equal((await http(srv.port, 'GET', p)).status, 404, p);
    }
    // Paths that climb out of /media/ are normalised before they get here and are not media requests at all.
    for (const p of ['/media/../secret.txt', '/media/%2e%2e/secret.txt', '/media/.%2e/secret.txt']) {
      assert.ok(!(await http(srv.port, 'GET', p)).body.toString().includes('private'), p);
    }
  });

  it('turns away a file that is too big before reading all of it', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 1);
    const r = await http(srv.port, 'POST', '/api/background-upload?kind=video', { 'x-requested-with': 'haveli', cookie: owner, 'content-length': String(big.length) }, big).catch((e: NodeJS.ErrnoException) => ({ status: 0, body: Buffer.from(String(e.code)) }));
    // Either the clear 413 answer, or (if the connection was cut while sending) a reset: never a stored file.
    assert.ok(r.status === 413 || r.status === 0, `status ${r.status}`);
    assert.equal(files().length, 0);
  });

  it('the plain /api route still works with query strings and JSON bodies', async () => {
    const r = await http(srv.port, 'POST', '/api/background-set', { 'content-type': 'application/json', 'x-requested-with': 'haveli', cookie: owner }, Buffer.from('{"kind":"scene"}'));
    assert.equal(r.status, 200, r.body.toString());
    assert.equal(JSON.parse(r.body.toString()).background.kind, 'scene');
    void OWNER;
  });
});
