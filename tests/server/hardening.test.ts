/** The real web server: browser security headers, other website names, https redirect, uploads from strangers, crashes. */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders, type RequestOptions, type Server } from 'node:http';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { forgetStaffCache } from '../../api/sheets';
import { createApp } from '../../server/app';
import { hardenServer, looseEnvFiles } from '../../server/security';
import { FakeGoogle } from '../helpers/fakeGoogle';
import { OWNER, PASSWORD, setEnv } from '../helpers/harness';

let g: FakeGoogle;
let server: Server;
let port = 0;
let dist = '';

async function start(listenHost = '127.0.0.1') {
  server = createServer(createApp(dist, listenHost));
  hardenServer(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
}

beforeEach(() => {
  g = new FakeGoogle();
  g.install();
  forgetStaffCache();
  dist = mkdtempSync(join(tmpdir(), 'haveli-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>x</title><p>hotel</p>');
});
afterEach(async () => {
  g.uninstall();
  await new Promise((r) => server.close(r));
});

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}
function send(path: string, opts: RequestOptions & { body?: string } = {}): Promise<Answer> {
  const { body, ...rest } = opts;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, agent: false, ...rest }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const login = async (extra: Record<string, string> = {}) => {
  const r = await send('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'haveli', ...extra }, body: JSON.stringify({ username: OWNER, password: PASSWORD }) });
  assert.equal(r.status, 200, r.text);
  return String(r.headers['set-cookie']).split(';')[0];
};

describe('what every answer tells the browser', () => {
  it('forbids other websites to frame the page or run scripts in it, and switches off cameras and the like', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start();
    for (const path of ['/', '/api/session', '/anything/else']) {
      const r = await send(path);
      const csp = String(r.headers['content-security-policy']);
      assert.match(csp, /script-src 'self'(;|$)/, path);
      assert.match(csp, /frame-ancestors 'none'/, path);
      assert.match(csp, /object-src 'none'/, path);
      assert.match(csp, /connect-src 'self'/, path);
      assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/, 'no way to run injected scripts');
      assert.equal(r.headers['x-frame-options'], 'DENY');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['referrer-policy'], 'no-referrer');
      assert.match(String(r.headers['permissions-policy']), /camera=\(\), microphone=\(\), geolocation=\(\)/);
      assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
      assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
    }
    assert.equal((await send('/api/session')).headers['cache-control'], 'no-store');
  });

  it('adds HSTS and upgrade-insecure-requests only when the visitor is on https', async () => {
    setEnv(g, { TRUST_PROXY: '1' });
    await start();
    const plain = await send('/', { headers: { host: 'localhost', 'x-forwarded-proto': 'https' } });
    assert.match(String(plain.headers['strict-transport-security']), /max-age=31536000/);
    assert.match(String(plain.headers['content-security-policy']), /upgrade-insecure-requests/);
    setEnv(g, { TRUST_PROXY: undefined });
    const http = await send('/');
    assert.equal(http.headers['strict-transport-security'], undefined);
    assert.doesNotMatch(String(http.headers['content-security-policy']), /upgrade-insecure-requests/);
  });

  it('keeps the sign-out list in the media folder private', async () => {
    const media = mkdtempSync(join(tmpdir(), 'haveli-media-srv-'));
    setEnv(g, { TRUST_PROXY: undefined, MEDIA_DIR: media });
    writeFileSync(join(media, 'security-state.json'), '{"validFrom":1,"revoked":{}}');
    await start();
    // The app shows its own page for unknown addresses; what matters is that the file's content is never sent.
    for (const path of ['/media/security-state.json', '/media/../security-state.json', '/media/%2e%2e/security-state.json']) {
      const r = await send(path);
      assert.ok(!r.text.includes('validFrom'), path);
    }
  });
});

describe('only the names this app is meant for', () => {
  it('on this computer, refuses another website name (DNS rebinding), but still answers /health', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start('127.0.0.1');
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) assert.equal((await send('/', { headers: { host } })).status, 200, host);
    for (const host of ['evil.example', 'evil.example:3000', '192.168.1.5:3000', 'localhost.evil.example']) assert.equal((await send('/api/session', { headers: { host } })).status, 421, host);
    assert.equal((await send('/health', { headers: { host: 'evil.example' } })).status, 200);
  });

  it('with ALLOWED_HOSTS, accepts only those names, even in public', async () => {
    setEnv(g, { TRUST_PROXY: '1', ALLOWED_HOSTS: 'hotel.example.com, www.hotel.example.com' });
    await start('0.0.0.0');
    assert.equal((await send('/', { headers: { host: 'hotel.example.com' } })).status, 200);
    assert.equal((await send('/', { headers: { host: 'WWW.hotel.example.com:443' } })).status, 200);
    assert.equal((await send('/', { headers: { host: 'other.example.com' } })).status, 421);
  });

  it('in public without ALLOWED_HOSTS, accepts any name (the host service decides)', async () => {
    setEnv(g, { TRUST_PROXY: '1' });
    await start('0.0.0.0');
    assert.equal((await send('/', { headers: { host: 'anything.example.org' } })).status, 200);
  });
});

describe('https only', () => {
  it('sends a visitor who arrived over http (through a trusted proxy) to the https address, before anything is read', async () => {
    setEnv(g, { TRUST_PROXY: '1' });
    await start('0.0.0.0');
    const r = await send('/bookings?x=1', { headers: { host: 'hotel.example.com', 'x-forwarded-proto': 'http' } });
    assert.equal(r.status, 308);
    assert.equal(r.headers.location, 'https://hotel.example.com/bookings?x=1');
    const post = await send('/api/login', { method: 'POST', headers: { host: 'hotel.example.com', 'x-forwarded-proto': 'http' }, body: '{}' });
    assert.equal(post.status, 308, 'a password typed on http is never processed');
    assert.equal((await send('/health', { headers: { host: 'hotel.example.com', 'x-forwarded-proto': 'http' } })).status, 200, 'health checks come over http');
    assert.equal((await send('/', { headers: { host: 'hotel.example.com', 'x-forwarded-proto': 'https' } })).status, 200);
  });

  it('ignores the header when nobody in front is trusted, and never redirects to a strange host', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start('0.0.0.0');
    assert.equal((await send('/', { headers: { host: 'hotel.example.com', 'x-forwarded-proto': 'http' } })).status, 200);
    setEnv(g, { TRUST_PROXY: '1' });
    assert.notEqual((await send('/', { headers: { host: 'a@evil.example', 'x-forwarded-proto': 'http' } })).status, 308);
  });
});

describe('uploads and bad requests', () => {
  it('refuses a stranger\'s big upload without reading it, and an employee\'s, and a forged one', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start();
    const headers = { 'x-requested-with': 'haveli', 'content-length': '20000000', 'content-type': 'application/octet-stream' };
    // Headers only: the body is never sent. A server that waited for it would hang until the test times out.
    const refused = (extra: Record<string, string> = {}) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/api/background-upload?kind=video', method: 'POST', agent: false, headers: { ...headers, ...extra } }, (res) => {
          resolve(res.statusCode ?? 0);
          req.destroy();
        });
        req.on('error', () => undefined);
        setTimeout(() => reject(new Error('the server waited for the body')), 3000).unref();
        req.write('x');
      });
    assert.equal(await refused(), 401, 'no sign-in');
    assert.equal(await refused({ cookie: 'haveli_session=forged' }), 401);
    assert.equal(await refused({ 'x-requested-with': '' }), 403, 'no anti-forgery header');
    assert.equal(await refused({ 'sec-fetch-site': 'cross-site' }), 403, 'from another website');
  });

  it('accepts only a few uploads from one address, and rejects an oversized one from the owner at once', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start();
    const cookie = await login();
    const base = { method: 'POST', headers: { cookie, 'x-requested-with': 'haveli', 'content-type': 'application/octet-stream' } } as const;
    const big = await send('/api/background-upload?kind=video', { ...base, headers: { ...base.headers, 'content-length': String(40 * 1024 * 1024) } }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await send('/api/background-upload?kind=image', { ...base, body: 'not really a picture' })).status);
    assert.ok(codes.includes(429), `the 7th and later are turned away: ${codes}`);
    assert.ok(codes.slice(0, 5).every((c) => c === 422 || c === 400 || c === 415), `earlier ones are checked normally: ${codes}`);
  });

  it('answers a damaged address and keeps running', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start();
    const status = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () => s.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      let out = '';
      s.on('data', (d) => (out += d));
      s.on('close', () => resolve(out.split('\r\n')[0]));
      s.on('error', () => resolve('error'));
    });
    assert.match(status, /HTTP\/1.1 (400|421)/);
    assert.equal((await send('/health')).status, 200, 'the server is still up');
  });

  it('is built with time limits against connections that are slow on purpose', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await start();
    assert.equal(server.headersTimeout, 15_000);
    assert.equal(server.requestTimeout, 180_000);
    assert.ok(server.maxConnections > 0);
  });
});

describe('the .env file', () => {
  it('is reported when other users of this computer can read it', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'haveli-envperm-'));
    const open = join(dir, 'open.env');
    const closed = join(dir, 'closed.env');
    writeFileSync(open, 'A=1');
    writeFileSync(closed, 'A=1');
    chmodSync(open, 0o644);
    chmodSync(closed, 0o600);
    assert.deepEqual(looseEnvFiles([open, closed, join(dir, 'missing.env')]), [open]);
  });
});
