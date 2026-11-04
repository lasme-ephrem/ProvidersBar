const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchUsage, parseResponse, createCooldownStore } = require('../lib/connectors.cjs');
const success = () => ({ ok: true, json: async () => ({ balance_infos: [{ currency: 'USD', total_balance: '12.5' }] }) });
const options = extra => ({ sleep: async () => {}, random: () => 0.5, ...extra });

test('Read-only API requests recover from transient network failures and gateway outages with bounded backoff', async () => {
  for (const failure of ['network', 502, 503, 504]) {
    let calls = 0;
    const pauses = [], signals = [];
    const result = await fetchUsage('deepseek', `test-transient-${failure}`, async (url, request) => {
      calls++; signals.push(request.signal);
      assert.equal(url, 'https://api.deepseek.com/user/balance');
      assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store');
      if (calls === 1) { if (failure === 'network') throw new Error('test-transient'); return { ok: false, status: failure }; }
      return success();
    }, { ...options(), sleep: async ms => { pauses.push(ms); } });
    assert.equal(calls, 2); assert.deepEqual(pauses, [350]); assert.equal(signals[0], signals[1]);
    assert.equal(result.balances[0].remaining, 12.5);
  }
});

test('Repeated gateway outages use an increasing jittered backoff and give up cleanly', async () => {
  let calls = 0;
  const pauses = [];
  await assert.rejects(fetchUsage('deepseek', 'test-gateway-down', async () => { calls++; return { ok: false, status: 503 }; },
    { ...options(), sleep: async ms => { pauses.push(ms); } }), /Fournisseur indisponible \(HTTP 503\)/);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [350, 800]);
  // Jitter stays within ±20 % of the documented delays.
  const low = [];
  await assert.rejects(fetchUsage('deepseek', 'test-gateway-down-low', async () => ({ ok: false, status: 502 }),
    { sleep: async ms => { low.push(ms); }, random: () => 0 }), /HTTP 502/);
  assert.deepEqual(low, [280, 640]);
});

test('Retry-After on a retried gateway error is honored without exceeding the bounded wait', async () => {
  // Horloge fixe : `serverUntil - now()` vaut exactement 1000 ms. Avec l'horloge
  // réelle, l'appel suivant à now() peut rendre 999 ms et rendre ce test instable.
  const clock = () => 1_700_000_000_000;
  let calls = 0;
  const pauses = [];
  const limited = { ok: false, status: 503, headers: { get: name => name === 'retry-after' ? '1' : null } };
  await assert.rejects(fetchUsage('deepseek', 'test-503-retry-after', async () => { calls++; return calls === 1 ? limited : { ok: false, status: 503 }; },
    { ...options(), now: clock, sleep: async ms => { pauses.push(ms); } }), /HTTP 503/);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [1000, 800]); // 1 s requested by the server, then the 800 ms backoff
  // An excessive Retry-After is capped so the sync cycle is never frozen.
  let capped = 0, cappedPauses = [];
  await assert.rejects(fetchUsage('deepseek', 'test-503-cap', async () => { capped++; return { ok: false, status: 504, headers: { get: () => '3600' } }; },
    { ...options(), now: clock, sleep: async ms => { cappedPauses.push(ms); } }), /HTTP 504/);
  assert.equal(capped, 3);
  assert.deepEqual(cappedPauses, [5000, 5000]);
});

test('500, 501 and 505 are reported cleanly and never retried', async () => {
  for (const status of [500, 501, 505]) {
    let calls = 0;
    await assert.rejects(fetchUsage('deepseek', `test-server-${status}`, async () => { calls++; return { ok: false, status }; }), new RegExp(`Fournisseur indisponible \\(HTTP ${status}\\)`));
    assert.equal(calls, 1);
  }
});

test('Authentication failures and unreadable bodies are not retried; errors never expose credentials', async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    await assert.rejects(fetchUsage('deepseek', `secret-status-${status}`, async () => { calls++; return { ok: false, status }; }), error => !error.message.includes(`secret-status-${status}`));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(fetchUsage('deepseek', 'secret-network', async () => { calls++; throw new Error('secret-network'); }, options()), error => !error.message.includes('secret-network'));
  assert.equal(calls, 3);
  await assert.rejects(fetchUsage('deepseek', 'secret-json', async () => ({ ok: true, json: async () => { throw new Error('secret-json'); } }), options()), /Réponse illisible/);
  for (const key of ['key\n', 'key\r', 'key with space', 'key\u0000x']) await assert.rejects(fetchUsage('deepseek', key, async () => assert.fail('Invalid key must not be sent')), /Clé invalide/);
});

test('API cooldown honors Retry-After seconds and dates without blocking a replacement key', async () => {
  for (const [suffix, retryAfter] of [['seconds', '120'], ['date', 'Wed, 14 Oct 2026 21:02:00 GMT']]) {
    let time = Date.parse('2026-10-14T21:00:00Z'), calls = 0;
    const store = createCooldownStore();
    const injected = options({ now: () => time, cooldowns: store });
    const key = `test-cooldown-${suffix}`;
    const limited = async () => { calls++; return { ok: false, status: 429, headers: { get: () => retryAfter } }; };
    await assert.rejects(fetchUsage('deepseek', key, limited, injected), error => error.code === 'API_RATE_LIMIT' && error.retryAt === time + 120000);
    await assert.rejects(fetchUsage('deepseek', key, limited, injected), { code: 'API_RATE_LIMIT' });
    assert.equal(calls, 1);
    await fetchUsage('deepseek', 'replacement', async () => success(), injected);
    time += 120001;
    await fetchUsage('deepseek', key, async () => success(), injected);
  }
});

test('Cooldowns are delegated to the injected store and survive across fetchUsage calls', async () => {
  const state = new Map();
  const calls = [];
  const store = {
    get: fingerprint => state.get(fingerprint),
    set: (fingerprint, untilMs) => { calls.push(['set', fingerprint, untilMs]); state.set(fingerprint, untilMs); },
    prune: nowMs => { calls.push(['prune', nowMs]); for (const [fingerprint, until] of state) if (!(until > nowMs)) state.delete(fingerprint); },
  };
  let time = 1000000;
  const injected = options({ now: () => time, cooldowns: store });
  await assert.rejects(fetchUsage('deepseek', 'delegated-key', async () => ({ ok: false, status: 429, headers: { get: () => '30' } }), injected), { code: 'API_RATE_LIMIT' });
  assert.deepEqual(calls[0], ['prune', time]);
  assert.equal(calls[1][0], 'set');
  assert.match(calls[1][1], /^deepseek:[a-f0-9]{64}$/);
  assert.equal(calls[1][2], time + 60000);
  let networkCalls = 0;
  await assert.rejects(fetchUsage('deepseek', 'delegated-key', async () => { networkCalls++; return success(); }, injected), { code: 'API_RATE_LIMIT' });
  assert.equal(networkCalls, 0, 'A persisted cooldown must block the request without calling the transport');
  time += 60001;
  await fetchUsage('deepseek', 'delegated-key', async () => success(), injected);
});

test('The bounded cooldown store keeps at most 100 entries', async () => {
  const store = createCooldownStore();
  for (let index = 0; index < 130; index++) store.set(`deepseek:test-${index}`, 5000000 + index);
  let present = 0;
  for (let index = 0; index < 130; index++) if (Number.isFinite(store.get(`deepseek:test-${index}`))) present++;
  assert.equal(present, 100);
  store.prune(5000000 + 129);
  assert.equal(store.get('deepseek:test-0'), undefined);
});

test('OpenRouter keeps a real overdraft and rejects impossible balances', () => {
  // Real account observed on 2026-11-03: consumed slightly more than purchased.
  const real = parseResponse('openrouter', { data: { total_credits: 45, total_usage: 45.08283509 } }).balances;
  assert.equal(real.length, 1);
  assert.equal(real[0].currency, 'USD');
  assert.equal(real[0].total, 45);
  assert.equal(real[0].used, 45.08283509);
  assert.ok(Math.abs(real[0].remaining - (-0.08283509)) < 1e-9);
  assert.deepEqual(parseResponse('openrouter', { data: { total_credits: 10, total_usage: 12 } }).balances, [{ currency: 'USD', remaining: -2, total: 10, used: 12 }]);
  // Beyond the documented tolerance (overdraft > max(total, 1)) the response is inconsistent.
  assert.throws(() => parseResponse('openrouter', { data: { total_credits: 10, total_usage: 25 } }), /incohérent/i);
  assert.throws(() => parseResponse('openrouter', { data: { total_credits: 0, total_usage: 2 } }), /incohérent/i);
  // Negative or non-finite raw amounts are still invalid.
  assert.throws(() => parseResponse('openrouter', { data: { total_credits: -5, total_usage: 0 } }));
  assert.throws(() => parseResponse('openrouter', { data: { total_credits: 5, total_usage: -1 } }));
  assert.throws(() => parseResponse('runinfra', { object: 'credits', currency: 'usd', balance_cents: -25, available_cents: 0, held_cents: 0 }), /centimes positif/);
  assert.throws(() => parseResponse('runinfra', { object: 'credits', currency: 'usd', balance_cents: 100, available_cents: 100, held_cents: 0, as_of: '2026-08-27T10:41:12' }), /fuseau/);
  assert.throws(() => parseResponse('runinfra', { object: 'credits', currency: 'usd', balance_cents: 100, available_cents: 100, held_cents: 0, as_of: '27/08/2026 10:41' }), /fuseau/);
  assert.equal(parseResponse('runinfra', { object: 'credits', currency: 'usd', balance_cents: 0, available_cents: 0, held_cents: 0, as_of: '2026-08-27T10:41:12+02:00' }).updatedAt, '2026-08-27T08:41:12.000Z');
});


test('un endpoint de pack signé remplace la route par défaut, sans accepter HTTP', async () => {
  const seen = [];
  const result = await fetchUsage('deepseek', 'test-pack-endpoint', async url => {
    seen.push(url);
    return success();
  }, { ...options(), endpoint: 'https://api.deepseek.com/v2/balance' });
  assert.deepEqual(seen, ['https://api.deepseek.com/v2/balance']);
  assert.equal(result.balances[0].remaining, 12.5);
  await assert.rejects(fetchUsage('deepseek', 'test-pack-http', async () => success(), options({ endpoint: 'http://api.deepseek.com/balance' })), /HTTPS sans identifiants/);
});
