import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { configProblems } from '../api/_lib/env';
import { parseDotEnv } from '../server/dotenv';
// @ts-expect-error plain .mjs script without types
import { parseEnv, sheetIdFrom } from '../scripts/setup.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/setup.mjs');

function keyFile(dir: string): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const file = join(dir, 'key.json');
  writeFileSync(file, JSON.stringify({ type: 'service_account', client_email: 'haveli@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, null, 2));
  return file;
}

test('the wizard writes a .env the server accepts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haveli-setup-'));
  const answers = ['Grand Palace', 'Raj Singh', 'Owner', 'longpass99', 'longpass99', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0', `"${keyFile(dir)}"`, 'Asia/Kolkata', ''].join('\n');
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
  const answers = ['H', 'O', 'owner', 'short', 'longpass99', 'longpass99', '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', join(dir, 'bad.json'), keyFile(dir), 'Mars/Phobos', 'Asia/Dubai', ''].join('\n');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: answers, encoding: 'utf8', env: { ...process.env, HAVELI_SETUP_SKIP_CHECK: '1' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /too short/);
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
