#!/usr/bin/env node
/**
 * Haveli setup wizard. Asks a few questions, checks the Google connection and writes the .env file.
 *
 *   node scripts/setup.mjs            first-time setup (or "npm run setup")
 *   node scripts/setup.mjs --check    test an existing .env without changing it
 *   node scripts/setup.mjs --2fa      switch on (or replace) the owner's 2-step code in an existing .env
 *
 * Needs only Node 20+. No packages. Runs in the folder it is started from.
 */
import { createHmac, createSign, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const ENV_FILE = resolve(process.cwd(), '.env');
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const say = (s = '') => console.log(s);

/* ---------- .env reading (same rules as the app) ---------- */

export function parseEnv(text) {
  const out = {};
  const src = text.replace(/^\uFEFF/, '');
  const key = /[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*/y;
  let i = 0;
  while (i < src.length) {
    key.lastIndex = i;
    const k = key.exec(src);
    if (!k) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    let p = key.lastIndex;
    const wrap = src[p] === "'" || src[p] === '"' ? src[p] : '';
    const open = wrap ? p + 1 : p;
    if (src[open] === '{') {
      let depth = 0;
      let inStr = false;
      let end = -1;
      for (let j = open; j < src.length; j++) {
        const c = src[j];
        if (inStr) {
          if (c === '\\') j++;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) {
          end = j + 1;
          break;
        }
      }
      if (end > 0) {
        out[k[1]] = src.slice(open, end);
        p = wrap && src[end] === wrap ? end + 1 : end;
        const nl = src.indexOf('\n', p);
        i = nl === -1 ? src.length : nl + 1;
        continue;
      }
    }
    const rest = src.slice(p);
    let m;
    if (wrap === "'" && (m = /^'([^']*)'/.exec(rest))) out[k[1]] = m[1];
    else if (wrap === '"' && (m = /^"((?:[^"\\]|\\.)*)"/.exec(rest))) out[k[1]] = m[1].replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1');
    else out[k[1]] = (rest.split(/\r?\n/)[0] ?? '').replace(/[ \t]+#.*$/, '').trim();
    const nl = src.indexOf('\n', p);
    i = nl === -1 ? src.length : nl + 1;
  }
  return out;
}

/* ---------- Google check (plain Node, no packages) ---------- */

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function sheetIdFrom(raw) {
  const m = /\/d\/([a-zA-Z0-9_-]+)/.exec(raw);
  return (m ? m[1] : raw).trim();
}

export async function testGoogle({ sheetId, email, key }) {
  if (process.env.HAVELI_SETUP_SKIP_CHECK) return { ok: false, offline: true, message: 'Connection test skipped.' };
  let token;
  try {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, offline: false, message: `Google did not accept the key (${j.error_description || j.error || r.status}). Download a fresh key file and try again.` };
    token = j.access_token;
  } catch (e) {
    if (e && e.code === 'ERR_OSSL_UNSUPPORTED') return { ok: false, offline: false, message: 'The private key in that file could not be read. Download the key file again.' };
    if (String(e).includes('PEM') || String(e).includes('key')) return { ok: false, offline: false, message: 'The private key in that file could not be read. Download the key file again.' };
    return { ok: false, offline: true, message: 'Could not reach Google from this computer (no internet?). Your settings were saved; check the connection later with: node setup.mjs --check' };
  }
  try {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties.title`, { headers: { authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) return { ok: false, offline: false, message: `Google says the robot account has no access. Open the Google Sheet, press Share, add ${email} as Editor, then run this again.` };
    if (r.status === 404 || r.status === 400) return { ok: false, offline: false, message: 'Google cannot find that sheet. Check the sheet address or id.' };
    if (!r.ok) return { ok: false, offline: false, message: `Google answered ${r.status}: ${j.error?.message ?? 'unknown problem'}. If it mentions the Sheets API, enable "Google Sheets API" in your Google Cloud project.` };
    return { ok: true, title: j.properties?.title ?? '', tabs: (j.sheets ?? []).map((s) => s.properties?.title) };
  } catch {
    return { ok: false, offline: true, message: 'Could not reach Google from this computer (no internet?).' };
  }
}

/* ---------- questions ---------- */

function makeAsker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const lines = rl[Symbol.asyncIterator]();
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  if (write) rl._writeToOutput = (s) => (muted ? (s.includes('\n') ? write('\n') : undefined) : write(s));
  const read = async (prompt) => {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) {
      say('\nInput ended before the setup was finished. Nothing was changed.');
      process.exit(1);
    }
    return String(value).trim();
  };
  return {
    async ask(q, def = '') {
      const a = await read(def ? `${q} [${def}]: ` : `${q}: `);
      return a || def;
    },
    async secret(q) {
      muted = Boolean(process.stdin.isTTY);
      const a = await read(`${q}${muted ? ' (hidden while you type)' : ''}: `);
      muted = false;
      return a;
    },
    close: () => rl.close(),
  };
}

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');

function validZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ---------- passwords and the 2-step code (same rules as api/auth and shared/rules/passwords.ts) ---------- */

const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'letmein', 'welcome', 'qwerty', 'qwertyuiop', 'qwerty123', 'asdfghjkl', 'zxcvbnm',
  'iloveyou', 'admin', 'administrator', 'root', 'login', 'master', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'cricket',
  'abc123', 'abcd1234', 'changeme', 'default', 'secret', 'hotel', 'hotelhotel', 'reception', 'frontdesk', 'manager', 'owner', 'staff',
  'guest', 'india', 'mumbai', 'delhi', 'bollywood', 'krishna', 'ganesh', 'shivaji', 'jaishreeram', 'omnamahshivaya', 'trustno1',
  'superman', 'batman', 'shadow', 'michael', 'jordan', 'harley', 'hunter', 'whatever', 'freedom', 'starwars', 'computer', 'internet',
  'haveli', 'havelipassword', 'haveli123',
]);
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '0123456789', 'abcdefghijklmnopqrstuvwxyz'];
const keyboardRun = (p) => {
  const s = p.toLowerCase();
  return ROWS.some((row) => s.length >= 6 && (row.includes(s) || [...row].reverse().join('').includes(s)));
};

/** What is wrong with a password, or null when the app will accept it. */
export function passwordProblem(password) {
  if (password.length < 8 || password.length > 100) return 'Use 8 to 100 characters.';
  const lower = password.toLowerCase();
  const stem = lower.replace(/[0-9!@#$%^&*._-]+$/, '');
  if (COMMON.has(lower) || COMMON.has(stem)) return 'That password is too easy to guess. Try a few unrelated words.';
  if (new Set(lower).size <= 2) return 'That password is too repetitive. Try a few unrelated words.';
  if (keyboardRun(password) || keyboardRun(stem)) return 'That password is a keyboard pattern. Try a few unrelated words.';
  return null;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + B32[(value << (5 - bits)) & 31] : out;
}

function unbase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text.replace(/[\s-]/g, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code an authenticator app shows for this secret at this time (RFC 6238). */
export function totpNow(secretText, nowMs = Date.now(), stepOffset = 0) {
  const key = unbase32(secretText);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30000) + stepOffset));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

/** Walks the owner through adding the 2-step code to an authenticator app and proves it works. Returns the secret, or '' to skip. */
async function askTwoStep(q, hotel, owner) {
  say('');
  say('Owner 2-step code (recommended, and important if Haveli is on the internet)');
  say('Signing in as owner then also needs a 6-digit code from an app on your phone.');
  say('Even if someone learns your password, they cannot get in without your phone.');
  const yes = (await q.ask('Switch it on? (Y/n)', 'Y')).toLowerCase();
  if (yes.startsWith('n')) return '';
  const secret = base32(randomBytes(20));
  const spaced = secret.match(/.{1,4}/g).join(' ');
  say('');
  say('On your phone open an authenticator app (Google Authenticator, Microsoft Authenticator,');
  say('Authy, 1Password ...). Choose "Add account" and then "Enter a setup key", and type:');
  say(`    Account name:  ${hotel} owner`);
  say(`    Key:           ${spaced}`);
  say('    Type:          time based');
  say('');
  for (let tries = 0; tries < 5; tries++) {
    const typed = (await q.ask('Type the 6-digit code the app now shows (or press Enter to skip)', '')).replace(/\s/g, '');
    if (!typed) {
      say('  Skipped. You can switch it on later with: node setup.mjs --2fa');
      return '';
    }
    const now = Date.now();
    if ([-1, 0, 1].some((d) => totpNow(secret, now, d) === typed)) {
      say('  ✓ The code works.');
      say(`  Keep a note of the key (${spaced}) somewhere safe: it is how you add Haveli to a new phone.`);
      say('  If you ever lose your phone, delete the OWNER_TOTP_SECRET line in .env and restart.');
      return secret;
    }
    say('  That code is not right. Wait for a new code and try again.');
  }
  say('  Too many tries; the 2-step code was not switched on.');
  return '';
}

function reportFindings(env) {
  const problems = [];
  if (!env.SHEET_ID) problems.push('SHEET_ID is empty');
  let acct;
  try {
    acct = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '');
    if (!acct.client_email || !acct.private_key) problems.push('GOOGLE_SERVICE_ACCOUNT_JSON has no client_email or private_key');
  } catch {
    problems.push('GOOGLE_SERVICE_ACCOUNT_JSON is missing or not valid JSON');
  }
  const pw = env.OWNER_PASSWORD || env.APP_PASSWORD || '';
  if (pw.length < 8) problems.push('OWNER_PASSWORD is missing or shorter than 8 characters');
  else if (passwordProblem(pw)) problems.push('OWNER_PASSWORD is too easy to guess');
  if ((env.SESSION_SECRET ?? '').length < 32) problems.push('SESSION_SECRET is missing or shorter than 32 characters');
  if (env.HOTEL_TIMEZONE && !validZone(env.HOTEL_TIMEZONE)) problems.push('HOTEL_TIMEZONE is not a known time zone');
  return { problems, acct };
}

async function runCheck() {
  if (!existsSync(ENV_FILE)) {
    say('There is no .env file here yet. Run the setup first.');
    process.exit(1);
  }
  const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  const { problems, acct } = reportFindings(env);
  if (problems.length) {
    say('Problems in .env:');
    for (const p of problems) say('  - ' + p);
    process.exit(1);
  }
  say('The settings look complete. Testing the Google connection...');
  const r = await testGoogle({ sheetId: sheetIdFrom(env.SHEET_ID), email: acct.client_email, key: acct.private_key.replace(/\\n/g, '\n') });
  if (!r.ok) {
    say('  ✗ ' + r.message);
    process.exit(1);
  }
  say(`  ✓ Connected to "${r.title}". Tabs found: ${r.tabs.join(', ') || 'none'}.`);
  const missing = ['Rooms', 'Guests', 'Bookings', 'Payments', 'Staff'].filter((t) => !r.tabs.includes(t));
  if (missing.length) say(`  i  Missing tabs: ${missing.join(', ')}. After signing in as the owner, open Settings and press "Set up sheet".`);
}

/** Adds or replaces OWNER_TOTP_SECRET in an existing .env, leaving every other line as it is. */
async function runTwoStep() {
  if (!existsSync(ENV_FILE)) {
    say('There is no .env file here yet. Run the setup first.');
    process.exit(1);
  }
  const text = readFileSync(ENV_FILE, 'utf8');
  const env = parseEnv(text);
  const q = makeAsker();
  const secret = await askTwoStep(q, env.HOTEL_NAME || 'Hotel', env.OWNER_USERNAME || 'owner');
  q.close();
  if (!secret) {
    say('Nothing was changed.');
    return;
  }
  copyFileSync(ENV_FILE, resolve(process.cwd(), '.env.backup'));
  const line = `OWNER_TOTP_SECRET=${secret}`;
  const next = /^OWNER_TOTP_SECRET=.*$/m.test(text) ? text.replace(/^OWNER_TOTP_SECRET=.*$/m, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(ENV_FILE, next, { mode: 0o600 });
  say('Saved. Stop Haveli and start it again; everyone is signed out once.');
}

async function runSetup() {
  say('');
  say('Haveli setup');
  say('------------');
  say('This asks a few questions and writes the settings file (.env) for you.');
  say('Have ready: the Google Sheet address, and the key file (.json) of its robot account.');
  say('Press Enter to accept the answer shown in [brackets].');
  say('');

  const q = makeAsker();
  if (existsSync(ENV_FILE)) {
    const yes = (await q.ask('A .env file already exists. Replace it? A copy is kept as .env.backup (y/N)', 'N')).toLowerCase();
    if (!yes.startsWith('y')) {
      say('Nothing was changed.');
      q.close();
      return;
    }
    copyFileSync(ENV_FILE, resolve(process.cwd(), '.env.backup'));
  }

  const hotel = (await q.ask('Hotel name (shown as the logo, on the sign-in screen and in the welcome animation)', 'My Hotel')).replace(/[\r\n]/g, ' ');
  const ownerName = (await q.ask('Owner name', 'Owner')).replace(/[\r\n]/g, ' ');
  let ownerUser = (await q.ask('Owner username', 'owner')).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!ownerUser) ownerUser = 'owner';

  let password = '';
  for (;;) {
    password = await q.secret('Owner password: 12 or more characters, a few unrelated words work well. Keep it to yourself');
    const bad = passwordProblem(password);
    if (bad) {
      say('  ' + bad);
      continue;
    }
    if (password.length < 12) say('  Note: on the internet the app needs 12 or more characters. It is fine for this computer only.');
    const again = await q.secret('Type it again to confirm');
    if (again === password) break;
    say('  The two did not match. Try again.');
  }

  const totp = await askTwoStep(q, hotel, ownerUser);

  let sheet = '';
  while (!sheet) {
    sheet = sheetIdFrom(await q.ask('Google Sheet address (paste the whole link from the browser)'));
    if (!/^[a-zA-Z0-9_-]{20,}$/.test(sheet)) {
      say('  That does not look like a Google Sheet address. It contains /d/ followed by a long code.');
      sheet = '';
    }
  }

  let acct;
  let json = '';
  while (!acct) {
    const file = unquote(await q.ask('Key file: drag the downloaded .json file into this window, then press Enter'));
    try {
      json = readFileSync(resolve(file), 'utf8');
      acct = JSON.parse(json);
      if (!acct.client_email || !acct.private_key) throw new Error('missing');
    } catch {
      say('  Could not read a Google key from that file. It must be the .json file downloaded from Google Cloud (Keys > Add key > JSON).');
      acct = undefined;
    }
  }
  const compact = JSON.stringify(acct);
  if (compact.includes("'")) {
    say('The key contains a quote character that cannot be stored safely. Download a new key and try again.');
    q.close();
    process.exit(1);
  }

  let tz = '';
  while (!tz) {
    tz = await q.ask('Time zone of the hotel', 'Asia/Kolkata');
    if (!validZone(tz)) {
      say('  Unknown time zone. Examples: Asia/Kolkata, Asia/Dubai, Europe/London.');
      tz = '';
    }
  }
  q.close();

  const env = [
    '# Written by the Haveli setup. Never share this file.',
    `HOTEL_NAME=${hotel}`,
    `OWNER_NAME=${ownerName}`,
    `OWNER_USERNAME=${ownerUser}`,
    `OWNER_PASSWORD=${password}`,
    `SHEET_ID=${sheet}`,
    `GOOGLE_SERVICE_ACCOUNT_JSON='${compact}'`,
    `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
    `HOTEL_TIMEZONE=${tz}`,
    ...(totp ? [`OWNER_TOTP_SECRET=${totp}`] : []),
    '',
  ].join('\n');
  writeFileSync(ENV_FILE, env, { mode: 0o600 });
  try {
    chmodSync(ENV_FILE, 0o600); // an older .env keeps its old permissions otherwise
  } catch {
    /* Windows */
  }
  say('');
  say('Saved the settings in .env');
  say('Testing the Google connection...');
  const r = await testGoogle({ sheetId: sheet, email: acct.client_email, key: acct.private_key });
  if (r.ok) {
    say(`  ✓ Connected to "${r.title}".`);
    const missing = ['Rooms', 'Guests', 'Bookings', 'Payments', 'Staff'].filter((t) => !r.tabs.includes(t));
    if (missing.length === 5) say('  i  The sheet is empty. That is fine: the app will create its tabs in the next step.');
  } else {
    say('  ✗ ' + r.message);
    if (!r.offline) say('    Fix that, then run: node setup.mjs --check');
  }
  say('');
  say('Next:');
  say('  1. Start Haveli (start.bat on Windows, start.sh on Mac/Linux; developers: npm start).');
  say(`  2. Open the address it shows and sign in as "${ownerUser}" with the owner password.`);
  say('  3. Open Settings: press "Set up sheet", then "Quick room setup", then add your employees.');
  say('');
}

// Run only when started directly, so the tests can import the helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await runCheck();
  else if (process.argv.includes('--2fa')) await runTwoStep();
  else await runSetup();
}
