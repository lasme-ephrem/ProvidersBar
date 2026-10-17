const { test } = require('node:test');
const assert = require('node:assert/strict');
const { level, providerLevel } = require('../lib/resource-levels.js');

test('Visual thresholds distinguish exhausted, nearly exhausted and low remaining resources', () => {
  for (const [unit, critical, low] of [['USD', 2, 5], ['%', 10, 25]]) {
    assert.equal(level(0, unit), 'empty');
    assert.equal(level(0.001, unit), 'critical');
    assert.equal(level(critical, unit), 'critical');
    assert.equal(level(critical + 0.01, unit), 'low');
    assert.equal(level(low, unit), 'low');
    assert.equal(level(low + 0.01, unit), 'healthy');
  }
});

test('Unknown values and zero non-USD balances stay unknown; prices are excluded', () => {
  for (const value of [null, undefined, NaN, Infinity, '0']) assert.equal(level(value, 'USD'), 'unknown');
  assert.equal(level(101, '%'), 'unknown');
  assert.equal(level(0, 'CNY'), 'unknown');
  assert.equal(providerLevel({ active: true, amount: 0 }), 'unknown');
  assert.equal(providerLevel({ active: true, snapshot: { balances: [{ currency: 'CNY', remaining: 0 }] } }), 'unknown');
});

test('Negative API balances are exhausted in every supported currency', () => {
  for (const currency of ['USD', 'EUR', 'CNY']) {
    for (const remaining of [-0.08, -1, -100]) {
      assert.equal(level(remaining, currency), 'empty');
      assert.equal(providerLevel({ active: true, type: 'api', snapshot: { balances: [{ currency, remaining }] } }), 'empty');
    }
  }
  assert.equal(level(-1, '%'), 'unknown');
});

test('Provider emphasis uses the most constrained real window without flattening other windows', () => {
  const provider = { active: true, snapshot: { quotaRemaining: 95, quotaWindows: [{ remaining: 0 }, { remaining: 95 }] } };
  assert.equal(providerLevel(provider), 'empty');
  assert.equal(level(provider.snapshot.quotaWindows[1].remaining, '%'), 'healthy');
  assert.equal(providerLevel({ ...provider, active: false }), 'unknown');
  assert.equal(providerLevel({ ...provider, subscriptionStatus: 'expired' }), 'unknown');
  assert.equal(providerLevel({ active: true, snapshot: { balances: [{ currency: 'USD', remaining: 0 }, { currency: 'CNY', remaining: 300 }] } }), 'empty');
});
