const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { USAGE_URL, REFRESH_MS, parseClaudeLiveUsage, readLocalConnection, createClaudeLiveReader } = require('../lib/claude-live-usage.cjs');
const { createClaudeConnection, TOKEN_URL } = require('../lib/claude-connection.cjs');

const stamp = Date.parse('2026-09-30T06:55:00Z');
const usage = () => ({ five_hour: { utilization: 9, resets_at: '2026-09-30T11:00:00Z' },
  seven_day: { utilization: 42, resets_at: '2026-10-07T08:00:00Z' },
  limits: [{ display_name: 'Fable', percent: 31, resets_at: '2026-10-07T08:00:00Z' }],
  privateField: 'must-never-leave-the-parser' });
const reply = body => ({ ok: true, status: 200, json: async () => body });

test('Current Claude response repeats shared windows and nests Fable in model scope', () => {
  const body = usage();
  body.five_hour.utilization = 31; body.seven_day.utilization = 45;
  body.limits = [
    { kind: 'session', group: 'session', scope: null, percent: 31, resets_at: body.five_hour.resets_at, is_active: false },
    { kind: 'weekly_all', group: 'weekly', scope: null, percent: 45, resets_at: body.seven_day.resets_at, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, percent: 37, resets_at: body.seven_day.resets_at, is_active: false },
  ];
  const snapshot = parseClaudeLiveUsage(body);
  assert.deepEqual(snapshot.quotaWindows.map(w => [w.label, w.remaining]), [['5 heures', 69], ['Semaine', 55], ['Fable · Semaine', 63]]);
  assert.equal(snapshot.quotaRemaining, 55);
  body.limits[0].percent = 32;
  assert.throws(() => parseClaudeLiveUsage(body), /contradictoires/);
  body.limits[0].percent = 31; body.limits[2].scope.model.display_name = null;
  assert.throws(() => parseClaudeLiveUsage(body), /Nom de limite/);
});

test('Claude screenshot quotas become remaining percentages with independent model limits and actual resets', () => {
  const snapshot = parseClaudeLiveUsage(usage(), new Date(stamp));
  assert.deepEqual(snapshot.quotaWindows.map(w => [w.label, w.remaining]), [['5 heures', 91], ['Semaine', 58], ['Fable · Semaine', 69]]);
  assert.equal(snapshot.quotaRemaining, 58);
  assert.equal(snapshot.updatedAt, new Date(stamp).toISOString());
  assert.equal(snapshot.quotaWindows[0].resetAt, '2026-09-30T11:00:00.000Z');
  assert.equal(JSON.stringify(snapshot).includes('must-never-leave'), false);
  const body = usage(); body.limits[0].percent = 100;
  assert.equal(parseClaudeLiveUsage(body).quotaRemaining, 58);
  assert.equal(parseClaudeLiveUsage(body).quotaWindows[2].remaining, 0);
  body.five_hour.utilization = 100; body.seven_day.utilization = 0;
  assert.deepEqual(parseClaudeLiveUsage(body).quotaWindows.slice(0, 2).map(w => w.remaining), [0, 100]);
});

test('Malformed and missing quotas never become estimates or borrow old resets', () => {
  for (const body of [null, {}, { five_hour: usage().five_hour }, { ...usage(), five_hour: { utilization: '9' } },
    { ...usage(), seven_day: { utilization: NaN } }, { ...usage(), five_hour: { utilization: 101 } },
    { ...usage(), limits: {} }, { ...usage(), limits: [{ display_name: 'Fable', percent: -1 }] },
    { ...usage(), limits: [usage().limits[0], usage().limits[0]] },
    { ...usage(), five_hour: { utilization: 9, resets_at: '13:00' } }]) assert.throws(() => parseClaudeLiveUsage(body));
  const body = usage(); body.five_hour.resets_at = null;
  assert.equal(parseClaudeLiveUsage(body).quotaWindows[0].resetAt, null);
});

test('Direct reads serialize, reuse measurements without refreshing their time and reread the current token', async () => {
  let time = stamp, calls = 0, tokens = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const reader = createClaudeLiveReader({ now: () => new Date(time), readToken: async () => `test-token-${++tokens}`,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, USAGE_URL); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, `Bearer test-token-${calls}`);
      await gate;
      return reply(usage());
    } });
  const a = reader.read(), b = reader.read(); release();
  const snapshots = await Promise.all([a, b]); assert.equal(calls, 1);
  time += REFRESH_MS - 1;
  assert.equal((await reader.read()).updatedAt, snapshots[0].updatedAt);
  assert.equal(calls, 1);
  time++;
  assert.equal((await reader.read()).updatedAt, new Date(time).toISOString());
  assert.equal(calls, 2); assert.equal(tokens, 2);
  assert.equal(JSON.stringify(snapshots).includes('test-token'), false);
  reader.clear(); await reader.read(); assert.equal(calls, 3);
});

test('429 throttling honors Retry-After and errors never masquerade as fresh measurements', async () => {
  for (const header of ['0', '999999999999999999999999999999', '7200', new Date(stamp + 7200000).toUTCString()]) {
    let time = stamp, calls = 0;
    const reader = createClaudeLiveReader({ now: () => new Date(time), readToken: async () => 'test-only',
      fetchImpl: async () => ++calls === 1 ? { status: 429, headers: new Headers({ 'retry-after': header }) } : reply(usage()) });
    await assert.rejects(reader.read(), /limite les lectures/);
    // A 429 from the usage endpoint keeps the historical "rate-limit" code.
    assert.equal(reader.info().errorCode, 'rate-limit');
    time += ['0', '999999999999999999999999999999'].includes(header) ? 299999 : 7199999;
    await assert.rejects(reader.read(), /limite les lectures/); assert.equal(calls, 1);
    time++; assert.equal((await reader.read()).updatedAt, new Date(time).toISOString()); assert.equal(calls, 2);
  }
});

test('A token-refresh 429 surfaces as auth-rate-limit through the reader, distinct from a usage 429', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'providersbar-claude-auth-rate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const credentialPath = path.join(root, '.credentials.json');
  await fs.writeFile(credentialPath, JSON.stringify({ claudeAiOauth: {
    accessToken: 'expired-test-access', refreshToken: 'private-refresh-token', expiresAt: stamp - 1000,
    scopes: ['user:profile'], subscriptionType: 'max',
  } }));
  let posts = 0;
  const connection = createClaudeConnection({ credentialPath, now: () => new Date(stamp), fetchImpl: async (url, request) => {
    posts++;
    assert.equal(url, TOKEN_URL);
    assert.equal(request.method, 'POST');
    return { status: 429, ok: false, headers: new Headers({ 'retry-after': '7200' }) };
  } });
  const reader = createClaudeLiveReader({ now: () => new Date(stamp), readToken: connection.read });
  await assert.rejects(reader.read(), error => {
    assert.equal(error.code, 'auth-rate-limit');
    assert.equal(error.retryAt, stamp + 7200000);
    assert.match(error.message, /Renouvellement du jeton Claude Code limité/);
    assert.match(error.message, /Claude Desktop \(Déconnecter puis Connecter\)/);
    assert.ok(!error.message.includes('private-refresh-token') && !error.message.includes('expired-test-access'));
    return true;
  });
  assert.equal(reader.info().errorCode, 'auth-rate-limit');
  assert.equal(reader.info().nextAttemptAt, new Date(stamp + 7200000).toISOString());
  // The server Retry-After is honored for the whole cooldown: no second refresh.
  await assert.rejects(reader.read(), { code: 'auth-rate-limit' });
  assert.equal(posts, 1);
  // The cooldown survives a restart: main.cjs persists claudeSync and restores it.
  const restored = createClaudeLiveReader({ now: () => new Date(stamp), readToken: async () => { throw new Error('must not be called'); } });
  restored.restore(reader.info());
  await assert.rejects(restored.read(), { code: 'auth-rate-limit' });
});

test('Network and authentication failures keep secrets and response bodies out of errors', async () => {
  const reader = createClaudeLiveReader({ readToken: async () => 'private-token', fetchImpl: async () => { throw new Error('Claude private-token'); } });
  await assert.rejects(reader.read(), error => !error.message.includes('private-token') && /impossible/.test(error.message));
  for (const status of [401, 403, 500]) {
    let bodyRead = false;
    const reader = createClaudeLiveReader({ readToken: async () => 'test-only', fetchImpl: async () => ({ status, ok: false, json: async () => { bodyRead = true; } }) });
    await assert.rejects(reader.read(), /refusée|indisponible/); assert.equal(bodyRead, false);
  }
});

test('Local connection is read without rewriting credentials and rejects expired or absent tokens', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'providersbar-claude-live-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, '.credentials.json');
  await assert.rejects(readLocalConnection(new Date(stamp), file), /indisponible/);
  const text = JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-only', expiresAt: stamp + REFRESH_MS } });
  await fs.writeFile(file, text);
  assert.equal(await readLocalConnection(new Date(stamp), file), 'fixture-only');
  assert.equal(await fs.readFile(file, 'utf8'), text);
  await assert.rejects(readLocalConnection(new Date(stamp + REFRESH_MS), file), /renouveler/);
  await fs.writeFile(file, JSON.stringify({ claudeAiOauth: { expiresAt: stamp + REFRESH_MS } }));
  await assert.rejects(readLocalConnection(new Date(stamp), file), /indisponible/);
});

test('An early 401 renews once and measures again; repeated refusal cannot loop', async () => {
  let reads = 0, requests = 0;
  const reader = createClaudeLiveReader({ now: () => new Date(stamp), readToken: async (_time, options) => {
    reads++;
    if (options) { assert.equal(options.forceRefresh, true); assert.equal(options.rejectedToken, 'first-test-token'); }
    return options ? 'second-test-token' : 'first-test-token';
  }, fetchImpl: async () => ++requests === 1 ? { status: 401 } : reply(usage()) });
  assert.equal((await reader.read()).quotaRemaining, 58); assert.equal(reads, 2); assert.equal(requests, 2);
  const rejected = createClaudeLiveReader({ readToken: async (_time, options) => options ? 'second' : 'first',
    fetchImpl: async () => { requests++; return { status: 401 }; } });
  await assert.rejects(rejected.read(), /refusée/); assert.equal(requests, 4);
  await assert.rejects(rejected.read(), /refusée/); assert.equal(requests, 4);
});

test('Repeated outages back off, recover automatically and do not change the last measurement timestamp', async () => {
  let time = stamp, calls = 0;
  const reader = createClaudeLiveReader({ now: () => new Date(time), readToken: async () => 'test-only',
    fetchImpl: async () => { if (++calls === 2 || calls === 3) throw new Error('offline'); return reply(usage()); } });
  const first = await reader.read();
  time += REFRESH_MS; await assert.rejects(reader.read(), /impossible/);
  assert.equal(first.updatedAt, new Date(stamp).toISOString());
  time += REFRESH_MS; await assert.rejects(reader.read(), /impossible/);
  assert.equal(reader.info().nextAttemptAt, new Date(time + 2 * REFRESH_MS).toISOString());
  time += REFRESH_MS; await assert.rejects(reader.read(), /impossible/); assert.equal(calls, 3);
  time += REFRESH_MS; const recovered = await reader.read();
  assert.equal(calls, 4); assert.equal(recovered.updatedAt, new Date(time).toISOString());
  assert.equal(reader.info().errorCode, null);
});

test('Cooldown survives restart and wake or credential changes cannot bypass a server Retry-After', async () => {
  let time = stamp, calls = 0;
  const options = { now: () => new Date(time), readToken: async () => 'test-only',
    fetchImpl: async () => { calls++; return { status: 429, headers: new Headers({ 'retry-after': '7200' }) }; } };
  const before = createClaudeLiveReader(options); await assert.rejects(before.read());
  const after = createClaudeLiveReader(options); after.restore(before.info());
  after.wake(); after.credentialsChanged();
  await assert.rejects(after.read(), /limite les lectures/); assert.equal(calls, 1);
  time += 7200000; await assert.rejects(after.read()); assert.equal(calls, 2);
});

test('An auth-rate-limit cooldown is not bypassed by wake after a token-refresh 429', async () => {
  let time = stamp, requests = 0;
  const reader = createClaudeLiveReader({ now: () => new Date(time), readToken: async () => 'test-only',
    fetchImpl: async () => { requests++; return reply(usage()); } });
  reader.restore({ errorCode: 'auth-rate-limit', nextAttemptAt: new Date(time + 7200000).toISOString() });
  // Le réveil de veille ne doit pas contourner le Retry-After du renouvellement.
  reader.wake();
  await assert.rejects(reader.read(), { code: 'auth-rate-limit' });
  assert.equal(requests, 0);
  time += 7200001;
  const snapshot = await reader.read();
  assert.equal(requests, 1); assert.ok(snapshot.quotaWindows.length > 0);
});

test('A changed local connection immediately clears authentication cooldown but success caching remains intact', async () => {
  let time = stamp, requests = 0, reject = true;
  const reader = createClaudeLiveReader({ now: () => new Date(time), readToken: async () => 'test-only',
    fetchImpl: async () => { requests++; return reject ? { status: 403 } : reply(usage()); } });
  await assert.rejects(reader.read()); reject = false;
  await assert.rejects(reader.read()); assert.equal(requests, 1);
  reader.credentialsChanged(); await reader.read(); assert.equal(requests, 2);
  reader.credentialsChanged(); await reader.read(); assert.equal(requests, 2);
  time += 10 * REFRESH_MS; reader.wake(); await reader.read(); assert.equal(requests, 3);
});
