/** Protection against hackers: the owner's 2-step code, slowing down guessing, cancelling sign-ins, password rules, the security log. */
import assert from 'node:assert/strict';
import { scryptSync, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../../api/auth/password';
import { accountDelay, apiAllowed, easeLoginFailures, loginBlocked, noteAccountFailure, noteLoginFailure, serialized } from '../../api/auth/throttle';
import { newTotpSecret, totpAt, verifyTotp } from '../../api/auth/totp';
import { resetRevocations } from '../../api/auth/revocation';
import { configProblems } from '../../api/lib/env';
import { call, OWNER, PASSWORD, setEnv, signIn } from '../helpers/harness';
import { g, makeStaff, owner, useHotel } from '../helpers/hotel';

useHotel();

const KEY = newTotpSecret();
const now = () => totpAt(KEY, Date.now());
/** A 6-digit code that is certainly not valid right now. */
const wrongCode = () => {
  const t = Date.now();
  const ok = new Set([-30_000, 0, 30_000].map((d) => totpAt(KEY, t + d)));
  return ['000000', '111111', '222222'].find((c) => !ok.has(c))!;
};
const login = (username: string, password: string, code?: string, ip = '10.0.0.1') => call('login', { body: { username, password, code }, ip });

describe('owner 2-step code', () => {
  it('asks for the code when the owner password is right, and signs in only with a valid, unused one', async () => {
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    const none = await login(OWNER, PASSWORD);
    assert.equal(none.status, 401);
    assert.equal(none.body.code, 'CODE_REQUIRED');
    assert.equal(none.headers['set-cookie'], undefined, 'no sign-in without the code');

    const bad = await login(OWNER, PASSWORD, wrongCode());
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'CODE_REQUIRED');
    assert.equal(bad.headers['set-cookie'], undefined);

    const code = now();
    const ok = await login(OWNER, PASSWORD, ` ${code.slice(0, 3)} ${code.slice(3)} `);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.headers['set-cookie']);

    const replay = await login(OWNER, PASSWORD, code);
    assert.equal(replay.status, 401, 'a code works once');
  });

  it('is not asked of employees with their own password, but is asked when the owner password opens an employee account', async () => {
    await makeStaff();
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    assert.equal((await login('asha', 'maple-river-41')).status, 200);
    const via = await login('asha', PASSWORD);
    assert.equal(via.body.code, 'CODE_REQUIRED');
    const ok = await login('asha', PASSWORD, now());
    assert.equal(ok.status, 200);
    assert.equal(ok.body.staff.viaOwner, true);
  });

  it('does not tell a stranger that the owner password was right when the username is unknown', async () => {
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    const r = await login('ghost', PASSWORD);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, undefined);
    assert.equal(r.body.error, 'The username or password is not right.');
  });

  it('counts wrong codes towards the lock-out like wrong passwords', async () => {
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    for (let i = 0; i < 8; i++) await login(OWNER, PASSWORD, wrongCode(), '198.51.100.9');
    const r = await login(OWNER, PASSWORD, now(), '198.51.100.9');
    assert.equal(r.status, 429);
  });

  it('signs out owner sessions that were started before it was switched on', async () => {
    assert.equal((await call('data', { cookie: owner, method: 'GET' })).status, 200);
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    assert.equal((await call('data', { cookie: owner, method: 'GET' })).status, 401);
  });

  it('keeps the Google Sheet link away from plain employees once it is on', async () => {
    const staff = await makeStaff();
    assert.equal((await call('sheet-link', { cookie: staff, body: { password: PASSWORD } })).status, 200, 'allowed while it is off');
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    const again = await signIn('asha', 'maple-river-41');
    assert.equal((await call('sheet-link', { cookie: again, body: { password: PASSWORD } })).status, 403);
  });

  it('is reported as a setup problem when the key is not valid', async () => {
    setEnv(g, { OWNER_TOTP_SECRET: 'not a key !!' });
    assert.ok(configProblems().some((p) => p.startsWith('OWNER_TOTP_SECRET')));
    setEnv(g, { OWNER_TOTP_SECRET: KEY.toLowerCase().replace(/(.{4})/g, '$1 ') });
    assert.deepEqual(configProblems(), [], 'spaces and lower case are fine');
  });

  it('matches the standard test values and allows one step of clock drift', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(totpAt(secret, 59_000), '287082');
    assert.equal(verifyTotp(secret, '287082', 59_000 + 30_000), 1, 'one step later still works');
    assert.equal(verifyTotp(secret, '287082', 59_000 + 90_000), null, 'three steps later does not');
    assert.equal(verifyTotp(secret, '28708', 59_000), null);
    assert.equal(verifyTotp(secret, 'abcdef', 59_000), null);
  });
});

describe('slowing down guessing', () => {
  it('slows answers for a username after a few wrong tries, from any address, up to 10 seconds, then forgets', () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) noteAccountFailure('victim', t);
    assert.equal(accountDelay('victim', t), 0);
    noteAccountFailure('victim', t);
    assert.equal(accountDelay('victim', t), 500);
    for (let i = 0; i < 50; i++) noteAccountFailure('victim', t);
    assert.equal(accountDelay('victim', t), 10_000);
    assert.equal(accountDelay('victim', t + 16 * 60_000), 0);
    assert.equal(accountDelay('someone-else', t), 0);
  });

  it('checks guesses at one username one at a time', async () => {
    const log: string[] = [];
    const task = (name: string, ms: number) => serialized('u', async () => {
      log.push(`${name}-start`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`${name}-end`);
    });
    await Promise.all([task('a', 30), task('b', 5), task('c', 1)]);
    assert.deepEqual(log, ['a-start', 'a-end', 'b-start', 'b-end', 'c-start', 'c-end']);
  });

  it('turns away a long queue for one username', async () => {
    const waiting: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) waiting.push(serialized('busy', () => new Promise<void>((r) => setTimeout(r, 5))));
    assert.throws(() => serialized('busy', async () => undefined), /Too many sign-in attempts/);
    await Promise.all(waiting);
  });

  it('forgives a little after a good sign-in, not everything', () => {
    const t = 5_000_000;
    for (let i = 0; i < 7; i++) noteLoginFailure('addr', t);
    easeLoginFailures('addr', t);
    assert.equal(loginBlocked('addr', t), false);
    for (let i = 0; i < 3; i++) noteLoginFailure('addr', t);
    assert.equal(loginBlocked('addr', t), true, '5 + 3 = 8 is still the limit');
  });

  it('puts a ceiling on requests per address', () => {
    const t = 9_000_000;
    for (let i = 0; i < 600; i++) assert.equal(apiAllowed('1.2.3.4', t), true);
    assert.equal(apiAllowed('1.2.3.4', t), false);
    assert.equal(apiAllowed('5.6.7.8', t), true, 'other addresses are not affected');
    assert.equal(apiAllowed('1.2.3.4', t + 61_000), true, 'and it resets after a minute');
  });

  it('slows the real sign-in too, however many addresses the guesses come from', async () => {
    for (let i = 0; i < 6; i++) assert.equal((await login(OWNER, 'wrong guess', undefined, `203.0.113.${i + 10}`)).status, 401);
    for (let i = 0; i < 2; i++) await login(OWNER, 'wrong guess', undefined, `203.0.113.${i + 40}`);
    assert.ok(accountDelay(OWNER) >= 500, 'the 8 wrong tries from 8 different addresses now slow every answer');
  });
});

describe('ending sign-ins on the server', () => {
  it('logout cancels the cookie itself, so a copy of it stops working, and survives a restart', async () => {
    const copy = await signIn();
    const other = await signIn();
    assert.equal((await call('data', { cookie: copy, method: 'GET' })).status, 200);
    assert.equal((await call('logout', { cookie: copy })).status, 200);
    assert.equal((await call('data', { cookie: copy, method: 'GET' })).status, 401);
    assert.equal((await call('data', { cookie: other, method: 'GET' })).status, 200, 'other sign-ins are untouched');
    resetRevocations();
    assert.equal((await call('data', { cookie: copy, method: 'GET' })).status, 401, 'still cancelled after a restart');
  });

  it('"Sign out everyone" ends every sign-in at once; new sign-ins work', async () => {
    const staff = await makeStaff();
    assert.equal((await call('data', { cookie: staff, method: 'GET' })).status, 200);
    const r = await call('sign-out-all', { cookie: owner });
    assert.equal(r.status, 200);
    assert.match(String(r.headers['set-cookie']), /Max-Age=0/);
    assert.equal((await call('data', { cookie: owner, method: 'GET' })).status, 401);
    assert.equal((await call('data', { cookie: staff, method: 'GET' })).status, 401);
    resetRevocations();
    assert.equal((await call('data', { cookie: staff, method: 'GET' })).status, 401, 'also after a restart');
    const fresh = await signIn();
    assert.equal((await call('data', { cookie: fresh, method: 'GET' })).status, 200);
  });

  it('"Sign out everyone" is for the owner only', async () => {
    const staff = await makeStaff();
    assert.equal((await call('sign-out-all', { cookie: staff })).status, 403);
    assert.equal((await call('data', { cookie: staff, method: 'GET' })).status, 200);
  });

  it('names the cookie so another website cannot overwrite it on https, and keeps a plain name on http', async () => {
    const https = await login(OWNER, PASSWORD);
    assert.match(String(https.headers['set-cookie']), /^__Host-haveli_session=.*Path=\/.*HttpOnly.*SameSite=Strict.*Secure/);
    const http = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'x-forwarded-proto': 'http' } });
    const set = String(http.headers['set-cookie']);
    assert.match(set, /^haveli_session=/);
    assert.doesNotMatch(set, /Secure/);
    const plain = set.split(';')[0];
    assert.equal((await call('data', { cookie: plain, method: 'GET' })).status, 200);
  });

  it('treats a damaged cookie as signed out, not as a crash', async () => {
    const r = await call('data', { cookie: '__Host-haveli_session=%E0%A4%A', method: 'GET' });
    assert.equal(r.status, 401);
  });

  it('refuses a request a browser says came from another website', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const r = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'sec-fetch-site': site } });
      assert.equal(r.status, 403, site);
    }
    for (const site of ['same-origin', 'none']) {
      const r = await call('login', { body: { username: OWNER, password: PASSWORD }, headers: { 'sec-fetch-site': site } });
      assert.equal(r.status, 200, site);
    }
  });
});

describe('password rules', () => {
  it('turns down easy employee passwords and ones that contain the name', async () => {
    const save = (password: string) => call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: true, password } });
    for (const [pw, why] of [['short', /8 to 100/], ['password1', /too easy/], ['qwertyui', /keyboard/], ['11111111', /repetitive/], ['asha-2024-ok', /username or name/], ['verma-and-co', /username or name/]] as const) {
      const r = await save(pw);
      assert.equal(r.status, 422, pw);
      assert.match(r.body.fields.password, why, pw);
    }
    assert.equal((await save('maple-river-41')).status, 200);
  });

  it('will not accept an easy owner password, naming only the setting', async () => {
    setEnv(g, { OWNER_PASSWORD: 'Password123' });
    const r = await call('session', { method: 'GET' });
    assert.equal(r.body.configured, false);
    assert.ok(r.body.missing.some((m: string) => m.startsWith('OWNER_PASSWORD')));
    assert.ok(!JSON.stringify(r.body).includes('Password123'));
  });

  it('keeps old (weaker) hashes working and refuses hashes asking for absurd amounts of memory', async () => {
    const salt = randomBytes(16);
    const old = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync('legacy pass', salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
    assert.equal(await verifyPassword('legacy pass', old), true);
    assert.equal(await verifyPassword('wrong', old), false);
    assert.match(await hashPassword('x1y2z3w4'), /^scrypt\$32768\$8\$1\$/);
    const t = Date.now();
    assert.equal(await verifyPassword('x', `scrypt$1073741824$8$1$${salt.toString('base64')}$${Buffer.alloc(32).toString('base64')}`), false);
    assert.ok(Date.now() - t < 500, 'refused at once');
  });
});

describe('security log', () => {
  const log = async () => (await call('security', { cookie: owner, method: 'GET' })).body;

  it('records sign-ins and wrong passwords (with the address), newest first, owner only', async () => {
    await login('asha', 'wrong one', undefined, '198.51.100.77');
    const { events } = await log();
    assert.equal(events[0].type, 'login-failed');
    assert.equal(events[0].who, 'asha');
    assert.equal(events[0].ip, '198.51.100.77');
    assert.ok(events.some((e: { type: string }) => e.type === 'login'), 'the owner sign-in from the test set-up');
    const staff = await makeStaff();
    assert.equal((await call('security', { cookie: staff, method: 'GET' })).status, 403);
  });

  it('cannot be forged through a username, and never holds a password', async () => {
    await login('x\nFAKE login ok user="owner"', 'secret-guess-123', undefined, '198.51.100.78');
    await call('staff-save', { cookie: owner, body: { username: 'bob.s', name: 'Bob Singh', role: 'Reception', active: true, password: 'cedar-lake-52' } });
    const text = JSON.stringify(await log());
    assert.ok(!text.includes('\\n'));
    assert.ok(!text.includes('secret-guess-123'));
    assert.ok(!text.includes('cedar-lake-52'));
    assert.ok(text.includes('staff-saved'));
  });

  it('shows a checklist: 2-step code, private connection, owner password length', async () => {
    const { checks } = await log();
    const by = Object.fromEntries(checks.map((c: { id: string; ok: boolean }) => [c.id, c.ok]));
    assert.deepEqual(by, { 'two-step': false, https: true, 'owner-password': true });
    setEnv(g, { OWNER_TOTP_SECRET: KEY });
    const cookie = await signInWithCode();
    const again = await call('security', { cookie, method: 'GET' });
    assert.equal(again.body.checks.find((c: { id: string }) => c.id === 'two-step').ok, true);
    const plain = await call('security', { cookie, method: 'GET', headers: { 'x-forwarded-proto': 'http' } });
    assert.equal(plain.body.checks.find((c: { id: string }) => c.id === 'https').ok, false, 'a proxy says the visitor used plain http');
  });
});

async function signInWithCode(): Promise<string> {
  const r = await login(OWNER, PASSWORD, now());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return String(r.headers['set-cookie']).split(';')[0];
}
