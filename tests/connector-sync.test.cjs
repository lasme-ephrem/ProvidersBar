'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnectorSync, assumeOllamaFree } = require('../lib/connector-sync.cjs');
const { breakerOpen } = require('../lib/connector-contract.cjs');

function harness(overrides = {}) {
  const p = {
    id: 'openrouter', type: 'api', accountSession: null, snapshot: null, error: null,
    subscriptionStatus: 'active', lastAttempt: null,
  };
  const state = { providers: [p], connectorHealth: {}, settings: {} };
  const calls = [];
  const sync = createConnectorSync({
    getState: () => state,
    provider: id => { if (id !== p.id) throw new Error('Service inconnu.'); return p; },
    isTracked: () => true,
    isConnected: () => true,
    disconnecting: new Set(),
    busy: new Map(),
    publicState: () => state,
    broadcast: () => {},
    persist: async () => { calls.push('persist'); },
    notify: () => {},
    record: (provider, snapshot) => { provider.snapshot = snapshot; calls.push('record'); },
    markHealthFailure: (provider, error) => { provider.error = error.message; },
    safeStorage: { decryptString: () => 'test-key' },
    credentials: { get: () => Buffer.from('x').toString('base64') },
    fetchUsage: async (id, key, fetchImpl, options) => { calls.push(['fetch', id, options.endpoint]); return { updatedAt: new Date().toISOString(), balances: [] }; },
    apiFetch: async () => {},
    cooldowns: { prune: () => {} },
    endpointFor: id => `https://pack.example/${id}`,
    fetchWallet: async () => ({ updatedAt: new Date().toISOString() }),
    orcaSession: () => ({ fetch: async () => {} }),
    fetchOllamaCredits: async () => ({ updatedAt: new Date().toISOString() }),
    ollamaSession: () => ({ fetch: async () => {} }),
    openAiAccount: { read: async () => {} },
    verifyAntigravity: async () => {},
    verifyClaudeDesktop: async () => {},
    subscriptionAccounts: { read: async () => {} },
    isBrowserAccount: () => false,
    breakerOpen,
    ...overrides,
  });
  return { sync, state, p, calls };
}

test('la synchronisation API utilise le pack et persiste une seule fois', async () => {
  const { sync, state, calls } = harness();
  await sync.syncOne('openrouter');
  assert.deepEqual(calls.filter(item => Array.isArray(item)), [['fetch', 'openrouter', 'https://pack.example/openrouter']]);
  assert.equal(calls.filter(item => item === 'record').length, 1);
  assert.equal(calls.filter(item => item === 'persist').length, 1);
  assert.equal(state.providers[0].lastAttempt !== null, true);
});

test('le disjoncteur bloque l’automatique mais jamais l’action manuelle', async () => {
  let fetchCalls = 0;
  const environment = harness({
    fetchUsage: async () => { fetchCalls++; return { updatedAt: new Date().toISOString() }; },
  });
  environment.state.connectorHealth.openrouter = { state: 'down', error: { code: 'NETWORK', retryAt: new Date(Date.now() + 60000).toISOString() } };
  await environment.sync.syncOne('openrouter', { force: false });
  assert.equal(fetchCalls, 0);
  await environment.sync.syncOne('openrouter', { force: true });
  assert.equal(fetchCalls, 1);
});

test('assumeOllamaFree conserve le Free vérifié sans inventer un forfait payant', () => {
  assert.equal(assumeOllamaFree({ subscriptionStatus: 'expired' }), true);
  assert.equal(assumeOllamaFree({ snapshot: { planTier: 'free' } }), true);
  assert.equal(assumeOllamaFree({ snapshot: { planTier: 'paid' } }), false);
});
