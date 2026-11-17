#!/usr/bin/env node
/**
 * Haveli setup wizard. Asks a few questions, checks the Google connection and writes the .env file.
 *
 *   node scripts/setup.mjs            first-time setup (or "npm run setup")
 *   node scripts/setup.mjs --check    test an existing .env without changing it
 *
 * Needs only Node 20+. No packages. Runs in the folder it is started from.
 */
import { createSign, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  if ((env.SESSION_SECRET ?? '').length < 24) problems.push('SESSION_SECRET is missing or shorter than 24 characters');
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

  const hotel = (await q.ask('Hotel name (shown on the sign-in screen)', 'My Hotel')).replace(/[\r\n]/g, ' ');
  const ownerName = (await q.ask('Owner name', 'Owner')).replace(/[\r\n]/g, ' ');
  let ownerUser = (await q.ask('Owner username', 'owner')).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!ownerUser) ownerUser = 'owner';

  let password = '';
  for (;;) {
    password = await q.secret('Owner password, at least 8 characters. Keep it to yourself');
    if (password.length < 8) {
      say('  That is too short. Use at least 8 characters.');
      continue;
    }
    const again = await q.secret('Type it again to confirm');
    if (again === password) break;
    say('  The two did not match. Try again.');
  }

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
    '',
  ].join('\n');
  writeFileSync(ENV_FILE, env, { mode: 0o600 });
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
  else await runSetup();
}
