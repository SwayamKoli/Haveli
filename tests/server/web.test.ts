/** Running on the web: who is connecting, https, the health check, compressed files and safe defaults. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { forgetStaffCache } from '../../api/sheets';
import {
  applyHostingDefaults,
  hostedOn,
  isPublic,
  listenHost,
  publicProblems,
  publicWarnings,
} from '../../server/network';
import { securityHeaders } from '../../server/security';
import { serveStatic } from '../../server/static';
import { FakeGoogle } from '../helpers/fakeGoogle';
import { call, OWNER, PASSWORD, setEnv } from '../helpers/harness';

// The fake Google replaces fetch while a test runs; the website tests need the real one to talk to their own server.
const nodeFetch = globalThis.fetch;

let g: FakeGoogle;
beforeEach(() => {
  g = new FakeGoogle();
  g.install();
  forgetStaffCache();
});
afterEach(() => g.uninstall());

const wrong = (opts: Parameters<typeof call>[1]) => call('login', { body: { username: OWNER, password: 'wrong' }, ...opts });
const attempts = async (n: number, make: (i: number) => Parameters<typeof call>[1]) => {
  for (let i = 0; i < n; i++) await wrong(make(i));
};

describe('who is connecting (slowing down password guessing)', () => {
  it('ignores the forwarded address when nobody in front is trusted, so it cannot be faked', async () => {
    setEnv(g, { TRUST_PROXY: undefined });
    await attempts(8, (i) => ({ socketIp: '198.51.100.20', headers: { 'x-forwarded-for': `10.9.9.${i}` } }));
    const r = await call('login', { body: { username: OWNER, password: PASSWORD }, socketIp: '198.51.100.20', headers: { 'x-forwarded-for': '10.9.9.200' } });
    assert.equal(r.status, 429, 'the same computer is still blocked');
    const other = await call('login', { body: { username: OWNER, password: PASSWORD }, socketIp: '198.51.100.21' });
    assert.equal(other.status, 200, 'another computer is not');
  });

  it('with one trusted proxy, counts the address the proxy saw and not the ones a visitor typed in front of it', async () => {
    setEnv(g, { TRUST_PROXY: '1' });
    await attempts(8, (i) => ({ headers: { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.50` } }));
    const blocked = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'x-forwarded-for': '10.1.1.1, 203.0.113.50' } });
    assert.equal(blocked.status, 429);
    const other = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'x-forwarded-for': '10.9.9.1, 203.0.113.51' } });
    assert.equal(other.status, 200);
  });

  it('falls back to the connecting address when the proxy header is missing', async () => {
    setEnv(g, { TRUST_PROXY: '1' });
    await attempts(8, () => ({ headers: { 'x-forwarded-for': '' }, socketIp: '192.0.2.77' }));
    const r = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'x-forwarded-for': '' }, socketIp: '192.0.2.77' });
    assert.equal(r.status, 429);
  });
});

describe('https', () => {
  const cookieFor = async (env: string | undefined, proto: string) => {
    setEnv(g, { TRUST_PROXY: env });
    const r = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'x-forwarded-proto': proto } });
    assert.equal(r.status, 200);
    return String(r.headers['set-cookie']);
  };
  it('marks the sign-in cookie Secure behind an https proxy', async () => {
    const c = await cookieFor('1', 'https');
    assert.match(c, /; Secure/);
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
  });
  it('does not mark it Secure on plain http, or when the header is not trusted', async () => {
    assert.doesNotMatch(await cookieFor('1', 'http'), /Secure/);
    assert.doesNotMatch(await cookieFor(undefined, 'https'), /Secure/);
  });
});

describe('where the server listens', () => {
  const keep = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  });
  const clean = () => {
    for (const k of ['HOST', 'PORT', 'TRUST_PROXY', 'RENDER', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'K_SERVICE', 'DYNO', 'OWNER_PASSWORD', 'APP_PASSWORD', 'OWNER_TOTP_SECRET']) delete process.env[k];
  };

  it('is this computer only by default', () => {
    clean();
    assert.equal(listenHost(), '127.0.0.1');
    assert.equal(hostedOn(), null);
    assert.equal(isPublic(listenHost()), false);
    assert.deepEqual(publicWarnings(listenHost()), []);
  });
  it('opens up when HOST says so, and HOST always wins', () => {
    clean();
    process.env.HOST = '0.0.0.0';
    assert.equal(listenHost(), '0.0.0.0');
    assert.equal(isPublic('0.0.0.0'), true);
    process.env.RENDER = 'true';
    process.env.HOST = '127.0.0.1';
    assert.equal(listenHost(), '127.0.0.1');
  });
  it('recognises hosting services, listens publicly there and trusts the one proxy in front', () => {
    for (const [k, name] of [['RENDER', 'Render'], ['RAILWAY_PROJECT_ID', 'Railway'], ['FLY_APP_NAME', 'Fly.io'], ['K_SERVICE', 'Google Cloud Run'], ['DYNO', 'Heroku']] as const) {
      clean();
      process.env[k] = '1';
      assert.equal(hostedOn(), name);
      assert.equal(listenHost(), '0.0.0.0');
      applyHostingDefaults();
      assert.equal(process.env.TRUST_PROXY, '1');
    }
  });
  it('lets TRUST_PROXY set by hand win on a hosting service', () => {
    clean();
    process.env.RENDER = '1';
    process.env.TRUST_PROXY = '2';
    applyHostingDefaults();
    assert.equal(process.env.TRUST_PROXY, '2');
  });
  it('refuses to start in public with a short owner password, and warns about a missing TRUST_PROXY and 2-step code', () => {
    clean();
    delete process.env.OWNER_TOTP_SECRET;
    process.env.OWNER_PASSWORD = 'short-pw-1';
    const p = publicProblems('0.0.0.0');
    assert.equal(p.length, 1);
    assert.match(p[0], /12 or more/);
    assert.deepEqual(publicProblems('127.0.0.1'), [], 'fine on this computer only');
    process.env.OWNER_PASSWORD = 'a long password for the web';
    assert.deepEqual(publicProblems('0.0.0.0'), []);
    const w = publicWarnings('0.0.0.0');
    assert.equal(w.length, 2);
    assert.match(w[0], /TRUST_PROXY/);
    assert.match(w[1], /2-step/);
    process.env.TRUST_PROXY = '1';
    process.env.OWNER_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
    assert.deepEqual(publicWarnings('0.0.0.0'), []);
    delete process.env.OWNER_TOTP_SECRET;
  });
});

describe('serving the website', () => {
  let dir: string;
  let server: Server;
  let base = '';
  const page = '<!doctype html><title>x</title>' + '<p>hotel</p>'.repeat(300);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'haveli-dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), page);
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log("hello hotel");'.repeat(200));
    writeFileSync(join(dir, 'small.txt'), 'tiny');
    setEnv(g, { TRUST_PROXY: '1' });
    server = createServer((req, res) => {
      securityHeaders(req, res);
      serveStatic(req, res, dir);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the page, never cached, and any unknown address gets the app too', async () => {
    const r = await nodeFetch(`${base}/`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.equal(await r.text(), page);
    const deep = await nodeFetch(`${base}/bookings/anything`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(await deep.text(), page);
  });
  it('lets browsers keep the hashed files for a year', async () => {
    const r = await nodeFetch(`${base}/assets/app-abc123.js`, { headers: { 'accept-encoding': 'identity' } });
    assert.match(r.headers.get('cache-control') ?? '', /immutable/);
    assert.match(r.headers.get('content-type') ?? '', /javascript/);
  });
  it('compresses big text files for browsers that accept it, and only for them', async () => {
    const plain = await nodeFetch(`${base}/`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    const raw = await new Promise<{ enc: string | undefined; body: Buffer }>((resolve) => {
      import('node:http').then(({ get }) =>
        get(`${base}/`, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
          const parts: Buffer[] = [];
          res.on('data', (c: Buffer) => parts.push(c));
          res.on('end', () => resolve({ enc: res.headers['content-encoding'] as string | undefined, body: Buffer.concat(parts) }));
        }),
      );
    });
    assert.equal(raw.enc, 'gzip');
    assert.ok(raw.body.length < page.length / 4, 'much smaller');
    assert.equal(gunzipSync(raw.body).toString(), page);
    const small = await nodeFetch(`${base}/small.txt`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(small.headers.get('content-encoding'), null, 'tiny files are not worth compressing');
  });
  it('keeps files outside the website folder private', async () => {
    writeFileSync(join(dir, '..', 'haveli-secret.txt'), 'private');
    for (const p of ['/../haveli-secret.txt', '/%2e%2e/haveli-secret.txt', '/..%2fhaveli-secret.txt']) {
      const r = await nodeFetch(`${base}${p}`, { headers: { 'accept-encoding': 'identity' } });
      assert.ok(!(await r.text()).includes('private'), p);
    }
    rmSync(join(dir, '..', 'haveli-secret.txt'), { force: true });
    const bad = await nodeFetch(`${base}/%E0%A4%A`);
    assert.equal(bad.status, 400);
  });
  it('only answers GET and HEAD', async () => {
    assert.equal((await nodeFetch(`${base}/`, { method: 'POST' })).status, 405);
    const head = await nodeFetch(`${base}/`, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
  it('sends safety headers always, and HSTS only to people on https', async () => {
    const http = await nodeFetch(`${base}/`);
    assert.equal(http.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(http.headers.get('x-frame-options'), 'DENY');
    assert.equal(http.headers.get('strict-transport-security'), null);
    const https = await nodeFetch(`${base}/`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
  });
});
