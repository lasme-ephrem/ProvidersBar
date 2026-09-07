const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../lib/seed.cjs');
const { removeUnusedProviders } = require('../lib/migrations.cjs');
const { removeInvalidOrcaBalances } = require('../lib/migrations.cjs');
const { removeImportMetadata } = require('../lib/migrations.cjs');

test('Import cleanup preserves account sessions, readings and configured billing information', () => {
  const original = createSeed();
  original.importedFrom = 'legacy.xlsx';
  Object.assign(original.providers[0], { importedCost: '103$', notes: 'My plan', amount: 103, renewalDate: '2026-10-05', accountSession: { kind: 'openai-codex' }, snapshot: { quotaRemaining: 96 } });
  Object.assign(original.providers[1], { importedCost: '109,99$', notes: 'Passage à 219,99 $ indiqué ; date du changement et périodicité à préciser.' });
  original.history.push({ providerId: 'openai', quotaRemaining: 96 });
  const before = structuredClone(original);
  const result = removeImportMetadata(original);
  assert.equal(result.changed, true);
  assert.equal(Object.hasOwn(result.state, 'importedFrom'), false);
  assert.ok(result.state.providers.every(p => !Object.hasOwn(p, 'importedCost')));
  const { importedCost, ...expected } = before.providers[0];
  assert.deepEqual(result.state.providers[0], expected);
  assert.equal(result.state.providers[1].notes, '');
  assert.deepEqual(result.state.history, before.history);
  assert.deepEqual(result.state.settings, before.settings);
  assert.deepEqual(original, before);
  assert.equal(removeImportMetadata(result.state).changed, false);
});

test('Invalid Orca API balances are removed regardless of size; manual and other-provider records survive', () => {
  const original = createSeed();
  const bad = { source: 'api', balances: [{ currency: 'USD', remaining: 100000000 }] };
  original.providers.find(p => p.id === 'orcarouter').snapshot = bad;
  original.history = [
    { providerId: 'orcarouter', ...bad },
    { providerId: 'orcarouter', source: 'api', balances: [{ currency: 'USD', remaining: 20 }] },
    { providerId: 'orcarouter', source: 'manual', balances: [{ currency: 'USD', remaining: 53.2 }] },
    { providerId: 'deepseek', ...bad },
    { providerId: 'orcarouter', ...bad, connectorVersion: 'orca-wallet-v1' },
  ];
  const before = structuredClone(original);
  const result = removeInvalidOrcaBalances(original);
  assert.equal(result.changed, true);
  assert.equal(result.state.providers.find(p => p.id === 'orcarouter').snapshot, null);
  assert.deepEqual(result.state.history, before.history.slice(2));
  assert.deepEqual(result.state.providers.filter(p => p.id !== 'orcarouter'), before.providers.filter(p => p.id !== 'orcarouter'));
  assert.deepEqual(original, before);
  assert.equal(removeInvalidOrcaBalances(result.state).changed, false);
});

test('Removing unused providers preserves remaining subscriptions, remaining balances, settings and history', () => {
  const original = createSeed();
  original.providers.find(p => p.id === 'openai').plan = 'Personal edited plan';
  original.providers.find(p => p.id === 'deepseek').snapshot = { balances: [{ currency: 'USD', remaining: 8.43 }] };
  original.providers.push({ id: 'tokenrouter', type: 'api' }, { id: 'opencode-zen', type: 'api' }, { id: 'qwen', type: 'subscription' }, { id: 'opencode-go', type: 'subscription' });
  original.history.push({ providerId: 'deepseek', balances: [{ remaining: 8.43 }] }, { providerId: 'openai', quotaRemaining: 62 }, { providerId: 'tokenrouter', balances: [] }, { providerId: 'qwen', balances: [] }, { providerId: 'opencode-go', quotaRemaining: 10 });
  const before = structuredClone(original);
  const result = removeUnusedProviders(original);
  assert.equal(result.changed, true);
  assert.equal(result.state.providers.length, 10);
  assert.deepEqual(result.state.providers, before.providers.slice(0, 10));
  assert.deepEqual(result.state.history, before.history.slice(0, 2));
  assert.deepEqual(result.state.settings, before.settings);
  assert.deepEqual(original, before);
  assert.equal(removeUnusedProviders(result.state).changed, false);
});
