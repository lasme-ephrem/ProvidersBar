const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCredentialStore } = require('../lib/credential-store.cjs');

test('Simultaneous connections and disconnect preserve other providers on disk and in memory', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const writes = [];
  const store = createCredentialStore({ write: async values => { if (!writes.length) await gate; writes.push(structuredClone(values)); } });
  store.load({ deepseek: 'encrypted-old', runinfra: 'encrypted-infra' });
  const a = store.set('openrouter', 'encrypted-router');
  const b = store.delete('deepseek');
  const c = store.set('deepseek', 'encrypted-new');
  assert.equal(store.has('openrouter'), false);
  release(); await Promise.all([a, b, c]);
  assert.deepEqual(writes.at(-1), { runinfra: 'encrypted-infra', openrouter: 'encrypted-router', deepseek: 'encrypted-new' });
  assert.equal(store.get('deepseek'), 'encrypted-new');
  assert.equal(store.get('runinfra'), 'encrypted-infra');
});

test('A failed replacement or deletion retains the working key and the next write recovers', async () => {
  let fail = true;
  const store = createCredentialStore({ write: async () => { if (fail) throw new Error('disk unavailable'); } });
  store.load({ openrouter: 'encrypted-working' });
  await assert.rejects(store.set('openrouter', 'encrypted-bad'), /disk unavailable/);
  assert.equal(store.get('openrouter'), 'encrypted-working');
  await assert.rejects(store.delete('openrouter'), /disk unavailable/);
  assert.equal(store.has('openrouter'), true);
  fail = false;
  await store.set('deepseek', 'encrypted-new');
  assert.equal(store.get('openrouter'), 'encrypted-working');
  await store.delete('openrouter');
  assert.equal(store.has('openrouter'), false);
  for (const invalid of [null, [], { openrouter: null }, { openrouter: '' }]) assert.throws(() => store.load(invalid), /illisible/);
  assert.equal(store.get('deepseek'), 'encrypted-new');
  assert.equal(store.has('toString'), false);
});
