'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCanaryEnv, loadCanaryEnv } = require('../lib/canary-env.cjs');

test('le fichier de canary accepte les variables attendues et ignore le reste', () => {
  const values = parseCanaryEnv([
    '# commentaire',
    'export LASMIUM_CANARY_OPENROUTER_KEY="sk-or-test"',
    "LASMIUM_CANARY_DEEPSEEK_KEY='sk-ds-test'",
    'LASMIUM_CANARY_RUNINFRA_KEY=',
    'AUTRE_SECRET=jamais-charge',
    'LASMIUM_CANARY_BAD KEY=non',
  ].join('\n'));
  assert.deepEqual(values, {
    LASMIUM_CANARY_OPENROUTER_KEY: 'sk-or-test',
    LASMIUM_CANARY_DEEPSEEK_KEY: 'sk-ds-test',
  });
});

test('les variables déjà présentes gagnent sur le fichier local', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'canary-'));
  const file = require('node:path').join(dir, 'canary.env');
  require('node:fs').writeFileSync(file, 'LASMIUM_CANARY_OPENROUTER_KEY=fichier\n');
  const env = { LASMIUM_CANARY_OPENROUTER_KEY: 'environnement' };
  const result = loadCanaryEnv({ file, env });
  assert.equal(result.loaded, true);
  assert.equal(result.count, 0);
  assert.equal(env.LASMIUM_CANARY_OPENROUTER_KEY, 'environnement');
});
