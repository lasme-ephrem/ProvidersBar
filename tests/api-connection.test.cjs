const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchUsage } = require('../lib/connectors.cjs');
const success = () => ({ ok: true, json: async () => ({ balance_infos: [{ currency: 'USD', total_balance: '12.5' }] }) });

test('Read-only API requests recover once from a transient network failure or gateway outage', async () => {
  for (const failure of ['network', 502, 503, 504]) {
    let calls = 0, pauses = 0;
    const signals = [];
    const result = await fetchUsage('deepseek', 'test-transient', async (url, options) => {
      calls++; signals.push(options.signal);
      assert.equal(url, 'https://api.deepseek.com/user/balance');
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
      if (calls === 1) { if (failure === 'network') throw new Error('test-transient'); return { ok: false, status: failure }; }
      return success();
    }, { sleep: async () => { pauses++; } });
    assert.equal(calls, 2); assert.equal(pauses, 1); assert.equal(signals[0], signals[1]);
    assert.equal(result.balances[0].remaining, 12.5);
  }
});

test('Authentication failures are not retried; network and invalid JSON never expose credentials', async () => {
  for (const status of [401, 403, 404]) {
    let calls = 0;
    await assert.rejects(fetchUsage('deepseek', 'secret-status', async () => { calls++; return { ok: false, status }; }), error => !error.message.includes('secret-status'));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(fetchUsage('deepseek', 'secret-network', async () => { calls++; throw new Error('secret-network'); }, { sleep: async () => {} }), error => !error.message.includes('secret-network'));
  assert.equal(calls, 2);
  await assert.rejects(fetchUsage('deepseek', 'secret-json', async () => ({ ok: true, json: async () => { throw new Error('secret-json'); } })), /Réponse illisible/);
  for (const key of ['key\n', 'key\r', 'key with space', 'key\u0000x']) await assert.rejects(fetchUsage('deepseek', key, async () => assert.fail('Invalid key must not be sent')), /Clé invalide/);
});

test('API cooldown honors Retry-After seconds and dates without blocking a replacement key', async () => {
  for (const [suffix, retryAfter] of [['seconds', '120'], ['date', 'Wed, 14 Oct 2026 21:02:00 GMT']]) {
    let time = Date.parse('2026-10-14T21:00:00Z'), calls = 0;
    const options = { now: () => time, sleep: async () => {} };
    const key = `test-cooldown-${suffix}`;
    const limited = async () => { calls++; return { ok: false, status: 429, headers: { get: () => retryAfter } }; };
    await assert.rejects(fetchUsage('deepseek', key, limited, options), error => error.code === 'API_RATE_LIMIT' && error.retryAt === time + 120000);
    await assert.rejects(fetchUsage('deepseek', key, limited, options), { code: 'API_RATE_LIMIT' });
    assert.equal(calls, 1);
    await fetchUsage('deepseek', 'replacement', async () => success(), options);
    time += 120001;
    await fetchUsage('deepseek', key, async () => success(), options);
  }
});
