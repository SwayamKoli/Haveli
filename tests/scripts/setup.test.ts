import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { configProblems } from '../../api/lib/env';
// @ts-expect-error plain .mjs script without types
import { parseEnv, passwordProblem as wizardPasswordProblem, sheetIdFrom, totpNow } from '../../scripts/setup.mjs';
import { passwordProblem } from '../../shared/rules';
import { totpAt } from '../../api/auth/totp';
import { parseDotEnv } from '../../server/dotenv';

const SCRIPT = resolve(process.cwd(), 'scripts/setup.mjs');

function keyFile(dir: string): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = join(dir, 'key.json');
  writeFileSync(file, JSON.stringify({ type: 'service_account', client_email: 'haveli@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, null, 2));
  return file;
}

test('the wizard writes a .env the server accepts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haveli-setup-'));
  const answers = ['Grand Palace', 'Raj Singh', 'Owner', 'longpass99', 'longpass99', 'n', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0', `"${keyFile(dir)}"`, 'Asia/Kolkata', ''].join('\n');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: answers, encoding: 'utf8', env: { ...process.env, HAVELI_SETUP_SKIP_CHECK: '1' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const env = parseDotEnv(readFileSync(join(dir, '.env'), 'utf8'));
  assert.equal(env.HOTEL_NAME, 'Grand Palace');
  assert.equal(env.OWNER_USERNAME, 'owner');
  assert.equal(env.SHEET_ID, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  assert.equal(env.SESSION_SECRET.length, 64);
  assert.equal(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email, 'haveli@proj.iam.gserviceaccount.com');
  const saved = { ...process.env };
  try {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    assert.deepEqual(configProblems(), []);
  } finally {
    for (const k of Object.keys(env)) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.env')).mode & 0o077, 0, '.env is private to the user');
});

test('the wizard refuses a short owner password and a wrong key file, then carries on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haveli-setup-'));
  writeFileSync(join(dir, 'bad.json'), '{"nope":1}');
  const answers = ['H', 'O', 'owner', 'short', 'password1', 'longpass99', 'longpass99', 'n', '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', join(dir, 'bad.json'), keyFile(dir), 'Mars/Phobos', 'Asia/Dubai', ''].join('\n');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: answers, encoding: 'utf8', env: { ...process.env, HAVELI_SETUP_SKIP_CHECK: '1' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Use 8 to 100 characters/);
  assert.match(r.stdout, /too easy to guess/);
  assert.match(r.stdout, /Could not read a Google key/);
  assert.match(r.stdout, /Unknown time zone/);
  assert.equal(parseDotEnv(readFileSync(join(dir, '.env'), 'utf8')).HOTEL_TIMEZONE, 'Asia/Dubai');
});

test('the wizard keeps an existing .env unless told to replace it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haveli-setup-'));
  writeFileSync(join(dir, '.env'), 'HOTEL_NAME=Old\n');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: 'n\n', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'HOTEL_NAME=Old\n');
});

test('the wizard reads .env the same way the app does', () => {
  const sample = [
    '# comment',
    'A=plain value  # trailing note',
    "B='single quoted'",
    'C="with \\n newline"',
    `GOOGLE_SERVICE_ACCOUNT_JSON='{"client_email":"x@y.z",\n"private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"}'`,
    'LAST=1',
  ].join('\n');
  assert.deepEqual(parseEnv(sample), parseDotEnv(sample));
  assert.equal(sheetIdFrom('https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=0'), 'abc_DEF-123');
  assert.equal(sheetIdFrom(' abc_DEF-123 '), 'abc_DEF-123');
});

test('the wizard and the app agree on which passwords are acceptable', () => {
  const samples = ['short', 'password', 'Password1!', 'qwertyuiop', '12345678', '87654321', 'aaaaaaaa', 'abababab', 'letmein99', 'correct horse battery', 'maple-river-41', 'Welcome2Haveli', 'x'.repeat(101)];
  for (const p of samples) assert.equal(wizardPasswordProblem(p) === null, passwordProblem(p) === null, p);
});

test('the wizard makes the same 6-digit codes as the app checks (RFC 6238 test values)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // the ASCII key "12345678901234567890" from the standard
  for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']] as const) {
    assert.equal(totpNow(secret, t * 1000), code);
    assert.equal(totpAt(secret, t * 1000), code);
  }
});

test('"--2fa" adds the 2-step code to an existing .env and keeps every other line', async () => {
  const { spawn } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'haveli-setup-'));
  const before = "HOTEL_NAME=Old Palace\nOWNER_USERNAME=boss\nOWNER_PASSWORD='keep me'\n";
  writeFileSync(join(dir, '.env'), before);
  const child = spawn(process.execPath, [SCRIPT, '--2fa'], { cwd: dir });
  let out = '';
  let stage = 0;
  const done = new Promise<number | null>((resolve) => child.on('close', resolve));
  child.stdout.on('data', (d: Buffer) => {
    out += d.toString();
    if (stage === 0 && out.includes('Switch it on?')) {
      stage = 1;
      child.stdin.write('y\n');
    } else if (stage === 1 && out.includes('Type the 6-digit code')) {
      stage = 2;
      const key = /Key:\s+([A-Z2-7 ]+)/.exec(out)?.[1].replace(/ /g, '') ?? '';
      child.stdin.write(`${totpNow(key)}\n`);
    }
  });
  assert.equal(await done, 0, out);
  const text = readFileSync(join(dir, '.env'), 'utf8');
  assert.ok(text.startsWith(before), 'the old lines are untouched');
  assert.match(text, /\nOWNER_TOTP_SECRET=[A-Z2-7]{32}\n$/);
  assert.match(out, /The code works/);
});
