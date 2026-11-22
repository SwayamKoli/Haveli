/**
 * Signing in, employee accounts, the owner password and the link to the Google Sheet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createToken, verifyToken } from '../../api/auth/session';
import type { SessionUser } from '../../api/auth/session';
import { SHEET_ID } from '../helpers/fakeGoogle';
import { call, OWNER, PASSWORD, SECRET, setEnv } from '../helpers/harness';
import { g, owner, cellAt, makeStaff, created, useHotel } from '../helpers/hotel';

useHotel();

describe('sign-in', () => {
  it('reports setup problems by name only, never by value', async () => {
    setEnv(g, { SHEET_ID: undefined, OWNER_PASSWORD: 'short' });
    const r = await call('session');
    assert.equal(r.body.configured, false);
    assert.deepEqual(r.body.missing, ['SHEET_ID', 'OWNER_PASSWORD (use at least 8 characters)']);
    assert.equal(r.body.hotel, 'Test Hotel');
    assert.equal(JSON.stringify(r.body).includes('short'), false);
    assert.equal((await call('login', { body: { username: OWNER, password: 'x' } })).status, 503);
  });

  it('still accepts APP_PASSWORD from older installs as the owner password', async () => {
    setEnv(g, { OWNER_PASSWORD: undefined, APP_PASSWORD: PASSWORD });
    const r = await call('login', { body: { username: OWNER, password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.equal(r.body.staff.owner, true);
  });

  it('signs the owner in with username and password, and says who they are', async () => {
    const ok = await call('login', { body: { username: ' Owner ', password: PASSWORD } });
    assert.equal(ok.status, 200);
    const setCookie = String(ok.headers['set-cookie']);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Secure/);
    assert.deepEqual(ok.body.staff, { username: 'owner', name: 'Test Owner', role: 'Owner', owner: true, viaOwner: false });
    assert.equal(ok.body.hotel, 'Test Hotel');
    const s = await call('session', { cookie: owner });
    assert.equal(s.body.authenticated, true);
    assert.equal(s.body.staff.username, 'owner');
  });

  it('rejects wrong, blank and unknown credentials without setting a cookie', async () => {
    for (const body of [
      { username: OWNER, password: 'nope' },
      { username: OWNER, password: '' },
      { username: '', password: PASSWORD },
      { username: 'nobody', password: 'nope' },
      { username: 'nobody', password: PASSWORD },
      { password: PASSWORD },
      {},
    ]) {
      const r = await call('login', { body });
      assert.equal(r.status, 401, JSON.stringify(body));
      assert.equal(r.headers['set-cookie'], undefined);
      assert.equal(r.body.error, 'The username or password is not right.');
    }
  });

  it('locks out an address after repeated wrong passwords', async () => {
    for (let i = 0; i < 8; i++) await call('login', { body: { username: OWNER, password: 'wrong' }, ip: '203.0.113.9' });
    const r = await call('login', { body: { username: OWNER, password: PASSWORD }, ip: '203.0.113.9' });
    assert.equal(r.status, 429);
    assert.equal((await call('login', { body: { username: OWNER, password: PASSWORD }, ip: '203.0.113.10' })).status, 200);
  });

  it('keeps data private without a valid cookie', async () => {
    assert.equal((await call('data')).status, 401);
    assert.equal((await call('data', { cookie: 'haveli_session=v1.9999999999.forged' })).status, 401);
    assert.equal((await call('data', { cookie: 'haveli_session=v2.e30.forged' })).status, 401);
    assert.equal((await call('data', { cookie: owner })).status, 200);
  });

  it('refuses changes that lack the anti-forgery header', async () => {
    const r = await call('room-status', { cookie: owner, noCsrf: true, body: { no: 101, status: 'cleaning' } });
    assert.equal(r.status, 403);
  });

  it('signed tokens carry who is signed in, expire, and cannot be tampered with', () => {
    const who: SessionUser = { u: 'asha', n: 'Asha Verma', r: 'Reception', o: false, v: false, k: 'abcdef' };
    const t = createToken(SECRET, who, 1_000_000);
    assert.deepEqual(verifyToken(SECRET, t, 2_000_000), who);
    assert.equal(verifyToken(SECRET, t, 1_000_000 + 13 * 3600 * 1000), null, 'a shift is 12 hours');
    assert.equal(verifyToken('another-secret-another-secret!!', t, 2_000_000), null);
    const [v, body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...who, o: true, e: 9_999_999_999 })).toString('base64url');
    assert.equal(verifyToken(SECRET, `${v}.${forged}.${sig}`, 2_000_000), null, 'cannot make yourself owner');
    assert.equal(verifyToken(SECRET, `v1.${body}.${sig}`, 2_000_000), null);
    assert.equal(verifyToken(SECRET, null), null);
  });
});


describe('staff accounts and the owner password', () => {
  it('lets the owner add an employee; the password is stored only as a hash', async () => {
    await makeStaff();
    const row = g.rows('Staff')[0];
    assert.equal(row[0], 'asha');
    assert.equal(row[1], 'Asha Verma');
    assert.equal(row[2], 'Reception');
    assert.match(String(row[3]), /^scrypt\$16384\$8\$1\$/);
    assert.equal(row[4], 'Yes');
    assert.equal(JSON.stringify(g.tabs).includes('asha-pass-1'), false, 'the password itself is nowhere in the sheet');
    const list = await call('staff-list', { cookie: owner });
    assert.deepEqual(list.body.staff.map((s: any) => [s.username, s.name, s.role, s.active]), [['asha', 'Asha Verma', 'Reception', true]]);
    assert.equal(JSON.stringify(list.body).includes('scrypt'), false, 'hashes never leave the server');
  });

  it('signs an employee in with their own username and password', async () => {
    await makeStaff();
    const r = await call('login', { body: { username: 'ASHA', password: 'asha-pass-1' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.staff, { username: 'asha', name: 'Asha Verma', role: 'Reception', owner: false, viaOwner: false });
    assert.equal((await call('login', { body: { username: 'asha', password: 'wrong-pass' } })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: 'asha-pass-1' } })).status, 401, 'an employee password never opens the owner account');
  });

  it('lets the owner password open any employee account, and records "(via owner)"', async () => {
    await makeStaff();
    const r = await call('login', { body: { username: 'asha', password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.staff, { username: 'asha', name: 'Asha Verma', role: 'Reception', owner: false, viaOwner: true });
    const viaOwner = String(r.headers['set-cookie']).split(';')[0];
    const b = await created({}, viaOwner);
    assert.equal(b.createdBy, 'Asha Verma (via owner)');
    assert.equal(cellAt('Bookings', 0, 'Created by'), 'Asha Verma (via owner)');
    assert.equal((await call('login', { body: { username: 'nobody', password: PASSWORD } })).status, 401);
  });

  it('does not let an employee (or the owner acting as one) use owner-only powers', async () => {
    const own = await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    for (const cookie of [own, via]) {
      for (const [action, body] of [
        ['staff-list', undefined],
        ['staff-save', { username: 'bob', name: 'Bob Roy', role: 'Reception', password: 'bobs-pass-1' }],
        ['health', undefined],
        ['sheet-setup', {}],
        ['rooms-generate', { floors: 1, perFloor: 2, rate: 2000 }],
      ] as const) {
        const r = await call(action, { cookie, body });
        assert.equal(r.status, 403, action);
        assert.equal(r.body.error, 'Only the owner can do this.');
      }
    }
    assert.equal((await call('staff-list', { cookie: owner })).status, 200);
    assert.equal((await call('health', { cookie: owner })).status, 200);
  });

  it('shows the owner password never opens a switched-off employee', async () => {
    await makeStaff();
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: false, password: '' } });
    assert.equal((await call('login', { body: { username: 'asha', password: PASSWORD } })).status, 401);
    assert.equal((await call('login', { body: { username: 'asha', password: 'asha-pass-1' } })).status, 401);
  });

  it('signs an employee out the moment the owner switches them off', async () => {
    const own = await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    assert.equal((await call('data', { cookie: own })).status, 200);
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', active: false, password: '' } });
    assert.equal((await call('data', { cookie: own })).status, 401);
    assert.equal((await call('data', { cookie: via })).status, 401);
    assert.equal((await call('session', { cookie: own })).body.authenticated, false);
  });

  it('signs an employee out when their password is changed, and the new one works', async () => {
    const own = await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha V.', role: 'Manager', active: true, password: 'new-pass-22' } });
    assert.equal((await call('data', { cookie: own })).status, 401);
    assert.equal((await call('data', { cookie: via })).status, 200, 'the owner is still in, acting as them');
    assert.equal((await call('login', { body: { username: 'asha', password: 'asha-pass-1' } })).status, 401);
    const ok = await call('login', { body: { username: 'asha', password: 'new-pass-22' } });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.staff.name, ok.body.staff.role], ['Asha V.', 'Manager']);
  });

  it('signs the owner (and anyone in via the owner) out when the owner password changes', async () => {
    await makeStaff();
    const via = String((await call('login', { body: { username: 'asha', password: PASSWORD } })).headers['set-cookie']).split(';')[0];
    setEnv(g, { OWNER_PASSWORD: 'a brand new owner password' });
    assert.equal((await call('data', { cookie: owner })).status, 401);
    assert.equal((await call('data', { cookie: via })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: PASSWORD } })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: 'a brand new owner password' } })).status, 200);
  });

  it('checks the employee form and explains each mistake', async () => {
    const bad = await call('staff-save', { cookie: owner, body: { username: 'A!', name: 'x', role: 'King', password: 'abc' } });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.fields.username && bad.body.fields.name && bad.body.fields.role && bad.body.fields.password);
    const noPw = await call('staff-save', { cookie: owner, body: { username: 'bobby', name: 'Bobby Roy', role: 'Reception', password: '' } });
    assert.equal(noPw.status, 422);
    assert.equal(noPw.body.fields.password, 'Set a password for this employee.');
    const clash = await call('staff-save', { cookie: owner, body: { username: OWNER, name: 'Fake Owner', role: 'Manager', password: 'whatever-1' } });
    assert.equal(clash.body.fields.username, 'That username is the owner account.');
    assert.equal(g.rows('Staff').length, 0);
  });

  it('keeps employee names, usernames and roles from becoming formulas', async () => {
    const evil = '=HYPERLINK("http://evil.example","x")';
    await call('staff-save', { cookie: owner, body: { username: 'evil.one', name: evil, role: 'Reception', password: 'pass-word-1' } });
    assert.equal(g.rows('Staff')[0][1], evil);
    assert.equal(Object.keys(g.formulas).some((k) => k.startsWith('Staff!')), false);
  });

  it('edits an existing employee without needing a new password', async () => {
    const own = await makeStaff();
    await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Accounts', active: true, password: '' } });
    assert.equal(g.rows('Staff').length, 1);
    assert.equal(g.rows('Staff')[0][2], 'Accounts');
    assert.equal((await call('data', { cookie: own })).status, 200, 'same password, so still signed in');
  });

  it('asks for the one-time setup when the Staff tab does not exist yet', async () => {
    delete g.tabs.Staff;
    const r = await call('staff-save', { cookie: owner, body: { username: 'asha', name: 'Asha Verma', role: 'Reception', password: 'asha-pass-1' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SETUP');
    assert.equal((await call('login', { body: { username: 'asha', password: 'asha-pass-1' } })).status, 401);
    assert.equal((await call('login', { body: { username: OWNER, password: PASSWORD } })).status, 200, 'the owner can always get in');
  });
});


describe('the link to the Google Sheet', () => {
  it('needs a signed-in person and the owner password', async () => {
    assert.equal((await call('sheet-link', { body: { password: PASSWORD } })).status, 401);
    for (const password of ['wrong', '', undefined, 12345]) {
      const r = await call('sheet-link', { cookie: owner, body: { password } });
      assert.equal(r.status, 401);
      assert.equal(JSON.stringify(r.body).includes(SHEET_ID), false);
    }
    const ok = await call('sheet-link', { cookie: owner, body: { password: PASSWORD } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.url, `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  });

  it('works for an employee only when they type the owner password', async () => {
    const own = await makeStaff();
    assert.equal((await call('sheet-link', { cookie: own, body: { password: 'asha-pass-1' } })).status, 401);
    assert.equal((await call('sheet-link', { cookie: own, body: { password: PASSWORD } })).status, 200);
  });

  it('slows down guessing the owner password', async () => {
    for (let i = 0; i < 8; i++) await call('sheet-link', { cookie: owner, body: { password: 'guess' }, ip: '198.51.100.7' });
    assert.equal((await call('sheet-link', { cookie: owner, body: { password: PASSWORD }, ip: '198.51.100.7' })).status, 429);
  });

  it('is the only place the sheet address is ever sent', async () => {
    await created();
    for (const [action, cookie] of [['data', owner], ['session', owner], ['health', owner], ['staff-list', owner]] as const) {
      const text = JSON.stringify((await call(action, { cookie })).body);
      assert.equal(text.includes(SHEET_ID), false, action);
      assert.equal(text.includes('docs.google.com'), false, action);
      assert.equal(text.includes(PASSWORD), false, action);
      assert.equal(text.includes('PRIVATE KEY'), false, action);
    }
  });
});
