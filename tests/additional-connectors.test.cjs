const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseResponse, fetchUsage } = require('../lib/connectors.cjs');
const { connectionInfo } = require('../lib/provider-catalog.cjs');
const credits = { object: 'credits', currency: 'usd', balance_cents: 5476, held_cents: 34, available_cents: 5476, period: { spent_cents: 1500 }, as_of: '2026-08-27T10:41:12.318Z' };

test('RunInfra converts integer cents without subtracting holds twice or using a spend cap', () => {
  const result = parseResponse('runinfra', { ...credits, spend_cap: { remaining_cents: 99999 } });
  assert.deepEqual(result.balances, [{ currency: 'USD', remaining: 54.76 }]);
  assert.deepEqual(result.details.map(d => d.amount), [54.76, 0.34, 15]);
  assert.equal(result.updatedAt, credits.as_of);
  const zero = parseResponse('runinfra', { ...credits, balance_cents: 0, available_cents: 0, held_cents: 0 });
  assert.equal(zero.balances[0].remaining, 0);
});

test('RunInfra rejects incomplete, negative or inconsistent amounts instead of displaying them', () => {
  for (const patch of [{ balance_cents: null }, { balance_cents: 4.5 }, { balance_cents: -25 }, { held_cents: -1 }, { available_cents: 5442 }, { currency: 'eur' }, { object: 'other' }, { as_of: 'bad' }, { period: { spent_cents: -2 } }]) {
    assert.throws(() => parseResponse('runinfra', { ...credits, ...patch }));
  }
  // A date without timezone is ambiguous and must be refused (not interpreted locally).
  assert.throws(() => parseResponse('runinfra', { ...credits, as_of: '2026-08-27T10:41:12' }), /fuseau/);
});

test('DeepSeek rejects malformed decimal strings, negative balances and duplicate currencies', () => {
  for (const total_balance of ['0x10', ' 12.50 ', '1e3', '']) {
    assert.throws(() => parseResponse('deepseek', { balance_infos: [{ currency: 'USD', total_balance }] }));
  }
  assert.throws(() => parseResponse('deepseek', { balance_infos: [null] }));
  assert.throws(() => parseResponse('deepseek', { balance_infos: [{ currency: 'USD', total_balance: '-12.50' }] }), /négatif/);
  assert.throws(() => parseResponse('deepseek', { balance_infos: [
    { currency: 'USD', total_balance: '12.50' }, { currency: 'USD', total_balance: '2.00' },
  ] }), /ambigus/);
  assert.throws(() => parseResponse('openrouter', { data: { total_credits: '0x10', total_usage: 0 } }));
});

test('OpenRouter never returns a negative remaining balance', () => {
  assert.deepEqual(parseResponse('openrouter', { data: { total_credits: 10, total_usage: 4 } }).balances, [{ currency: 'USD', remaining: 6, total: 10, used: 4 }]);
  assert.throws(() => parseResponse('openrouter', { data: { total_credits: 4, total_usage: 10 } }), /incohérent/);
});

test('OrcaRouter API-key limits are never interpreted as wallet balances, even when plausible', () => {
  for (const amount of [100000000, 53.2, 0, '12.50', -0.2, null]) {
    assert.throws(() => parseResponse('orcarouter', { object: 'billing_subscription', hard_limit_usd: amount, total_usage: 0, access_until: 0 }), /plafond de la clé/);
  }
});

test('Additional connectors send only fixed read-only authenticated requests and sanitize errors', async () => {
  for (const [id, url, body] of [
    ['runinfra', 'https://api.runinfra.ai/v1/credits', credits],
  ]) {
    await fetchUsage(id, ' test-key ', async (actualUrl, options) => {
      assert.equal(actualUrl, url);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => body };
    });
    await assert.rejects(fetchUsage(id, 'key', async () => ({ ok: false, status: 401 })), /Clé refusée/);
    await assert.rejects(fetchUsage(id, 'key', async () => ({ ok: false, status: 404 })), /route.*indisponible/);
  }
  await assert.rejects(fetchUsage('runinfra', 'key', async () => ({ ok: false, status: 403 })), /clé d’espace de travail/);
  assert.equal(connectionInfo('toString'), null);
  assert.equal(connectionInfo('ollama').mode, 'account');
});
