import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { passwordHash, verifyPassword, checkPassword, parsePasswordHash, createWorkLimiter, PasswordCapacityError, SCRYPT_PARAMETERS } from '../apps/api/dist/password.js';
import { readSecurityConfig, trustedRequestSource, validCsrfToken, validSessionToken } from '../apps/api/dist/security.js';
import { loginBudgets, MemoryLoginAttemptStore, PostgresLoginAttemptStore, loginRateLimit, LOGIN_ACCOUNT_LIMIT, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS } from '../apps/api/dist/login-rate-limit.js';

// Standalone units intentionally import no database singleton or .env loader.
test('new passwords use versioned OWASP scrypt and verify without upgrades', async () => {
  const password = 'Unit-only Arabic كلمة مرور 🔐';
  const encoded = await passwordHash(password);
  assert.match(encoded, /^scrypt:v1:131072:8:1:[a-f0-9]{32}:[a-f0-9]{128}$/);
  const parsed = parsePasswordHash(encoded);
  assert.ok(parsed && !parsed.legacy);
  const independent = await promisify(scrypt)(password, parsed.salt, 64, SCRYPT_PARAMETERS);
  assert.deepEqual(independent, parsed.digest);
  assert.deepEqual(await checkPassword(password, encoded), { valid: true, needsUpgrade: false });
  assert.equal(await verifyPassword('wrong unit password', encoded), false);
});

test('existing three-part hashes remain valid and upgrade only after a match', async () => {
  const salt = '1'.repeat(32), password = 'Legacy unit password';
  const encoded = `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
  assert.deepEqual(await checkPassword(password, encoded), { valid: true, needsUpgrade: true });
  assert.deepEqual(await checkPassword('incorrect', encoded), { valid: false, needsUpgrade: false });
  assert.equal(await verifyPassword(password, encoded), true);
});

test('unknown/malformed hashes fail safely and arbitrary stored work factors are rejected', async () => {
  const validTail = `${'a'.repeat(32)}:${'b'.repeat(128)}`;
  for (const value of [null, '', `other:${validTail}`, `scrypt:v2:131072:8:1:${validTail}`, `scrypt:v1:2147483648:8:1:${validTail}`, `scrypt:v1:16384:8:1:${validTail}`, `scrypt:${validTail}:extra`, `scrypt:${'a'.repeat(32)}:zz`]) assert.equal(parsePasswordHash(value), null);
  assert.deepEqual(await checkPassword('unit password', undefined), { valid: false, needsUpgrade: false });
  assert.equal(await verifyPassword('x'.repeat(801), `scrypt:${validTail}`), false);
  await assert.rejects(passwordHash('x'.repeat(801)), /length/);
});

test('password queue caps active work and queue length, then recovers after failure', async () => {
  const run = createWorkLimiter(2, 1), releases = [];
  let active = 0, peak = 0;
  const work = () => run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve));
    active--;
  });
  const first = work(), second = work(), third = work();
  await assert.rejects(work(), PasswordCapacityError);
  assert.equal(releases.length, 2);
  releases.shift()();
  await first;
  assert.equal(releases.length, 2);
  releases.shift()(); releases.shift()();
  await Promise.all([second, third]);
  assert.equal(peak, 2);
  await assert.rejects(run(async () => { throw new Error('unit failure'); }), /unit failure/);
  assert.equal(await run(async () => 7), 7);
  assert.throws(() => createWorkLimiter(0), /limits/);
});

const production = { NODE_ENV: 'production', HOST: '0.0.0.0', WEB_ORIGIN: 'https://store.example', PUBLIC_SITE_URL: 'https://store.example', COOKIE_SECURE: 'true' };
test('public production requires HTTPS secure cookies and shared login limits', () => {
  const config = readSecurityConfig(production);
  assert.equal(config.secureCookies, true);
  assert.equal(config.loginRateLimitStore, 'postgres');
  assert.equal(config.trustProxy, false);
  assert.throws(() => readSecurityConfig({ ...production, COOKIE_SECURE: 'false' }), /HTTPS/);
  assert.throws(() => readSecurityConfig({ ...production, WEB_ORIGIN: 'http://store.example' }), /HTTPS/);
  assert.throws(() => readSecurityConfig({ ...production, LOGIN_RATE_LIMIT_STORE: 'memory' }), /postgres/);
  assert.throws(() => readSecurityConfig({ ...production, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }), /HTTPS/);
  assert.throws(() => readSecurityConfig({ ...production, TRUST_PROXY: '1' }), /proxy/);
  assert.deepEqual(readSecurityConfig({ ...production, TRUST_PROXY: '127.0.0.1,172.29.0.2/32' }).trustProxy, ['127.0.0.1', '172.29.0.2/32']);
});

test('local HTTP production preview requires an explicit loopback-only exception', () => {
  const preview = { NODE_ENV: 'production', HOST: '127.0.0.1', WEB_ORIGIN: 'http://localhost:3000', COOKIE_SECURE: 'false', ALLOW_INSECURE_LOCAL_PREVIEW: 'true' };
  assert.equal(readSecurityConfig(preview).loginRateLimitStore, 'memory');
  assert.equal(readSecurityConfig({ NODE_ENV: 'development' }).loginRateLimitStore, 'memory');
  assert.throws(() => readSecurityConfig({ ...preview, ALLOW_INSECURE_LOCAL_PREVIEW: undefined }), /HTTPS/);
  assert.throws(() => readSecurityConfig({ ...preview, HOST: '0.0.0.0' }), /loopback/);
  assert.throws(() => readSecurityConfig({ ...preview, NEXT_PUBLIC_SITE_URL: 'https://public.example' }), /loopback/);
  assert.throws(() => readSecurityConfig({ WEB_ORIGIN: 'https://user:password@store.example' }), /origin/);
  assert.throws(() => readSecurityConfig({ WEB_ORIGIN: 'https://store.example/path' }), /origin/);
  assert.throws(() => readSecurityConfig({ COOKIE_SECURE: 'yes' }), /true or false/);
});

test('request source checks reject cross-site sources and permit established programmatic clients', () => {
  const allowed = ['https://store.example'];
  assert.equal(trustedRequestSource({}, allowed), true);
  assert.equal(trustedRequestSource({ origin: allowed[0] }, allowed), true);
  assert.equal(trustedRequestSource({ referer: `${allowed[0]}/admin` }, allowed), true);
  assert.equal(trustedRequestSource({ fetchSite: 'same-origin' }, allowed), true);
  for (const headers of [{ origin: 'null' }, { origin: 'https://store.example.attacker.example' }, { origin: 'https://attacker.example', referer: allowed[0] }, { referer: 'https://store.example@attacker.example' }, { fetchSite: 'cross-site' }, { fetchSite: 'same-site' }]) assert.equal(trustedRequestSource(headers, allowed), false);
});

test('CSRF and session tokens must be exact random token encodings', () => {
  const token = 'a'.repeat(64);
  assert.equal(validCsrfToken(token, token), true);
  assert.equal(validCsrfToken('b'.repeat(64), token), false);
  assert.equal(validCsrfToken(undefined, undefined), false);
  assert.equal(validCsrfToken('abc', 'abc'), false);
  assert.equal(validSessionToken(token), true);
  for (const invalid of ['', 'z'.repeat(64), 'a'.repeat(63), ['a'.repeat(64)]]) assert.equal(validSessionToken(invalid), false);
});

test('login budgets normalize accounts and IPv4-mapped/IPv6 identities without storing plaintext', () => {
  const first = loginBudgets('192.0.2.1', 'Owner@Example.test');
  const mapped = loginBudgets('::ffff:192.0.2.1', ' owner@example.test ');
  assert.deepEqual(first, mapped);
  assert.ok(first.every(budget => /^[a-f0-9]{64}$/.test(budget.key) && budget.windowMs === LOGIN_WINDOW_MS));
  assert.deepEqual(first.map(value => value.limit).sort((a, b) => a - b), [LOGIN_ACCOUNT_LIMIT, LOGIN_IP_LIMIT]);
  const accountKey = first.find(value => value.limit === LOGIN_ACCOUNT_LIMIT).key;
  assert.equal(loginBudgets('192.0.2.2', 'owner@example.test').find(value => value.limit === LOGIN_ACCOUNT_LIMIT).key, accountKey);
  assert.deepEqual(loginBudgets('2001:db8:abcd:1200::1', 'owner@example.test'), loginBudgets('2001:db8:abcd:12ff::2', 'owner@example.test'));
});

test('login windows expire automatically and denied requests cannot extend expiry', async () => {
  let now = 1000;
  const store = new MemoryLoginAttemptStore(() => now);
  const budgets = [{ key: 'ip', limit: 2, windowMs: 10000 }, { key: 'account', limit: 1, windowMs: 10000 }];
  assert.deepEqual((await store.consume(budgets)).map(row => row.attempts), [1, 1]);
  now += 2000;
  assert.deepEqual((await store.consume(budgets)).map(row => row.attempts), [2, 2]);
  now += 7000;
  assert.ok((await store.consume(budgets)).every(row => row.retryAfter === 1));
  now = 11000;
  assert.ok((await store.consume(budgets)).every(row => row.attempts === 1 && row.retryAfter === 10));
});

test('local store bounds cardinality and frees expired capacity without evicting active limits', async () => {
  let now = 0;
  const store = new MemoryLoginAttemptStore(() => now, 1);
  await store.consume([{ key: 'one', limit: 1, windowMs: 1000 }]);
  await assert.rejects(store.consume([{ key: 'two', limit: 1, windowMs: 1000 }]), /capacity/);
  assert.equal((await store.consume([{ key: 'one', limit: 1, windowMs: 1000 }]))[0].attempts, 2);
  now = 1000;
  assert.equal((await store.consume([{ key: 'two', limit: 1, windowMs: 1000 }]))[0].attempts, 1);
});

test('a blocked IP does not allocate new account keys in the local store', async () => {
  const store = new MemoryLoginAttemptStore(() => 0, LOGIN_IP_LIMIT + 1);
  for (let index = 0; index < LOGIN_IP_LIMIT; index++) {
    const result = await store.consume(loginBudgets('192.0.2.7', `unit-${index}@example.test`));
    assert.equal(result.length, 2);
  }
  // The map is full with one IP + thirty accounts. Further new emails must still
  // return a blocked IP, without requesting space for any additional account.
  for (let index = 0; index < 20; index++) {
    const result = await store.consume(loginBudgets('192.0.2.7', `blocked-${index}@example.test`));
    assert.equal(result.length, 1);
    assert.ok(result[0].attempts > LOGIN_IP_LIMIT);
  }
});

function responseCapture() {
  return { headers: {}, statusCode: 200, jsonBody: null, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.jsonBody = value; return this; } };
}
test('login middleware blocks either dimension with Retry-After and fails closed without leaking exceptions', async () => {
  const req = { ip: '192.0.2.4', socket: {}, body: { email: 'unit@example.test' } };
  let nextCalls = 0;
  const limited = loginRateLimit({ async consume(budgets) { return budgets.map(row => ({ key: row.key, attempts: row.limit + 1, retryAfter: 12 })); } });
  const denied = responseCapture();
  await limited(req, denied, () => nextCalls++);
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers['Retry-After'], '12');
  assert.equal(nextCalls, 0);
  const unavailable = responseCapture();
  await loginRateLimit({ async consume() { throw new Error('postgres://unit:secret@host hash=passwordHash'); } })(req, unavailable, () => nextCalls++);
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.headers['Retry-After'], '5');
  assert.doesNotMatch(JSON.stringify(unavailable.jsonBody), /secret|postgres|passwordHash/);
  assert.equal(nextCalls, 0);
});

test('partial store results can deny a recognized blocked counter but cannot allow login', async () => {
  const req = { ip: '192.0.2.4', socket: {}, body: { email: 'unit@example.test' } };
  let nextCalls = 0;
  const partial = async (attempts, keyOverride) => {
    const response = responseCapture();
    await loginRateLimit({ async consume(budgets) { return [{ key: keyOverride || budgets[0].key, attempts, retryAfter: 23 }]; } })(req, response, () => nextCalls++);
    return response;
  };
  const blocked = await partial(LOGIN_IP_LIMIT + 1);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['Retry-After'], '23');
  assert.equal((await partial(1)).statusCode, 503);
  assert.equal((await partial(LOGIN_IP_LIMIT + 1, 'unrecognized')).statusCode, 503);
  assert.equal((await partial(Number.NaN)).statusCode, 503);
  assert.equal(nextCalls, 0);
  const allowed = responseCapture();
  await loginRateLimit({ async consume(budgets) { return budgets.map(budget => ({ key: budget.key, attempts: 1, retryAfter: 900 })); } })(req, allowed, () => nextCalls++);
  assert.equal(nextCalls, 1);
});

test('PostgreSQL reserves IP before account and uses atomic parameterized reservations across instances', async () => {
  const attempts = new Map(), reservations = [], cleanups = [];
  const client = {
    async $queryRaw(query) {
      reservations.push(query);
      const key = query.values[0];
      const count = (attempts.get(key) || 0) + 1;
      attempts.set(key, count);
      return [{ key, attempts: count, retryAfter: 900 }];
    },
    async $executeRaw(query) { cleanups.push(query); return 0; },
  };
  const stores = [new PostgresLoginAttemptStore(client), new PostgresLoginAttemptStore(client)];
  const results = await Promise.all(Array.from({ length: 45 }, (_, index) => stores[index % 2].consume(loginBudgets('192.0.2.4', `unit-${index}@example.test`))));
  const ipKey = loginBudgets('192.0.2.4', 'unit@example.test')[0].key;
  assert.equal(attempts.get(ipKey), 45);
  assert.equal(attempts.size, LOGIN_IP_LIMIT + 1);
  assert.equal(results.filter(result => result.length === 1).length, 15);
  assert.equal(reservations.filter(query => query.values[0] !== ipKey).length, LOGIN_IP_LIMIT);
  assert.equal(cleanups.length, 45);
  for (const query of reservations) {
    assert.match(query.text, /ON CONFLICT \("key"\) DO UPDATE/);
    assert.match(query.text, /"attempts"::bigint \+ 1/);
    assert.match(query.text, /ELSE "AuthLoginAttempt"\."expiresAt" END/);
    assert.ok(!query.text.includes(query.values[0]));
    assert.doesNotMatch(query.text, /unit-.*@example/);
  }
  assert.equal(reservations[0].values[0], ipKey);
});

test('PostgreSQL cleanup is bounded per request and cannot delete a concurrently refreshed counter', async () => {
  const cleanups = [];
  const store = new PostgresLoginAttemptStore({
    async $queryRaw(query) { return [{ key: query.values[0], attempts: 1, retryAfter: 900 }]; },
    async $executeRaw(query) { cleanups.push(query); return 0; },
  });
  await store.consume(loginBudgets('192.0.2.4', 'unit@example.test'));
  await store.consume(loginBudgets('192.0.2.5', 'second@example.test'));
  assert.equal(cleanups.length, 2);
  for (const query of cleanups) {
    assert.match(query.text, /LIMIT 64 FOR UPDATE SKIP LOCKED/);
    assert.match(query.text, /WHERE attempt\."key" = expired\."key" AND attempt\."expiresAt" <= CURRENT_TIMESTAMP/);
  }
});
