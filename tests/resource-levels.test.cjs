const { test } = require('node:test');
const assert = require('node:assert/strict');
const ResourceLevels = require('../lib/resource-levels.js');
const { level, providerLevel, thresholds, shortLabel, describe, unitThresholds } = ResourceLevels;

test('Visual thresholds distinguish exhausted, nearly exhausted and low remaining resources', () => {
  for (const [unit, critical, low] of [['USD', 2, 5], ['%', 10, 25]]) {
    assert.deepEqual(unitThresholds(unit), { critical, low });
    assert.equal(level(0, unit), 'empty');
    assert.equal(level(0.001, unit), 'critical');
    assert.equal(level(critical, unit), 'critical');
    assert.equal(level(critical + 0.01, unit), 'low');
    assert.equal(level(low, unit), 'low');
    assert.equal(level(low + 0.01, unit), 'healthy');
  }
  assert.equal(thresholds.USD.critical, 2);
  assert.equal(thresholds.USD.low, 5);
  assert.equal(thresholds.percent.critical, 10);
  assert.equal(thresholds.percent.low, 25);
  assert.equal(unitThresholds('EUR'), null);
  assert.equal(unitThresholds('CNY'), null);
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

test('Every level has a French short label, including the unknown fallback', () => {
  assert.deepEqual(
    ['empty', 'critical', 'low', 'healthy', 'unknown'].map(shortLabel),
    ['Épuisé', 'Critique', 'Bas', 'Suffisant', 'Indisponible']
  );
  assert.equal(shortLabel('inattendu'), 'Indisponible');
});

test('Text descriptions carry the threshold so colour is never the only signal', () => {
  assert.equal(describe('critical', '%'), 'Critique · ≤ 10 %');
  assert.equal(describe('low', '%'), 'Bas · ≤ 25 %');
  assert.equal(describe('critical', 'USD'), 'Critique · ≤ 2 USD');
  assert.equal(describe('low', 'USD'), 'Bas · ≤ 5 USD');
  assert.equal(describe('empty', '%'), 'Épuisé');
  assert.equal(describe('healthy', 'USD'), 'Suffisant');
  assert.equal(describe('unknown', '%'), 'Indisponible');
  assert.equal(describe('critical', 'EUR'), 'Critique');
});
