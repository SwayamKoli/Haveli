import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDotEnv } from '../server/dotenv';

describe('.env reader', () => {
  it('reads plain, quoted and commented lines', () => {
    const env = parseDotEnv('# note\nA=1\nB = two words  # trailing\nC="x\\ny"\nD=\'raw\\n\'\nE=pass#word\n\nexport F=ok\n');
    assert.deepEqual(env, { A: '1', B: 'two words', C: 'x\ny', D: 'raw\\n', E: 'pass#word', F: 'ok' });
  });

  it('accepts the Google key file pasted as downloaded, over many lines', () => {
    const json = '{\n  "type": "service_account",\n  "client_email": "bot@p.iam.gserviceaccount.com",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n"\n}';
    const env = parseDotEnv(`SHEET_ID=abc\nGOOGLE_SERVICE_ACCOUNT_JSON='${json}'\nAPP_PASSWORD=secret-pass\n`);
    assert.equal(env.SHEET_ID, 'abc');
    assert.equal(env.APP_PASSWORD, 'secret-pass');
    const parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    assert.equal(parsed.client_email, 'bot@p.iam.gserviceaccount.com');
    assert.match(parsed.private_key, /^-----BEGIN PRIVATE KEY-----\nABC\n/);
  });

  it('handles Windows line endings and a byte-order mark', () => {
    assert.deepEqual(parseDotEnv('﻿A=1\r\nB="2"\r\n'), { A: '1', B: '2' });
  });

  const key = { type: 'service_account', client_email: 'bot@p.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n' };
  const pretty = JSON.stringify(key, null, 2);

  it('reads the key file even without quotes around it', () => {
    const env = parseDotEnv(`SHEET_ID=abc\nGOOGLE_SERVICE_ACCOUNT_JSON=${pretty}\nAPP_PASSWORD=secret-pass\n`);
    assert.deepEqual(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON), key);
    assert.equal(env.APP_PASSWORD, 'secret-pass');
    assert.equal(env.SHEET_ID, 'abc');
  });

  it('reads the key file when it is wrapped in double quotes', () => {
    for (const body of [JSON.stringify(key), pretty]) {
      const env = parseDotEnv(`GOOGLE_SERVICE_ACCOUNT_JSON="${body}"\nAPP_PASSWORD=x12345678\n`);
      assert.deepEqual(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON), key);
      assert.equal(env.APP_PASSWORD, 'x12345678');
    }
  });

  it('does not let braces inside strings confuse it', () => {
    const odd = { a: 'x } y { z', b: 'q\\"}' };
    const env = parseDotEnv(`J=${JSON.stringify(odd)}\nK=1\n`);
    assert.deepEqual(JSON.parse(env.J), odd);
    assert.equal(env.K, '1');
  });

  it('still reads later lines when a key file is cut off', () => {
    const env = parseDotEnv('J={"a": "b"\nK=1\n');
    assert.equal(env.K, '1');
    assert.throws(() => JSON.parse(env.J));
  });
});
