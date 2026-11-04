'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../lib/seed.cjs');
const { buildDiagnosticBundle } = require('../lib/diagnostic-bundle.cjs');

test('le bundle de diagnostic ne contient ni secret, ni solde, ni chemin absolu', () => {
  const state = createSeed();
  state.providers[0].snapshot = { source: 'api', balances: [{ currency: 'USD', remaining: 42.42 }], quotaWindows: [] };
  state.providers[0].error = 'Clé refusée ou expirée.';
  state.providers[0].connected = true;
  state.providers[0].health = {
    state: 'auth', strategy: 'openai-codex', stale: false, lastSuccessAt: '2026-11-04T00:00:00.000Z',
    lastFailureAt: '2026-11-04T01:00:00.000Z', failures: 1, parserVersion: 'openai-codex-v1',
    error: { code: 'AUTH_REQUIRED', message: 'Session expirée.', retryAt: null },
  };
  state.settings.theme = 'dark';
  const bundle = buildDiagnosticBundle({
    app: { version: '0.5.0', electron: '44.0.0', packaged: true },
    state,
    packs: [{ provider: 'openrouter', version: '2026.11.1', parserVersion: 'openrouter-api-v1', endpoint: 'https://openrouter.ai/api/v1/credits' }],
    packErrors: [{ file: 'C:\\secret\\bad.json', provider: 'x', reason: 'signature invalide' }],
    backups: ['state-20261104-010000-000.json'],
    now: new Date('2026-11-04T02:00:00.000Z'),
    platform: 'win32',
    versions: { node: '24.0.0' },
  });
  const body = JSON.stringify(bundle);
  assert.equal(bundle.format, 'lasmium-diagnostic');
  assert.equal(bundle.application.version, '0.5.0');
  assert.equal(bundle.inventory.connected, 1);
  assert.equal(bundle.providers[0].health.error.code, 'AUTH_REQUIRED');
  assert.equal(bundle.connectorPacks[0].endpointHost, 'openrouter.ai');
  assert.equal(body.includes('42.42'), false);
  assert.equal(body.includes('test-secret'), false);
  assert.equal(body.includes('C:\\secret'), false);
  assert.equal(body.includes('bad.json'), true, 'seul le basename est conservé, pas le chemin');
  assert.equal(body.includes('state-20261104-010000-000.json'), true);
});
