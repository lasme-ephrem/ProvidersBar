const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../lib/seed.cjs');
const { removeUnusedProviders, addClaude, normalizeProviderPresentation } = require('../lib/migrations.cjs');
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
test('Removing Gemini web preserves other accounts and strategy preferences', () => {
  const state=createSeed();
  state.providers.push({id:'gemini',accountSession:{kind:'subscription-browser'},snapshot:{quotaRemaining:100}});
  state.history=[{providerId:'gemini',quotaRemaining:100},{providerId:'antigravity',quotaRemaining:72}];
  state.strategy={enabled:false,contributor:false,inputTokens:4321,disabledRoutes:['openrouter:luna'],subscriptionModels:{gemini:'geminiFlash',ollama:'kimi','antigravity-gemini':'geminiFlash'}};
  const before=structuredClone(state), result=removeUnusedProviders(state);
  assert.equal(result.changed,true);
  assert.equal(result.state.providers.length,10);
  assert.deepEqual(result.state.providers,before.providers.filter(p=>p.id!=='gemini'));
  assert.deepEqual(result.state.history,[before.history[1]]);
  assert.equal(result.state.strategy.inputTokens,4321);
  assert.deepEqual(result.state.strategy.disabledRoutes,['openrouter:luna']);
  assert.equal(result.state.strategy.subscriptionModels.ollama,'kimi');
  assert.equal(result.state.strategy.subscriptionModels.gemini,undefined);
  assert.equal(removeUnusedProviders(result.state).changed,false);
  assert.deepEqual(state,before);
});
test('Adding Claude to older inventory preserves account settings, history and strategy', () => {
  const state=createSeed();
  state.providers=state.providers.filter(p=>p.id!=='claude');
  state.providers.find(p=>p.id==='zai').subscriptionStatus='expired';
  state.history=[{providerId:'zai',quotaRemaining:21}];
  state.strategy={subscriptionModels:{openai:'astra'}};
  const before=structuredClone(state), result=addClaude(state);
  assert.equal(result.changed,true);
  assert.equal(result.state.providers.length,10);
  assert.deepEqual(result.state.providers.filter(p=>p.id!=='claude'),before.providers);
  assert.deepEqual(result.state.history,before.history);
  assert.deepEqual(result.state.strategy,before.strategy);
  assert.equal(addClaude(result.state).changed,false);
});

test('Provider presentation migration reorders subscriptions and renames without touching accounts or usage', () => {
  const state = createSeed();
  state.providers.reverse();
  state.providers.find(p => p.id === 'claude').name = 'Claude Pro';
  state.providers.find(p => p.id === 'openai').name = 'OpenAI';
  state.providers.find(p => p.id === 'grok').name = 'Grok';
  for (const p of state.providers) {
    p.accountSession = { kind: 'existing-session' };
    p.snapshot = { quotaRemaining: 83, updatedAt: '2026-09-27T11:00:00Z' };
    p.manualResets = { Semaine: { date: '2026-10-01' } };
  }
  state.history = [{ providerId: 'claude', quotaRemaining: 83 }];
  const before = structuredClone(state), result = normalizeProviderPresentation(state);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.providers.slice(0, 6).map(p => p.id), ['openai','claude','grok','antigravity','zai','ollama']);
  assert.deepEqual(result.state.providers.slice(0, 6).map(p => p.name), ['OpenAI GPT','Anthropic Claude','xAI Grok','Antigravity','Z.ai','Ollama']);
  assert.deepEqual(result.state.providers.filter(p => p.type === 'api'), before.providers.filter(p => p.type === 'api'));
  for (const p of result.state.providers) {
    const original = before.providers.find(o => o.id === p.id);
    assert.deepEqual({ ...p, name: original.name }, original);
  }
  assert.deepEqual(result.state.history, before.history);
  assert.deepEqual(state, before);
  assert.equal(normalizeProviderPresentation(result.state).changed, false);
});
